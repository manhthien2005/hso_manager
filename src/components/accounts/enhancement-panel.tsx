"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Account,
  Device,
  EnhancementCharmMode,
  EnhancementPaymentType,
  EnhancementQueueJob,
  PlayerSnapshot,
} from "@/lib/types";
import type { ConfigDraft, ConfigErrors, ConfigPath, ConfigValue } from "@/lib/config-schema";
import { CONTROL_SCHEMA } from "@/lib/config-schema";
import {
  type EnhancementQueueEntry,
  type InventoryItemCatalog,
  addQueueEntry,
  getInventoryFreshness,
  isInventoryAvailable,
  removeQueueEntry,
  reorderQueueEntry,
  updateQueueEntryTargetLevel,
  updateQueueEntryPaymentType,
  updateQueueEntryCharmMode,
  validateQueue,
} from "@/lib/inventory";
import { isEnhancementQueueAvailableOnDevice } from "@/lib/capabilities";
import { draftToSubmissionPayload, validateQueueDraft } from "@/lib/queue";
import { api } from "@/services/api";
import { type AuthoritativeQueueWithItems } from "@/lib/queue-progress";
import { InventoryBagGrid } from "./inventory-bag-grid";
import { EnhancementQueueDraft } from "./enhancement-queue-draft";
import { EnhancementQueueProgress } from "./enhancement-queue-progress";
import { ConfigFieldInput } from "./config-field";
import { Card } from "@/components/ui/card";

interface EnhancementPanelProps {
  draft: ConfigDraft;
  errors: ConfigErrors;
  disabled: boolean;
  onChange: (path: ConfigPath, value: ConfigValue) => void;
  onBatchChange?: (updates: Partial<Record<ConfigPath, ConfigValue>>) => void;
  account: Account;
  device?: Device;
  resetKey?: number;
  ctlVersion?: number;
}

export function EnhancementPanel({
  draft,
  errors,
  disabled,
  onChange,
  onBatchChange,
  account,
  device,
  resetKey = 0,
  ctlVersion = 14,
}: EnhancementPanelProps) {
  // Extract legacy enhance fields from schema
  const schemaSections = CONTROL_SCHEMA[ctlVersion] ?? CONTROL_SCHEMA[14] ?? CONTROL_SCHEMA[13];
  const enhanceSection = schemaSections?.find((s) => s.id === "enhance");
  const legacyFields = enhanceSection?.fields ?? [];

  // Local-only state for enhancement queue draft
  const [queue, setQueue] = useState<EnhancementQueueEntry[]>([]);
  const [activeQueue, setActiveQueue] = useState<EnhancementQueueJob | null>(null);
  const [activeQueueWithItems, setActiveQueueWithItems] = useState<AuthoritativeQueueWithItems | null>(null);
  const [queueHistory, setQueueHistory] = useState<AuthoritativeQueueWithItems[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Freshness and manual snapshot refresh state
  const [refreshedSnapshot, setRefreshedSnapshot] = useState<PlayerSnapshot | null>(null);
  const [isRefreshingInventory, setIsRefreshingInventory] = useState(false);

  // Retain terminal/active job visibility so FAILED/COMPLETED does not abruptly vanish
  const [retainedJobId, setRetainedJobIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(`enh_retained_job_${account.id}`);
    }
    return null;
  });

  const setRetainedJobId = useCallback((id: string | null) => {
    setRetainedJobIdState(id);
    if (typeof window !== "undefined") {
      if (id) {
        sessionStorage.setItem(`enh_retained_job_${account.id}`, id);
      } else {
        sessionStorage.removeItem(`enh_retained_job_${account.id}`);
      }
    }
  }, [account.id]);

  const activeSnapshot = refreshedSnapshot ?? account.snapshot;
  const liveInventory = activeSnapshot?.inventory ?? null;
  const isAvailable = isInventoryAvailable(account.status, activeSnapshot);
  const freshness = getInventoryFreshness(activeSnapshot);

  // Derive validated queue reactively without calling setState inside an effect
  const validatedQueue = useMemo(() => {
    if (queue.length === 0) return queue;
    return validateQueue(queue, isAvailable ? liveInventory : null);
  }, [queue, isAvailable, liveInventory]);

  // Capability gate: Start Queue requires enhancement-queue-v1 token and fresh online device
  const isQueueCapable = isEnhancementQueueAvailableOnDevice(device);

  const activeJobStatus = activeQueueWithItems?.job.status;

  // Fetch active queue on mount and when account changes, with reload recovery
  useEffect(() => {
    let cancelled = false;

    async function loadActiveQueue() {
      try {
        let active: AuthoritativeQueueWithItems | null = null;
        if (api.getActiveQueueWithItems) {
          active = await api.getActiveQueueWithItems(account.id);
        } else if (api.getActiveEnhancementQueue) {
          const rawJob = await api.getActiveEnhancementQueue(account.id);
          if (rawJob) {
            setActiveQueue(rawJob);
          }
        }

        let historyList: AuthoritativeQueueWithItems[] = [];
        if (api.getRecentQueueHistory) {
          historyList = await api.getRecentQueueHistory(account.id, 5);
          if (!cancelled) {
            setQueueHistory(historyList);
          }
        }

        if (active) {
          if (!cancelled) {
            setRetainedJobId(active.job.id);
            setActiveQueueWithItems(active);
            setActiveQueue(active.job);
          }
        } else if (retainedJobId && api.getQueueJobWithItems) {
          // Unresolved query returned null, but we retain visibility on the terminal job
          const retained = await api.getQueueJobWithItems(retainedJobId);
          if (!cancelled) {
            if (retained) {
              setActiveQueueWithItems(retained);
              setActiveQueue(retained.job);
            } else {
              setActiveQueueWithItems(null);
              setActiveQueue(null);
            }
          }
        } else if (historyList.length > 0 && !activeQueueWithItems) {
          // If no active job and no explicit retainedJobId, recover the latest terminal job if recent (< 10 min)
          const latest = historyList[0];
          const finishedAt = latest.job.finishedAt ? new Date(latest.job.finishedAt).getTime() : 0;
          if (Date.now() - finishedAt < 10 * 60 * 1000) {
            if (!cancelled) {
              setRetainedJobId(latest.job.id);
              setActiveQueueWithItems(latest);
              setActiveQueue(latest.job);
            }
          } else if (!cancelled) {
            setActiveQueueWithItems(null);
            setActiveQueue(null);
          }
        } else {
          if (!cancelled) {
            setActiveQueueWithItems(null);
            setActiveQueue(null);
          }
        }
      } catch (err) {
        if (!cancelled && err instanceof Error) {
          setActionError(err.message);
        }
      }
    }

    void loadActiveQueue();

    // Subscribe to realtime changes on enhancement_queue_jobs
    let unsubscribeRealtime = () => {};
    if (api.subscribeQueueUpdates) {
      unsubscribeRealtime = api.subscribeQueueUpdates(account.id, () => {
        if (!cancelled) {
          void loadActiveQueue();
        }
      });
    }

    // Read-only bounded fallback polling when an unresolved queue is running
    const pollInterval = setInterval(() => {
      if (
        !cancelled &&
        activeJobStatus &&
        ["QUEUED", "RUNNING", "PAUSING"].includes(activeJobStatus)
      ) {
        void loadActiveQueue();
      }
    }, 4000);

    return () => {
      cancelled = true;
      unsubscribeRealtime();
      clearInterval(pollInterval);
    };
  }, [account.id, activeJobStatus, retainedJobId, activeQueueWithItems, setRetainedJobId]);

  // Selected slots set for bag grid rendering
  const selectedSlots = useMemo(() => {
    return new Set(
      validatedQueue
        .filter((entry) => entry.status === "VALID")
        .map((entry) => entry.reference.captured_slot),
    );
  }, [validatedQueue]);

  const staleSlots = useMemo(() => {
    return new Set(
      validatedQueue
        .filter((entry) => entry.status === "STALE_SELECTION")
        .map((entry) => entry.reference.captured_slot),
    );
  }, [validatedQueue]);

  function handleSelectItem(item: InventoryItemCatalog) {
    if (!item.candidate_for_enhancement) return;
    setActionError(null);

    setQueue((current) => {
      const existingIndex = current.findIndex(
        (entry) => entry.reference.captured_slot === item.slot,
      );

      // If already in queue, toggle remove
      if (existingIndex !== -1) {
        return removeQueueEntry(current, current[existingIndex].id);
      }

      // Add to queue
      return addQueueEntry(current, item);
    });
  }

  function handleRemove(id: string) {
    setActionError(null);
    setQueue((current) => removeQueueEntry(current, id));
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    setQueue((current) => reorderQueueEntry(current, fromIndex, toIndex));
  }

  function handleUpdateTargetLevel(id: string, targetLevel: number) {
    setQueue((current) => updateQueueEntryTargetLevel(current, id, targetLevel));
  }

  function handleUpdatePaymentType(id: string, paymentType: EnhancementPaymentType) {
    setQueue((current) => updateQueueEntryPaymentType(current, id, paymentType));
  }

  function handleUpdateCharmMode(id: string, charmMode: EnhancementCharmMode) {
    setQueue((current) => updateQueueEntryCharmMode(current, id, charmMode));
  }

  function handleClearQueue() {
    setActionError(null);
    setQueue([]);
  }

  async function handleStartQueue() {
    if (!isQueueCapable) {
      setActionError("Runtime hiện tại chưa hỗ trợ hàng đợi cường hóa (cần token enhancement-queue-v1).");
      return;
    }

    if (validatedQueue.length === 0) {
      setActionError("Hàng đợi cường hóa trống. Vui lòng chọn ít nhất một trang bị.");
      return;
    }

    // Client-side preliminary validation
    const draftValidation = validateQueueDraft(validatedQueue, liveInventory);
    if (!draftValidation.valid) {
      setActionError(draftValidation.message ?? "Dự thảo hàng đợi không hợp lệ.");
      return;
    }

    setIsStarting(true);
    setActionError(null);

    try {
      const payload = draftToSubmissionPayload(validatedQueue);
      if (!api.startEnhancementQueue) {
        throw new Error("startEnhancementQueue is not implemented");
      }
      const job = await api.startEnhancementQueue({
        accountId: account.id,
        items: payload,
      });

      setRetainedJobId(job.id);

      // Refetch full authoritative active queue with items immediately
      if (api.getActiveQueueWithItems) {
        const fullQueue = await api.getActiveQueueWithItems(account.id);
        setActiveQueueWithItems(fullQueue);
        setActiveQueue(fullQueue ? fullQueue.job : job);
      } else {
        setActiveQueue(job);
      }
      setQueue([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Xuất bản hàng đợi thất bại.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleRefreshInventory() {
    setIsRefreshingInventory(true);
    try {
      if (api.getAccount) {
        const fresh = await api.getAccount(account.id);
        if (fresh?.snapshot) {
          setRefreshedSnapshot(fresh.snapshot);
        }
      }
    } catch (err) {
      console.error("[EnhancementPanel] refresh inventory error:", err);
    } finally {
      setIsRefreshingInventory(false);
    }
  }

  function handleDismissQueue() {
    setRetainedJobId(null);
    setActiveQueueWithItems(null);
    setActiveQueue(null);
  }

  async function handlePauseQueue() {
    if (!activeQueue) return;
    setIsPausing(true);
    setActionError(null);

    try {
      if (!api.pauseEnhancementQueue) {
        throw new Error("pauseEnhancementQueue is not implemented");
      }
      await api.pauseEnhancementQueue(activeQueue.id);

      // Refetch authoritative queue state
      if (api.getActiveQueueWithItems) {
        const updated = await api.getActiveQueueWithItems(account.id);
        setActiveQueueWithItems(updated);
        setActiveQueue(updated ? updated.job : null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Yêu cầu tạm dừng thất bại.");
    } finally {
      setIsPausing(false);
    }
  }

  async function handleCancelQueue() {
    if (!activeQueue) return;
    setIsCancelling(true);
    setActionError(null);

    try {
      if (!api.cancelEnhancementQueue) {
        throw new Error("cancelEnhancementQueue is not implemented");
      }
      await api.cancelEnhancementQueue(activeQueue.id);

      // Refetch authoritative queue state
      if (api.getActiveQueueWithItems) {
        const updated = await api.getActiveQueueWithItems(account.id);
        setActiveQueueWithItems(updated);
        setActiveQueue(updated ? updated.job : null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Yêu cầu hủy thất bại.");
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleResolveQueue(
    disposition: "ABANDON_UNRESOLVED" = "ABANDON_UNRESOLVED",
    note?: string | null,
  ) {
    if (!activeQueue) return;
    setIsResolving(true);
    setActionError(null);

    try {
      if (!api.resolveManualReviewQueue) {
        throw new Error("resolveManualReviewQueue is not implemented");
      }
      await api.resolveManualReviewQueue(activeQueue.id, disposition, note);

      // Refetch authoritative queue state
      if (api.getActiveQueueWithItems) {
        const updated = await api.getActiveQueueWithItems(account.id);
        setActiveQueueWithItems(updated);
        setActiveQueue(updated ? updated.job : null);
      }
      if (api.getRecentQueueHistory) {
        const hist = await api.getRecentQueueHistory(account.id, 5);
        setQueueHistory(hist);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Xử lý hàng đợi thất bại.");
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Legacy Global Control Settings (Preserved Exactly) */}
      <Card className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-2">
            <IconSparkle className="size-4 text-accent" />
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Cấu hình cường hóa tự động (Toàn cục)
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Thiết lập điều kiện dừng và loại bùa sử dụng cho hệ thống tự động.
          </p>
        </div>

        <div className="divide-y divide-border/40 px-4 sm:px-5">
          {legacyFields.map((field) => (
            <div
              key={`${field.path}-${resetKey}`}
              className="py-2.5 first:pt-2.5 last:pb-2.5"
            >
              <ConfigFieldInput
                field={field}
                value={draft[field.path] ?? ""}
                values={draft}
                error={errors[field.path]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* 2. Interactive Bag Inventory Grid */}
      <Card className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                Túi đồ & Chọn trang bị cường hóa
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Chọn trang bị trong túi đồ để đưa vào danh sách dự thảo cường hóa.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  freshness.isStale
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                }`}
                title={freshness.ageSeconds != null ? `Độ trễ snapshot: ${freshness.ageSeconds}s` : undefined}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    freshness.isStale ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
                  }`}
                />
                {freshness.text}
              </span>
              <button
                type="button"
                id="refresh-inventory-btn"
                onClick={handleRefreshInventory}
                disabled={isRefreshingInventory}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-elevated disabled:opacity-50 transition-colors"
                title="Làm mới túi đồ từ snapshot mới nhất"
              >
                <IconRefresh className={`size-3.5 ${isRefreshingInventory ? "animate-spin text-accent" : ""}`} />
                <span>Làm mới</span>
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <InventoryBagGrid
            inventory={liveInventory}
            isAvailable={isAvailable}
            accountStatus={account.status}
            selectedSlots={selectedSlots}
            staleSlots={staleSlots}
            onSelectItem={handleSelectItem}
          />
        </div>
      </Card>

      {/* 3. Ordered Enhancement Queue Progress or Draft & Dispatch */}
      <Card className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="p-4 sm:p-5">
          {activeQueueWithItems ? (
            <EnhancementQueueProgress
              activeQueue={activeQueueWithItems}
              history={queueHistory}
              onPauseQueue={handlePauseQueue}
              onCancelQueue={handleCancelQueue}
              onResolveQueue={handleResolveQueue}
              onDismissQueue={handleDismissQueue}
              isPausing={isPausing}
              isCancelling={isCancelling}
              isResolving={isResolving}
              errorMessage={actionError}
            />
          ) : (
            <EnhancementQueueDraft
              queue={validatedQueue}
              onRemove={handleRemove}
              onReorder={handleReorder}
              onUpdateTargetLevel={handleUpdateTargetLevel}
              onUpdatePaymentType={handleUpdatePaymentType}
              onUpdateCharmMode={handleUpdateCharmMode}
              onClearQueue={handleClearQueue}
              onStartQueue={handleStartQueue}
              isStarting={isStarting}
              canStartQueue={isQueueCapable}
              startDisabledReason={
                !isQueueCapable
                  ? "Máy chủ chưa kích hoạt capability enhancement-queue-v1 hoặc đang mất kết nối."
                  : undefined
              }
              activeQueue={activeQueue}
              onPauseQueue={handlePauseQueue}
              onCancelQueue={handleCancelQueue}
              isPausing={isPausing}
              isCancelling={isCancelling}
              errorMessage={actionError}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function IconSparkle({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 1a.75.75 0 01.7.48l1.37 3.56 3.56 1.37a.75.75 0 010 1.4l-3.56 1.37L8.7 12.8a.75.75 0 01-1.4 0L5.93 9.24 2.37 7.87a.75.75 0 010-1.4l3.56-1.37L7.3 1.48A.75.75 0 018 1z" />
    </svg>
  );
}

function IconRefresh({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 8a5.5 5.5 0 11-1.61-3.89L14 6m0-4v4h-4" />
    </svg>
  );
}

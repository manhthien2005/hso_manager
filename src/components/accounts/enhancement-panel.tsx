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
import {
  type EnhancementQueueEntry,
  type InventoryItemCatalog,
  addQueueEntry,
  getInventoryFreshness,
  isInventoryAvailable,
  removeQueueEntry,
  reorderQueueEntry,
  updateQueueEntryTargetLevel,
  updateQueueEntryMaxAttempts,
  updateQueueEntryPaymentType,
  updateQueueEntryCharmMode,
  validateQueue,
} from "@/lib/inventory";
import {
  isEnhancementQueueV2AvailableOnDevice,
  isEnhancementMultilevelAvailableOnDevice,
  isEnhancementDegradeRetryAvailableOnDevice,
} from "@/lib/capabilities";
import { draftToSubmissionPayload, validateQueueDraft } from "@/lib/queue";
import { api } from "@/services/api";
import { type AuthoritativeQueueWithItems } from "@/lib/queue-progress";
import { EligibleEquipmentView } from "./eligible-equipment-view";
import { EnhancementQueueDraft } from "./enhancement-queue-draft";
import { EnhancementQueueProgress } from "./enhancement-queue-progress";

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

export function EnhancementPanel(props: EnhancementPanelProps) {
  const { account, device } = props;
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
  const [refreshError, setRefreshError] = useState<string | null>(null);

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
  const freshness = getInventoryFreshness(
    activeSnapshot,
    account.runtime_updated_at ?? account.updated_at,
  );

  // Capability gates: Start Queue requires enhancement-queue-v2 and enhancement-degrade-retry-v1; multi-level requires enhancement-multilevel-v1
  const isQueueCapable =
    isEnhancementQueueV2AvailableOnDevice(device) &&
    isEnhancementDegradeRetryAvailableOnDevice(device);
  const isMultilevelCapable = isEnhancementMultilevelAvailableOnDevice(device);

  // Derive validated queue reactively without calling setState inside an effect
  const validatedQueue = useMemo(() => {
    if (queue.length === 0) return queue;
    const validated = validateQueue(queue, isAvailable ? liveInventory : null);
    if (!isMultilevelCapable) {
      return validated.map((entry) => ({
        ...entry,
        target_level: Math.min(entry.target_level, entry.reference.expected_level + 1),
      }));
    }
    return validated;
  }, [queue, isAvailable, liveInventory, isMultilevelCapable]);

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

  // Selected slots set for bag grid / eligible list rendering
  const selectedSlots = useMemo(() => {
    return new Set(
      validatedQueue
        .filter((entry) => entry.status === "VALID")
        .map((entry) => entry.reference.captured_slot),
    );
  }, [validatedQueue]);

  function handleSelectItem(item: InventoryItemCatalog) {
    if (!item.candidate_for_enhancement) return;
    setActionError(null);

    setQueue((current) => {
      const alreadyQueued = current.some(
        (entry) => entry.reference.captured_slot === item.slot,
      );

      // Duplicate queue add blocked
      if (alreadyQueued) {
        return current;
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
    const entry = queue.find((e) => e.id === id);
    const maxTarget = !isMultilevelCapable && entry ? entry.reference.expected_level + 1 : 15;
    const clampedTarget = Math.min(targetLevel, maxTarget);
    setQueue((current) => updateQueueEntryTargetLevel(current, id, clampedTarget));
  }

  function handleUpdateMaxAttempts(id: string, maxAttempts: number) {
    setQueue((current) => updateQueueEntryMaxAttempts(current, id, maxAttempts));
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
    if (isStarting) return; // Prevent duplicate click
    if (!isQueueCapable) {
      setActionError("Runtime hiện tại chưa hỗ trợ hàng đợi cường hóa v2 (cần token enhancement-queue-v2).");
      return;
    }

    const hasMultilevelItem = validatedQueue.some(
      (entry) => entry.target_level > entry.reference.expected_level + 1,
    );
    if (hasMultilevelItem && !isMultilevelCapable) {
      setActionError(
        "Runtime hiện tại chưa hỗ trợ cường hóa nhiều cấp (cần token capability enhancement-multilevel-v1).",
      );
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
    setRefreshError(null);
    try {
      if (api.getAccount) {
        const fresh = await api.getAccount(account.id);
        if (fresh?.snapshot) {
          setRefreshedSnapshot(fresh.snapshot);
        } else {
          setRefreshError("Không nhận được snapshot mới từ runtime.");
        }
      }
    } catch (err) {
      console.error("[EnhancementPanel] refresh inventory error:", err);
      setRefreshError(err instanceof Error ? err.message : "Làm mới dữ liệu túi đồ thất bại.");
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
    <div className="space-y-4">
      {/* 1. One Compact Page Header with Readiness Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold text-foreground tracking-tight">Cường hóa</h2>
          <span
            id="enhancement-runtime-readiness-badge"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isQueueCapable
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-warning/10 text-warning border border-warning/20"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                isQueueCapable ? "bg-emerald-400" : "bg-warning"
              }`}
            />
            {isQueueCapable ? "Sẵn sàng" : "Chưa hỗ trợ hàng đợi"}
          </span>
        </div>

        <div className="text-xs text-muted">
          Nhân vật: <span className="font-medium text-foreground">{account.characterName ?? account.label ?? account.id.slice(0, 8)}</span>
          {" • "}
          Trạng thái: <span className="text-foreground">{account.status === "running" ? "Hoạt động" : "Tạm dừng"}</span>
        </div>
      </div>

      {/* 2. Primary Layout: Two Logical Areas (Eligible Equipment + Queue) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Eligible Equipment (Primary View) */}
        <div className="lg:col-span-7 space-y-4">
          <EligibleEquipmentView
            inventory={liveInventory}
            isAvailable={isAvailable}
            accountStatus={account.status}
            queuedSlots={selectedSlots}
            onAddToQueue={handleSelectItem}
            onRefresh={handleRefreshInventory}
            isRefreshing={isRefreshingInventory}
            freshness={freshness}
            refreshError={refreshError}
          />
        </div>

        {/* Right Column: Queue (Progress if active/retained, Draft if idle) */}
        <div className="lg:col-span-5 space-y-4">
          {activeQueueWithItems ? (
            <EnhancementQueueProgress
              activeQueue={activeQueueWithItems}
              history={queueHistory}
              snapshot={activeSnapshot}
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
              onUpdateMaxAttempts={handleUpdateMaxAttempts}
              onUpdatePaymentType={handleUpdatePaymentType}
              onUpdateCharmMode={handleUpdateCharmMode}
              onClearQueue={handleClearQueue}
              onStartQueue={handleStartQueue}
              isStarting={isStarting}
              canStartQueue={isQueueCapable}
              startDisabledReason={
                !isQueueCapable
                  ? "Máy chủ chưa kích hoạt capability enhancement-queue-v2 / enhancement-degrade-retry-v1 hoặc đang mất kết nối."
                  : undefined
              }
              isMultilevelCapable={isMultilevelCapable}
              multilevelDisabledReason={
                !isMultilevelCapable
                  ? "Runtime thiết bị hiện tại chưa hỗ trợ cường hóa nhiều cấp (+2 trở lên). Chỉ có thể cường hóa từng cấp (+1)."
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
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Account,
  Device,
  EnhancementCharmMode,
  EnhancementPaymentType,
  EnhancementQueueJob,
} from "@/lib/types";
import type { ConfigDraft, ConfigErrors, ConfigPath, ConfigValue } from "@/lib/config-schema";
import { CONTROL_SCHEMA } from "@/lib/config-schema";
import {
  type EnhancementQueueEntry,
  type InventoryItemCatalog,
  addQueueEntry,
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
import { InventoryBagGrid } from "./inventory-bag-grid";
import { EnhancementQueueDraft } from "./enhancement-queue-draft";
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
  const [isStarting, setIsStarting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const liveInventory = account.snapshot?.inventory ?? null;
  const isAvailable = isInventoryAvailable(account.status, account.snapshot);

  // Derive validated queue reactively without calling setState inside an effect
  const validatedQueue = useMemo(() => {
    if (queue.length === 0) return queue;
    return validateQueue(queue, isAvailable ? liveInventory : null);
  }, [queue, isAvailable, liveInventory]);

  // Capability gate: Start Queue requires enhancement-queue-v1 token and fresh online device
  const isQueueCapable = isEnhancementQueueAvailableOnDevice(device);

  // Fetch active queue on mount and when account changes
  useEffect(() => {
    let cancelled = false;

    async function loadActiveQueue() {
      try {
        if (api.getActiveEnhancementQueue) {
          const active = await api.getActiveEnhancementQueue(account.id);
          if (!cancelled) {
            setActiveQueue(active);
          }
        }
      } catch {
        // Fallback silently if active queue check fails
      }
    }

    void loadActiveQueue();
    return () => {
      cancelled = true;
    };
  }, [account.id]);

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

      setActiveQueue(job);
      setQueue([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Xuất bản hàng đợi thất bại.");
    } finally {
      setIsStarting(false);
    }
  }

  async function handlePauseQueue() {
    if (!activeQueue) return;
    setIsPausing(true);
    setActionError(null);

    try {
      if (!api.pauseEnhancementQueue) {
        throw new Error("pauseEnhancementQueue is not implemented");
      }
      const updated = await api.pauseEnhancementQueue(activeQueue.id);
      setActiveQueue(updated);
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
      const updated = await api.cancelEnhancementQueue(activeQueue.id);
      setActiveQueue(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Yêu cầu hủy thất bại.");
    } finally {
      setIsCancelling(false);
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

      {/* 3. Ordered Enhancement Queue Draft & Dispatch */}
      <Card className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="p-4 sm:p-5">
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

"use client";

import { useEffect, useMemo, useState } from "react";
import type { Account } from "@/lib/types";
import type { ConfigDraft, ConfigErrors, ConfigPath, ConfigValue, ConfigField } from "@/lib/config-schema";
import { CONTROL_SCHEMA } from "@/lib/config-schema";
import {
  type EnhancementQueueEntry,
  type InventoryItemCatalog,
  addQueueEntry,
  isInventoryAvailable,
  removeQueueEntry,
  reorderQueueEntry,
  updateQueueEntryTargetLevel,
  validateQueue,
} from "@/lib/inventory";
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
  resetKey = 0,
  ctlVersion = 14,
}: EnhancementPanelProps) {
  // Extract legacy enhance fields from schema
  const schemaSections = CONTROL_SCHEMA[ctlVersion] ?? CONTROL_SCHEMA[14] ?? CONTROL_SCHEMA[13];
  const enhanceSection = schemaSections?.find((s) => s.id === "enhance");
  const legacyFields = enhanceSection?.fields ?? [];

  // Local-only state for enhancement queue draft
  const [queue, setQueue] = useState<EnhancementQueueEntry[]>([]);

  const liveInventory = account.snapshot?.inventory ?? null;
  const isAvailable = isInventoryAvailable(account.status, account.snapshot);

  // Re-check queue whenever live inventory snapshot or account status changes
  useEffect(() => {
    setQueue((currentQueue) => {
      if (currentQueue.length === 0) return currentQueue;
      return validateQueue(currentQueue, isAvailable ? liveInventory : null);
    });
  }, [liveInventory, isAvailable, account.status]);

  // Selected slots set for bag grid rendering
  const selectedSlots = useMemo(() => {
    return new Set(
      queue
        .filter((entry) => entry.status === "VALID")
        .map((entry) => entry.reference.captured_slot),
    );
  }, [queue]);

  const staleSlots = useMemo(() => {
    return new Set(
      queue
        .filter((entry) => entry.status === "STALE_SELECTION")
        .map((entry) => entry.reference.captured_slot),
    );
  }, [queue]);

  function handleSelectItem(item: InventoryItemCatalog) {
    if (!item.candidate_for_enhancement) return;

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
    setQueue((current) => removeQueueEntry(current, id));
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    setQueue((current) => reorderQueueEntry(current, fromIndex, toIndex));
  }

  function handleUpdateTargetLevel(id: string, targetLevel: number) {
    setQueue((current) => updateQueueEntryTargetLevel(current, id, targetLevel));
  }

  function handleClearQueue() {
    setQueue([]);
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

      {/* 3. Ordered Enhancement Queue Draft */}
      <Card className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="p-4 sm:p-5">
          <EnhancementQueueDraft
            queue={queue}
            onRemove={handleRemove}
            onReorder={handleReorder}
            onUpdateTargetLevel={handleUpdateTargetLevel}
            onClearQueue={handleClearQueue}
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

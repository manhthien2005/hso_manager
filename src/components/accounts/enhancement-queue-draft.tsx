"use client";

import type { EnhancementCharmMode, EnhancementPaymentType, EnhancementQueueJob } from "@/lib/types";
import type { EnhancementQueueEntry } from "@/lib/inventory";
import { Button } from "@/components/ui/button";

interface EnhancementQueueDraftProps {
  queue: EnhancementQueueEntry[];
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onUpdateTargetLevel: (id: string, targetLevel: number) => void;
  onUpdateMaxAttempts?: (id: string, maxAttempts: number) => void;
  onUpdatePaymentType?: (id: string, paymentType: EnhancementPaymentType) => void;
  onUpdateCharmMode?: (id: string, charmMode: EnhancementCharmMode) => void;
  onClearQueue: () => void;
  onStartQueue?: () => void;
  isStarting?: boolean;
  canStartQueue?: boolean;
  startDisabledReason?: string;
  isMultilevelCapable?: boolean;
  multilevelDisabledReason?: string;
  activeQueue?: EnhancementQueueJob | null;
  onPauseQueue?: () => void;
  onCancelQueue?: () => void;
  isPausing?: boolean;
  isCancelling?: boolean;
  errorMessage?: string | null;
}

export function EnhancementQueueDraft({
  queue,
  onRemove,
  onReorder,
  onUpdateTargetLevel,
  onUpdateMaxAttempts,
  onUpdatePaymentType,
  onUpdateCharmMode,
  onClearQueue,
  onStartQueue,
  isStarting = false,
  canStartQueue = false,
  startDisabledReason,
  isMultilevelCapable = false,
  multilevelDisabledReason,
  activeQueue,
  onPauseQueue,
  onCancelQueue,
  isPausing = false,
  isCancelling = false,
  errorMessage,
}: EnhancementQueueDraftProps) {
  const hasActiveQueue = Boolean(
    activeQueue &&
      ["QUEUED", "RUNNING", "PAUSING", "PAUSED", "MANUAL_REVIEW_REQUIRED"].includes(
        activeQueue.status,
      ),
  );

  const hasStale = queue.some((e) => e.status === "STALE_SELECTION");
  const isStartDisabled =
    queue.length === 0 ||
    !canStartQueue ||
    isStarting ||
    hasActiveQueue ||
    hasStale;

  let disabledExplanation = "";
  if (hasActiveQueue) {
    disabledExplanation = "Hàng đợi đang hoạt động. Vui lòng đợi hoàn tất hoặc hủy trước.";
  } else if (!canStartQueue) {
    disabledExplanation = startDisabledReason ?? "Runtime chưa hỗ trợ token capability enhancement-queue-v1.";
  } else if (hasStale) {
    disabledExplanation = "Một số trang bị đã bị lệch vị trí. Vui lòng làm mới túi đồ và chọn lại.";
  } else if (queue.length === 0) {
    disabledExplanation = "Chưa có trang bị nào trong hàng đợi. Nhấn '+' ở danh sách trang bị để thêm.";
  }

  return (
    <div className="rounded-lg border border-border bg-surface shadow-xs overflow-hidden">
      {/* 1. Queue Draft Header */}
      <div className="border-b border-border/70 bg-elevated/30 px-3.5 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Hàng đợi cường hóa
            </h3>
            <span
              id="enhancement-queue-count-badge"
              className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent"
            >
              {queue.length}
            </span>
          </div>

          {queue.length > 0 && !hasActiveQueue ? (
            <button
              type="button"
              id="clear-queue-btn"
              onClick={onClearQueue}
              className="text-xs text-muted hover:text-danger transition-colors font-medium"
            >
              Xóa tất cả
            </button>
          ) : null}
        </div>
      </div>

      <div className="p-3 sm:p-4 space-y-3.5">
        {/* Active Queue Status Banner (if active) */}
        {hasActiveQueue && activeQueue ? (
          <div
            id="enhancement-queue-active-banner"
            className="rounded-lg border border-accent/40 bg-accent/10 p-3 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-accent animate-pulse" />
                <span className="font-semibold text-foreground">Hàng đợi đang chạy</span>
                <span className="rounded bg-surface px-1.5 py-0.2 font-mono text-[10px] font-bold text-accent">
                  {activeQueue.status}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {activeQueue.status === "QUEUED" || activeQueue.status === "RUNNING" ? (
                  <Button
                    id="pause-enhancement-queue-btn"
                    variant="secondary"
                    size="sm"
                    onClick={onPauseQueue}
                    disabled={isPausing || Boolean(activeQueue.pauseRequestedAt)}
                    className="text-xs h-7 px-2"
                  >
                    {activeQueue.pauseRequestedAt ? "Đang dừng..." : isPausing ? "..." : "Tạm dừng"}
                  </Button>
                ) : null}
                <Button
                  id="cancel-enhancement-queue-btn"
                  variant="danger"
                  size="sm"
                  onClick={onCancelQueue}
                  disabled={isCancelling || Boolean(activeQueue.cancelRequestedAt)}
                  className="text-xs h-7 px-2"
                >
                  {activeQueue.cancelRequestedAt ? "Đang hủy..." : isCancelling ? "..." : "Hủy"}
                </Button>
              </div>
            </div>
            <div className="text-[11px] text-muted">
              Đã xử lý: <strong className="text-foreground">{activeQueue.completedItems}/{activeQueue.totalItems}</strong> mục
            </div>
          </div>
        ) : null}

        {/* Runtime Capability Banner when not capable */}
        {!canStartQueue && !hasActiveQueue ? (
          <div
            id="enhancement-queue-capability-warning"
            className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs text-muted flex items-start gap-2"
          >
            <IconAlert className="size-4 shrink-0 text-warning mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-warning">Runtime chưa hỗ trợ hàng đợi</p>
              <p className="text-[11px] leading-relaxed">
                {startDisabledReason ??
                  "Máy chủ hiện tại chưa báo cáo capability enhancement-queue-v1 hoặc đang ngoại tuyến."}
              </p>
            </div>
          </div>
        ) : null}

        {/* Multilevel Capability Note when runtime only supports single-level */}
        {canStartQueue && !isMultilevelCapable && !hasActiveQueue && queue.length > 0 ? (
          <div
            id="enhancement-queue-multilevel-note"
            className="rounded-md border border-border/70 bg-elevated/30 p-2.5 text-xs text-muted flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="size-1.5 rounded-full bg-accent/70 shrink-0" />
              <span className="text-[11px] text-foreground/80 leading-tight">
                {multilevelDisabledReason ??
                  "Runtime hiện tại chỉ hỗ trợ cường hóa từng cấp (+1). Cường hóa nhiều cấp (+2 trở lên) chưa khả dụng."}
              </span>
            </div>
            <span
              id="enhancement-queue-single-level-badge"
              className="rounded bg-surface px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted shrink-0 border border-border"
            >
              Chỉ +1
            </span>
          </div>
        ) : null}

        {/* Error Message Alert */}
        {errorMessage ? (
          <div
            id="enhancement-queue-error-banner"
            className="rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger flex items-start gap-2"
          >
            <IconAlert className="size-4 shrink-0 text-danger mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold">Thao tác không thành công</p>
              <p className="text-[11px] font-mono">{errorMessage}</p>
            </div>
          </div>
        ) : null}

        {/* Queue Items List */}
        {queue.length === 0 ? (
          <div
            id="enhancement-queue-empty"
            className="rounded-lg border border-dashed border-border/70 p-6 text-center text-muted"
          >
            <p className="text-xs font-medium text-foreground">Hàng đợi trống</p>
            <p className="mt-1 text-[11px] text-muted max-w-xs mx-auto">
              Nhấn nút &apos;+&apos; trên các trang bị ở danh sách bên cạnh để thêm vào hàng đợi này.
            </p>
          </div>
        ) : (
          <div id="enhancement-queue-list" className="space-y-2">
            {queue.map((entry, index) => {
              const isFirst = index === 0;
              const isLast = index === queue.length - 1;
              const isStale = entry.status === "STALE_SELECTION";
              const minTarget = entry.reference.expected_level + 1;
              const maxTarget = isMultilevelCapable ? 15 : minTarget;
              const targetLevels = Array.from(
                { length: Math.max(0, maxTarget - minTarget + 1) },
                (_, i) => minTarget + i,
              );

              return (
                <div
                  key={entry.id}
                  id={`queue-entry-${entry.id}`}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    isStale
                      ? "border-warning/50 bg-warning/5 ring-1 ring-warning/30"
                      : "border-border/80 bg-elevated/40"
                  }`}
                >
                  {/* Top row: Order, Name, Current Level -> Target Level, Remove */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-[10px] font-bold text-muted border border-border">
                        #{index + 1}
                      </span>
                      <span className="font-medium text-xs text-foreground truncate" title={entry.reference.captured_display_name}>
                        {entry.reference.captured_display_name}
                      </span>
                      {isStale ? (
                        <span
                          id={`queue-entry-stale-badge-${entry.id}`}
                          className="rounded border border-warning/40 bg-warning/15 px-1 py-0.2 font-mono text-[9px] font-semibold text-warning shrink-0"
                        >
                          Cần chọn lại
                        </span>
                      ) : null}
                    </div>

                    {/* Reorder and Remove Actions */}
                    {!hasActiveQueue ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label="Di chuyển lên"
                          disabled={isFirst}
                          onClick={() => onReorder(index, index - 1)}
                          className="flex size-6 items-center justify-center rounded border border-border bg-surface text-[10px] text-muted hover:text-foreground disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="Di chuyển xuống"
                          disabled={isLast}
                          onClick={() => onReorder(index, index + 1)}
                          className="flex size-6 items-center justify-center rounded border border-border bg-surface text-[10px] text-muted hover:text-foreground disabled:opacity-30"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          aria-label="Xóa khỏi hàng đợi"
                          onClick={() => onRemove(entry.id)}
                          className="flex size-6 items-center justify-center rounded border border-border/70 bg-surface text-[11px] text-muted hover:text-danger hover:border-danger/40"
                        >
                          ✕
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Bottom Controls Row: Level target, Payment, Charm */}
                  <div className="mt-2 pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Target Level */}
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted">Mục tiêu:</span>
                        <select
                          id={`target-lv-${entry.id}`}
                          value={entry.target_level}
                          disabled={hasActiveQueue}
                          onChange={(e) => onUpdateTargetLevel(entry.id, Number(e.target.value))}
                          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs font-semibold text-accent focus:border-accent focus:outline-hidden disabled:opacity-50"
                        >
                          {targetLevels.map((lv) => (
                            <option key={lv} value={lv}>
                              +{lv}
                            </option>
                          ))}
                        </select>
                        {!isMultilevelCapable ? (
                          <span
                            id={`target-lv-single-cap-${entry.id}`}
                            className="text-[10px] text-muted/70 font-mono ml-0.5"
                            title="Runtime chỉ hỗ trợ tăng 1 cấp mỗi lần"
                          >
                            (Tối đa +1)
                          </span>
                        ) : null}
                      </div>

                      {/* Payment Method */}
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted">Tiền:</span>
                        <select
                          id={`payment-type-${entry.id}`}
                          value={entry.payment_type ?? "GOLD"}
                          disabled={hasActiveQueue}
                          onChange={(e) =>
                            onUpdatePaymentType?.(
                              entry.id,
                              e.target.value as EnhancementPaymentType,
                            )
                          }
                          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground focus:border-accent focus:outline-hidden disabled:opacity-50"
                        >
                          <option value="GOLD">Vàng</option>
                          <option value="GEMS">Ngọc</option>
                        </select>
                      </div>

                      {/* Charm Mode */}
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted">Bùa:</span>
                        <select
                          id={`charm-mode-${entry.id}`}
                          value={entry.charm_mode ?? "NONE"}
                          disabled={hasActiveQueue}
                          onChange={(e) =>
                            onUpdateCharmMode?.(
                              entry.id,
                              e.target.value as EnhancementCharmMode,
                            )
                          }
                          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground focus:border-accent focus:outline-hidden disabled:opacity-50"
                        >
                          <option value="NONE">Không</option>
                          <option value="CO_3_LA">Cỏ 3 lá</option>
                          <option value="CO_4_LA">Cỏ 4 lá</option>
                          <option value="AUTO_POLICY">Tự động</option>
                        </select>
                      </div>

                      {/* Max Attempts Cap */}
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-muted">Giới hạn lượt:</span>
                        <input
                          type="number"
                          id={`max-attempts-${entry.id}`}
                          min={1}
                          max={100}
                          value={entry.max_attempts ?? 10}
                          disabled={hasActiveQueue}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            onUpdateMaxAttempts?.(entry.id, isNaN(val) ? 10 : Math.max(1, Math.min(100, val)));
                          }}
                          className="w-12 rounded border border-border bg-surface px-1 py-0.5 text-xs font-semibold text-foreground focus:border-accent focus:outline-hidden disabled:opacity-50 text-center font-mono"
                          title="Số lượt cường hóa thực tế tối đa trước khi dừng an toàn (mặc định 10)"
                        />
                      </div>
                    </div>

                    <div className="text-[10px] text-muted/60 font-mono">
                      Ô {entry.reference.captured_slot + 1}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Start Action Area */}
        <div className="pt-2 border-t border-border/60 space-y-2">
          {disabledExplanation && !isStarting ? (
            <p className="text-[11px] text-muted leading-tight">
              {disabledExplanation}
            </p>
          ) : null}

          <Button
            id="start-enhancement-queue-btn"
            onClick={onStartQueue}
            disabled={isStartDisabled}
            className="w-full font-semibold text-xs py-2 bg-accent text-accent-contrast hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isStarting ? (
              <span className="inline-flex items-center gap-1.5">
                <IconSpinner className="size-3.5 animate-spin" />
                <span>Đang xuất bản hàng đợi...</span>
              </span>
            ) : hasActiveQueue ? (
              "Hàng đợi đang chạy"
            ) : (
              "Bắt đầu cường hóa"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function IconAlert({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2.5l5.5 10H2.5L8 2.5z" />
      <path strokeLinecap="round" d="M8 6.5v3M8 11.5h.01" />
    </svg>
  );
}

function IconSpinner({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeLinecap="round" opacity="0.3" />
      <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
    </svg>
  );
}

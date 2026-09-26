"use client";

import type { EnhancementCharmMode, EnhancementPaymentType, EnhancementQueueJob } from "@/lib/types";
import type { EnhancementQueueEntry } from "@/lib/inventory";
import { Button } from "@/components/ui/button";

interface EnhancementQueueDraftProps {
  queue: EnhancementQueueEntry[];
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onUpdateTargetLevel: (id: string, targetLevel: number) => void;
  onUpdatePaymentType?: (id: string, paymentType: EnhancementPaymentType) => void;
  onUpdateCharmMode?: (id: string, charmMode: EnhancementCharmMode) => void;
  onClearQueue: () => void;
  onStartQueue?: () => void;
  isStarting?: boolean;
  canStartQueue?: boolean;
  startDisabledReason?: string;
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
  onUpdatePaymentType,
  onUpdateCharmMode,
  onClearQueue,
  onStartQueue,
  isStarting = false,
  canStartQueue = false,
  startDisabledReason,
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

  return (
    <div className="space-y-4">
      {/* Header and Queue Meta */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">
              Hàng đợi cường hóa trang bị
            </h4>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
              {queue.length} trang bị
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Danh sách trang bị lập kế hoạch nâng cấp theo thứ tự ưu tiên.
          </p>
        </div>

        {queue.length > 0 && !hasActiveQueue ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearQueue}
            className="text-xs text-muted hover:text-danger"
          >
            Xóa danh sách
          </Button>
        ) : null}
      </div>

      {/* Active Queue Status Banner */}
      {hasActiveQueue && activeQueue ? (
        <div
          id="enhancement-queue-active-banner"
          className="rounded-lg border border-accent/40 bg-accent/10 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-accent animate-pulse" />
              <span className="font-semibold text-sm text-foreground">
                Hàng đợi đang hoạt động
              </span>
              <span className="rounded border border-accent/40 bg-surface px-2 py-0.5 font-mono text-xs font-semibold text-accent">
                {activeQueue.status}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Pause Button */}
              {activeQueue.status === "QUEUED" || activeQueue.status === "RUNNING" ? (
                <Button
                  id="pause-enhancement-queue-btn"
                  variant="secondary"
                  size="sm"
                  onClick={onPauseQueue}
                  disabled={isPausing || Boolean(activeQueue.pauseRequestedAt)}
                  className="text-xs"
                >
                  {activeQueue.pauseRequestedAt
                    ? "Đang chờ dừng..."
                    : isPausing
                      ? "Đang gửi..."
                      : "Tạm dừng"}
                </Button>
              ) : null}

              {/* Cancel Button */}
              <Button
                id="cancel-enhancement-queue-btn"
                variant="danger"
                size="sm"
                onClick={onCancelQueue}
                disabled={isCancelling || Boolean(activeQueue.cancelRequestedAt)}
                className="text-xs"
              >
                {activeQueue.cancelRequestedAt
                  ? "Đang chờ hủy..."
                  : isCancelling
                    ? "Đang gửi..."
                    : "Hủy hàng đợi"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted">
            <div>Mã Job: <span className="font-mono text-foreground">{activeQueue.id.slice(0, 8)}...</span></div>
            <div>Tổng số mục: <span className="font-medium text-foreground">{activeQueue.totalItems}</span></div>
            <div>Đã xử lý: <span className="font-medium text-foreground">{activeQueue.completedItems}</span></div>
            <div>Khởi tạo: <span className="text-foreground">{new Date(activeQueue.createdAt).toLocaleTimeString()}</span></div>
          </div>

          {activeQueue.pauseRequestedAt ? (
            <p className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-2">
              Đã ghi nhận yêu cầu tạm dừng. Lượt cường hóa đang thực hiện (nếu có) sẽ hoàn tất trước khi dừng hẳn.
            </p>
          ) : null}

          {activeQueue.cancelRequestedAt ? (
            <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded p-2">
              Đã ghi nhận yêu cầu hủy bỏ. Lượt cường hóa đang thực hiện (nếu có) sẽ hoàn tất trước khi dừng các mục tiếp theo.
            </p>
          ) : null}

          <p className="text-[11px] text-muted/80 leading-relaxed">
            * Hệ thống chạy độc lập trên server/agent. Bạn có thể đóng trình duyệt mà không ảnh hưởng tới tiến trình.
          </p>
        </div>
      ) : null}

      {/* Runtime Capability Banner when not capable */}
      {!canStartQueue && !hasActiveQueue ? (
        <div
          id="enhancement-queue-capability-warning"
          className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted flex items-start gap-2.5"
        >
          <IconAlert className="size-4 shrink-0 text-warning mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-warning">
              Runtime chưa hỗ trợ thực thi hàng đợi (enhancement-queue-v1)
            </p>
            <p className="leading-relaxed">
              {startDisabledReason ??
                "Máy chủ hiện tại chưa báo cáo capability token enhancement-queue-v1 hoặc đang ngoại tuyến. Bạn vẫn có thể chuẩn bị danh sách dự thảo, nhưng nút bắt đầu hàng đợi sẽ bị vô hiệu hóa an toàn."}
            </p>
          </div>
        </div>
      ) : null}

      {/* Error Message Alert */}
      {errorMessage ? (
        <div
          id="enhancement-queue-error-banner"
          className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger flex items-start gap-2.5"
        >
          <IconAlert className="size-4 shrink-0 text-danger mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-danger">Thao tác không thành công</p>
            <p className="leading-relaxed font-mono">{errorMessage}</p>
          </div>
        </div>
      ) : null}

      {/* Queue Items List */}
      {queue.length === 0 ? (
        <div
          id="enhancement-queue-empty"
          className="rounded-lg border border-dashed border-border/70 bg-surface/30 p-8 text-center text-muted"
        >
          <p className="text-sm font-medium text-foreground">
            Chưa có trang bị nào trong hàng đợi
          </p>
          <p className="mt-1 text-xs text-muted max-w-sm mx-auto">
            Nhấp vào bất kỳ trang bị nào có viền sáng trong túi đồ phía trên để thêm vào danh sách dự thảo cường hóa.
          </p>
        </div>
      ) : (
        <div id="enhancement-queue-list" className="space-y-2">
          {queue.map((entry, index) => {
            const isFirst = index === 0;
            const isLast = index === queue.length - 1;
            const isStale = entry.status === "STALE_SELECTION";
            const minTarget = entry.reference.expected_level + 1;
            const targetLevels = Array.from(
              { length: Math.max(0, 16 - minTarget) },
              (_, i) => minTarget + i,
            );

            return (
              <div
                key={entry.id}
                id={`queue-entry-${entry.id}`}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
                  isStale
                    ? "border-warning/50 bg-warning/5 ring-1 ring-warning/30"
                    : "border-border/80 bg-surface/70 hover:border-border"
                }`}
              >
                {/* Left: Position & Item Details */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated font-mono text-xs font-semibold text-muted">
                    {index + 1}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground truncate">
                        {entry.reference.captured_display_name}
                      </span>

                      {/* Status Badge */}
                      {isStale ? (
                        <span
                          id={`queue-entry-stale-badge-${entry.id}`}
                          className="rounded border border-warning/40 bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-warning"
                        >
                          Lệch vị trí / Cần chọn lại
                        </span>
                      ) : (
                        <span
                          id={`queue-entry-valid-badge-${entry.id}`}
                          className="rounded border border-online/35 bg-online/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-online"
                        >
                          Sẵn sàng
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted mt-0.5 flex-wrap">
                      <span>Cấp hiện tại: <strong className="text-foreground">+{entry.reference.expected_level}</strong></span>
                      <span>·</span>
                      <span className="font-mono text-[11px]">Ô {entry.reference.captured_slot + 1}</span>
                      {entry.reference.tier > 0 ? (
                        <>
                          <span>·</span>
                          <span>Tier {entry.reference.tier}</span>
                        </>
                      ) : null}
                    </div>

                    {isStale ? (
                      <p className="text-[11px] text-warning mt-1">
                        Vật phẩm tại ô {entry.reference.captured_slot + 1} đã thay đổi hoặc di chuyển. Vui lòng chọn lại từ túi đồ.
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Right: Target Level, Policy & Controls */}
                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                  {/* Payment Policy */}
                  <div className="flex items-center gap-1">
                    <label
                      htmlFor={`payment-type-${entry.id}`}
                      className="text-xs text-muted whitespace-nowrap"
                    >
                      Tiền:
                    </label>
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
                      className="rounded border border-border bg-elevated px-2 py-1 text-xs font-semibold text-foreground focus:border-accent focus:outline-hidden disabled:opacity-50"
                    >
                      <option value="GOLD">Vàng</option>
                      <option value="GEMS">Ngọc</option>
                    </select>
                  </div>

                  {/* Charm Policy */}
                  <div className="flex items-center gap-1">
                    <label
                      htmlFor={`charm-mode-${entry.id}`}
                      className="text-xs text-muted whitespace-nowrap"
                    >
                      Bùa:
                    </label>
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
                      className="rounded border border-border bg-elevated px-2 py-1 text-xs font-semibold text-foreground focus:border-accent focus:outline-hidden disabled:opacity-50"
                    >
                      <option value="NONE">Không</option>
                      <option value="CO_3_LA">Cỏ 3 lá</option>
                      <option value="CO_4_LA">Cỏ 4 lá</option>
                      <option value="AUTO_POLICY">Tự động</option>
                    </select>
                  </div>

                  {/* Target Level Selector */}
                  <div className="flex items-center gap-1">
                    <label
                      htmlFor={`target-lv-${entry.id}`}
                      className="text-xs text-muted whitespace-nowrap"
                    >
                      Tới:
                    </label>
                    <select
                      id={`target-lv-${entry.id}`}
                      value={entry.target_level}
                      disabled={hasActiveQueue}
                      onChange={(e) => onUpdateTargetLevel(entry.id, Number(e.target.value))}
                      className="rounded border border-border bg-elevated px-2 py-1 text-xs font-semibold text-foreground focus:border-accent focus:outline-hidden disabled:opacity-50"
                    >
                      {targetLevels.map((lv) => (
                        <option key={lv} value={lv}>
                          +{lv}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Reorder Buttons */}
                  {!hasActiveQueue ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Di chuyển lên"
                        disabled={isFirst}
                        onClick={() => onReorder(index, index - 1)}
                        className="flex size-7 items-center justify-center rounded border border-border bg-surface text-xs text-muted hover:text-foreground hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label="Di chuyển xuống"
                        disabled={isLast}
                        onClick={() => onReorder(index, index + 1)}
                        className="flex size-7 items-center justify-center rounded border border-border bg-surface text-xs text-muted hover:text-foreground hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ▼
                      </button>
                    </div>
                  ) : null}

                  {/* Remove Button */}
                  {!hasActiveQueue ? (
                    <button
                      type="button"
                      aria-label="Xóa khỏi hàng đợi"
                      onClick={() => onRemove(entry.id)}
                      className="flex size-7 items-center justify-center rounded border border-border/60 bg-surface text-xs text-muted hover:text-danger hover:border-danger/40 hover:bg-danger/10"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Start Queue Action Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border/60">
        <div className="text-xs text-muted">
          {queue.length > 0 && !hasActiveQueue ? (
            <span>
              Sẵn sàng xuất bản {queue.length} trang bị thành hàng đợi bền vững trên máy chủ.
            </span>
          ) : hasActiveQueue ? (
            <span>Hàng đợi đang chạy. Không thể bắt đầu hàng đợi mới cho tài khoản này.</span>
          ) : (
            <span>Chọn trang bị từ túi đồ phía trên để thiết lập hàng đợi.</span>
          )}
        </div>

        <Button
          id="start-enhancement-queue-btn"
          onClick={onStartQueue}
          disabled={queue.length === 0 || !canStartQueue || isStarting || hasActiveQueue}
          className="font-medium text-xs px-4"
        >
          {isStarting
            ? "Đang xuất bản..."
            : hasActiveQueue
              ? "Hàng đợi đang chạy"
              : "Bắt đầu hàng đợi"}
        </Button>
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

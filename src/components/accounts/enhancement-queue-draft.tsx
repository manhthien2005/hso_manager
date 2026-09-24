"use client";

import type { EnhancementQueueEntry } from "@/lib/inventory";
import { Button } from "@/components/ui/button";

interface EnhancementQueueDraftProps {
  queue: EnhancementQueueEntry[];
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onUpdateTargetLevel: (id: string, targetLevel: number) => void;
  onClearQueue: () => void;
}

export function EnhancementQueueDraft({
  queue,
  onRemove,
  onReorder,
  onUpdateTargetLevel,
  onClearQueue,
}: EnhancementQueueDraftProps) {
  return (
    <div className="space-y-4">
      {/* Header and Queue Meta */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">
              Hàng đợi cường hóa thử nghiệm
            </h4>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
              {queue.length} trang bị
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Danh sách trang bị lập kế hoạch nâng cấp theo thứ tự ưu tiên.
          </p>
        </div>

        {queue.length > 0 ? (
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

      {/* Non-executing Safety Banner */}
      <div
        id="enhancement-queue-non-executing-banner"
        className="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-muted flex items-start gap-2.5"
      >
        <IconInfo className="size-4 shrink-0 text-accent mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-foreground">
            Hàng đợi thử nghiệm / Chưa chạy
          </p>
          <p className="leading-relaxed">
            Tính năng đang ở giai đoạn lập kế hoạch giao diện. Các thay đổi tại đây được lưu cục bộ trên trình duyệt, không làm thay đổi cấu hình điều khiển và chưa gửi lệnh cường hóa vào game.
          </p>
        </div>
      </div>

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

                    <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
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

                {/* Right: Target Level & Controls */}
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  {/* Target Level Selector */}
                  <div className="flex items-center gap-1.5">
                    <label
                      htmlFor={`target-lv-${entry.id}`}
                      className="text-xs text-muted whitespace-nowrap"
                    >
                      Mục tiêu:
                    </label>
                    <select
                      id={`target-lv-${entry.id}`}
                      value={entry.target_level}
                      onChange={(e) => onUpdateTargetLevel(entry.id, Number(e.target.value))}
                      className="rounded-md border border-border bg-elevated px-2 py-1 text-xs font-semibold text-foreground focus:border-accent focus:outline-hidden"
                    >
                      {targetLevels.map((lv) => (
                        <option key={lv} value={lv}>
                          +{lv}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Reorder Buttons */}
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

                  {/* Remove Button */}
                  <button
                    type="button"
                    aria-label="Xóa khỏi hàng đợi"
                    onClick={() => onRemove(entry.id)}
                    className="flex size-7 items-center justify-center rounded border border-border/60 bg-surface text-xs text-muted hover:text-danger hover:border-danger/40 hover:bg-danger/10"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cost Telemetry Foundation (Explicitly Unavailable Placeholder) */}
      <div
        id="enhancement-cost-placeholder"
        className="rounded-lg border border-border/50 bg-elevated/30 p-3 text-xs text-muted"
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">Ước tính chi phí nâng cấp</span>
          <span className="rounded bg-surface px-2 py-0.5 font-mono text-[10px] text-muted">
            Chưa khả dụng
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted/80">
          Chờ dữ liệu đo lường chi phí vàng và tỉ lệ từ runtime. Hệ thống không sử dụng số liệu tính toán giả lập.
        </p>
      </div>
    </div>
  );
}

function IconInfo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path strokeLinecap="round" d="M8 7v4M8 5h.01" />
    </svg>
  );
}

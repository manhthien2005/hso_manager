"use client";

import { useMemo, useState } from "react";
import type {
  EnhancementQueueItem,
  EnhancementQueueJob,
  PlayerSnapshot,
} from "@/lib/types";
import {
  type AuthoritativeQueueWithItems,
  type DerivedQueueSpend,
  ATTEMPT_PHASE_INFO,
  determineItemProgressState,
  isTerminalQueueStatus,
} from "@/lib/queue-progress";
import {
  PIPELINE_STAGES,
  determineCurrentPipelineStage,
  translateEnhancementError,
  type PipelineStageKey,
} from "@/lib/enhancement-status";
import { Button } from "@/components/ui/button";

interface EnhancementQueueProgressProps {
  activeQueue: AuthoritativeQueueWithItems;
  history?: AuthoritativeQueueWithItems[];
  snapshot?: PlayerSnapshot | null;
  onPauseQueue?: () => void;
  onCancelQueue?: () => void;
  onResolveQueue?: (disposition?: "ABANDON_UNRESOLVED", note?: string | null) => void;
  onDismissQueue?: () => void;
  isPausing?: boolean;
  isCancelling?: boolean;
  isResolving?: boolean;
  errorMessage?: string | null;
}

export function EnhancementQueueProgress({
  activeQueue,
  history = [],
  snapshot,
  onPauseQueue,
  onCancelQueue,
  onResolveQueue,
  onDismissQueue,
  isPausing = false,
  isCancelling = false,
  isResolving = false,
  errorMessage,
}: EnhancementQueueProgressProps) {
  const { job, items, derivedSpend } = activeQueue;
  const [showHistory, setShowHistory] = useState(false);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [showErrorTechDetails, setShowErrorTechDetails] = useState(false);

  const itemProgressList = useMemo(() => {
    return determineItemProgressState(items);
  }, [items]);

  const activeItem = useMemo(() => {
    if (job.activeItemId) {
      const found = items.find((i) => i.id === job.activeItemId);
      if (found) return found;
    }
    return items.find((i) => i.status === "RUNNING") ?? null;
  }, [items, job.activeItemId]);

  const completedCount = useMemo(() => {
    return items.filter((i) => i.status === "COMPLETED").length;
  }, [items]);

  const progressPercent = items.length > 0
    ? Math.round((completedCount / items.length) * 100)
    : 0;

  const isManualReview =
    job.status === "MANUAL_REVIEW_REQUIRED" ||
    items.some((i) => i.status === "MANUAL_REVIEW_REQUIRED");

  // Determine current granular human-readable pipeline stage
  const currentStageKey = useMemo<PipelineStageKey>(() => {
    return determineCurrentPipelineStage(job.status, activeItem, snapshot);
  }, [job.status, activeItem, snapshot]);

  const currentStage = PIPELINE_STAGES[currentStageKey];

  // Translated error for FAILED terminal job
  const translatedError = useMemo(() => {
    if (job.status !== "FAILED") return null;
    const effectiveCode = job.errorCode || activeItem?.errorCode;
    const effectiveMsg = job.errorMessage || activeItem?.errorMessage;
    return translateEnhancementError(effectiveCode, effectiveMsg, activeItem?.charmMode);
  }, [job.status, job.errorCode, job.errorMessage, activeItem]);

  return (
    <div id="enhancement-queue-progress-view" className="rounded-lg border border-border bg-surface shadow-xs overflow-hidden">
      {/* 1. Compact Header */}
      <div className="border-b border-border/70 bg-elevated/30 px-3.5 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Tiến trình cường hóa
            </h3>
            <JobStatusBadge status={job.status} resolutionKind={job.resolutionKind} />
            <span
              id="queue-completed-counter"
              className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-muted border border-border"
            >
              {completedCount}/{items.length} hoàn thành
            </span>
          </div>

          {/* Action buttons: Pause, Cancel, Dismiss */}
          <div className="flex items-center gap-1.5">
            {job.status === "QUEUED" || job.status === "RUNNING" ? (
              <Button
                id="pause-enhancement-queue-btn"
                variant="secondary"
                size="sm"
                onClick={onPauseQueue}
                disabled={isPausing || Boolean(job.pauseRequestedAt)}
                className="text-xs h-7 px-2"
              >
                {job.pauseRequestedAt ? "Đang dừng..." : isPausing ? "..." : "Tạm dừng"}
              </Button>
            ) : null}

            {["QUEUED", "RUNNING", "PAUSING", "PAUSED"].includes(job.status) ? (
              <Button
                id="cancel-enhancement-queue-btn"
                variant="danger"
                size="sm"
                onClick={onCancelQueue}
                disabled={isCancelling || Boolean(job.cancelRequestedAt)}
                className="text-xs h-7 px-2"
              >
                {job.cancelRequestedAt ? "Đang hủy..." : isCancelling ? "..." : "Hủy"}
              </Button>
            ) : null}

            {isTerminalQueueStatus(job.status) && onDismissQueue ? (
              <Button
                id="dismiss-terminal-queue-btn"
                variant="secondary"
                size="sm"
                onClick={onDismissQueue}
                className="text-xs h-7 px-2.5 font-medium"
              >
                Đóng kết quả / Tạo mới
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4 space-y-3.5">
        {/* Action Error Alert */}
        {errorMessage ? (
          <div
            id="enhancement-queue-action-error"
            className="rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger"
          >
            {errorMessage}
          </div>
        ) : null}

        {/* 2. Progress Pipeline Bar */}
        <div className="rounded-lg border border-border/70 bg-elevated/40 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted font-medium">Giai đoạn hiện tại:</span>
            <span
              id="pipeline-stage-label"
              className={`font-semibold ${
                currentStage.isError
                  ? "text-danger"
                  : currentStage.isSuccess
                    ? "text-online"
                    : currentStage.isSensitive
                      ? "text-warning animate-pulse"
                      : "text-accent"
              }`}
            >
              {currentStage.label}
            </span>
          </div>

          <p className="text-[11px] text-muted leading-relaxed">
            {currentStage.description}
          </p>

          {/* Overall Progress Line */}
          <div className="pt-1">
            <div className="h-1.5 w-full rounded-full bg-surface border border-border/40 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  job.status === "FAILED"
                    ? "bg-danger"
                    : job.status === "COMPLETED"
                      ? "bg-online"
                      : "bg-accent"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Sensitive post-send ambiguity warning ONLY when actively waiting or sending */}
          {currentStage.isSensitive && job.status === "RUNNING" ? (
            <p
              id="sensitive-post-send-warning"
              className="mt-2 text-[11px] text-warning bg-warning/10 border border-warning/30 rounded p-2 font-medium"
            >
              * Lệnh cường hóa đã được phát đi và đang chờ kết quả từ máy chủ game. Trạng thái nhạy cảm, vui lòng không tắt kết nối.
            </p>
          ) : null}
        </div>

        {/* 3. Prominent FAILED Terminal Banner with Exact Retention */}
        {job.status === "FAILED" && translatedError ? (
          <div
            id="queue-failed-banner"
            className="rounded-lg border-2 border-danger/80 bg-danger/15 p-3.5 space-y-2.5 text-danger"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-tight">
                  {translatedError.title}
                </span>
                {job.errorCode ? (
                  <span className="rounded bg-surface px-1.5 py-0.2 font-mono text-[10px] text-danger border border-danger/40">
                    {job.errorCode}
                  </span>
                ) : null}
              </div>

              {onDismissQueue ? (
                <button
                  type="button"
                  onClick={onDismissQueue}
                  className="rounded border border-danger/40 bg-surface px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/20 transition-colors"
                >
                  Đóng / Tạo hàng đợi mới
                </button>
              ) : null}
            </div>

            <p className="text-xs leading-relaxed text-foreground/90 font-medium">
              {translatedError.detail}
            </p>

            <div className="rounded border border-danger/30 bg-surface/70 p-2 text-xs text-foreground/90 space-y-1">
              <div className="font-semibold text-accent">Hành động khuyến nghị:</div>
              <div className="text-[11px] text-muted">{translatedError.recommendedAction}</div>
            </div>

            {/* Expandable Technical Detail */}
            <div>
              <button
                type="button"
                onClick={() => setShowErrorTechDetails(!showErrorTechDetails)}
                className="text-[11px] text-muted underline hover:text-foreground"
              >
                {showErrorTechDetails ? "Ẩn chi tiết kỹ thuật" : "Xem chi tiết kỹ thuật"}
              </button>
              {showErrorTechDetails ? (
                <div className="mt-1.5 font-mono text-[10px] text-muted/90 bg-elevated/60 p-2 rounded border border-border/40 space-y-0.5">
                  <div>Mã lỗi: {job.errorCode ?? "N/A"}</div>
                  <div>Thông điệp gốc: {job.errorMessage ?? "N/A"}</div>
                  {activeItem ? (
                    <>
                      <div>Vật phẩm: {activeItem.baseName} (Ô {activeItem.capturedSlot + 1})</div>
                      <div>Lỗi mục: {activeItem.errorCode ?? "N/A"} - {activeItem.errorMessage ?? "N/A"}</div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* 4. Prominent MANUAL_REVIEW_REQUIRED Alert Banner */}
        {isManualReview ? (
          <div
            id="manual-review-required-banner"
            className="rounded-lg border-2 border-danger/80 bg-danger/15 p-3.5 space-y-2.5 text-danger"
          >
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-danger animate-ping shrink-0" />
              <span className="font-bold text-xs uppercase tracking-tight">
                Cần kiểm tra thủ công (MANUAL_REVIEW_REQUIRED)
              </span>
            </div>

            <p className="text-xs leading-relaxed text-foreground/90 font-medium">
              Tiến trình cường hóa tự động đã tạm dừng để bảo vệ tài khoản và trang bị.
              Hệ thống không tự động thử lại (Không có tính năng Retry tự động) để tránh rủi ro mất đồ khi trạng thái chưa rõ ràng.
            </p>

            {onResolveQueue && !showResolveConfirm ? (
              <div className="pt-1">
                <Button
                  id="open-resolve-confirm-btn"
                  variant="danger"
                  size="sm"
                  onClick={() => setShowResolveConfirm(true)}
                  disabled={isResolving}
                  className="text-xs font-semibold h-7"
                >
                  Xử lý / Đóng hàng đợi (Giải phóng độc quyền)
                </Button>
              </div>
            ) : null}

            {showResolveConfirm && onResolveQueue ? (
              <div
                id="manual-review-resolve-confirmation"
                className="rounded border border-danger/60 bg-danger/20 p-2.5 space-y-2 text-xs"
              >
                <div className="font-bold text-danger">
                  Xác nhận đóng hàng đợi sau kiểm tra thủ công?
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-foreground/90">
                  <li>Kết quả cường hóa của trang bị đang thử sẽ được ghi nhận là Chưa xác định.</li>
                  <li>Tất cả các trang bị chưa thực hiện còn lại sẽ bị hủy bỏ vĩnh viễn.</li>
                  <li>Độc quyền tài khoản sẽ được giải phóng ngay lập tức.</li>
                </ul>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    id="confirm-resolve-queue-btn"
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      onResolveQueue("ABANDON_UNRESOLVED", "Xác nhận đóng hàng đợi sau kiểm tra thủ công");
                      setShowResolveConfirm(false);
                    }}
                    disabled={isResolving}
                    className="text-xs font-bold h-7"
                  >
                    {isResolving ? "Đang xử lý..." : "Xác nhận đóng"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowResolveConfirm(false)}
                    disabled={isResolving}
                    className="text-xs h-7"
                  >
                    Hủy
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 5. Active Item Focus (if RUNNING) */}
        {activeItem && job.status === "RUNNING" ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-accent animate-pulse" />
                <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                  Mục #{activeItem.queueOrder}: {activeItem.baseName}
                </span>
              </div>
              <span className="font-mono text-[11px] text-muted">
                Đã dùng {activeItem.attemptCount} / {activeItem.maxAttempts ?? 10} lượt
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Tiến độ:</span>
              <span className="font-mono font-bold text-foreground">+{activeItem.currentLevel}</span>
              <span className="text-muted">/ mục tiêu</span>
              <span className="font-mono font-bold text-accent">+{activeItem.targetLevel}</span>
              {activeItem.currentLevel < activeItem.targetLevel ? (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent border border-accent/30">
                  +{activeItem.currentLevel} → +{activeItem.currentLevel + 1}
                </span>
              ) : null}
              <span className="text-muted">·</span>
              <span className="text-[11px] text-muted">Giai đoạn:</span>
              <AttemptPhaseBadge phase={activeItem.attemptPhase} />
            </div>
          </div>
        ) : null}

        {/* 6. Ordered Items Progression List */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-foreground tracking-tight uppercase text-muted">
            Danh sách trang bị trong hàng đợi ({items.length})
          </h4>

          <div className="divide-y divide-border/40 border border-border/70 rounded-lg overflow-hidden bg-surface">
            {itemProgressList.map(({ item, isUnexecutedDueToPriorFailure, displayStatus }) => (
              <div
                key={item.id}
                className={`p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                  item.id === activeItem?.id ? "bg-accent/5" : ""
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded bg-elevated px-1.5 py-0.2 font-mono text-[10px] font-semibold text-muted">
                      #{item.queueOrder}
                    </span>
                    <span className="font-medium text-foreground truncate">
                      {item.baseName}
                    </span>
                    <ItemStatusBadge status={displayStatus} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span>
                      Tiến độ: <strong className={item.currentLevel > item.initialLevel ? "text-online font-bold" : "text-foreground"}>+{item.currentLevel}</strong>
                      <span className="text-muted"> / mục tiêu </span>
                      <strong className="text-accent font-bold">+{item.targetLevel}</strong>
                    </span>
                    {item.status === "RUNNING" && item.currentLevel < item.targetLevel ? (
                      <span className="rounded bg-accent/15 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-accent border border-accent/30">
                        +{item.currentLevel} → +{item.currentLevel + 1}
                      </span>
                    ) : null}
                    <span>·</span>
                    <span>Lượt: <strong className="font-mono text-foreground font-semibold">Đã dùng {item.attemptCount} / {item.maxAttempts ?? 10} lượt</strong></span>
                    <span>·</span>
                    <span>{item.paymentType === "GOLD" ? "Vàng" : "Ngọc"}</span>
                    <span>·</span>
                    <span>{item.charmMode}</span>
                  </div>

                  {item.errorCode || item.errorMessage ? (
                    <div className="text-[11px] text-danger bg-danger/10 border border-danger/20 rounded px-2 py-0.5">
                      Lỗi: {item.errorCode ?? "UNKNOWN"} - {item.errorMessage}
                    </div>
                  ) : null}

                  {isUnexecutedDueToPriorFailure ? (
                    <p className="text-[10px] text-muted italic">
                      Chưa thực hiện (Đã dừng do mục trước đó gặp lỗi)
                    </p>
                  ) : null}
                </div>

                <div className="sm:text-right shrink-0 font-mono text-[11px] text-muted">
                  {item.actualGoldSpent > 0 ? <div>{item.actualGoldSpent.toLocaleString()} Vàng</div> : null}
                  {item.actualGemSpent > 0 ? <div>{item.actualGemSpent.toLocaleString()} Gems</div> : null}
                  {item.actualCharmSpent > 0 ? <div>{item.actualCharmSpent} Bùa</div> : null}
                  {item.actualGoldSpent === 0 && item.actualGemSpent === 0 && item.actualCharmSpent === 0 ? (
                    <span className="text-[10px]">Chưa chi</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7. Actual Spend Summary */}
        <SpendSummaryCard spend={derivedSpend} />

        {/* 8. Terminal History Section */}
        {history.length > 0 ? (
          <div className="pt-1 border-t border-border/50">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="text-xs text-muted hover:text-foreground transition-colors font-medium"
            >
              {showHistory ? "▲ Ẩn lịch sử hàng đợi gần đây" : "▼ Xem lịch sử hàng đợi gần đây"} ({history.length})
            </button>

            {showHistory ? (
              <div className="mt-2.5 space-y-2">
                <div className="divide-y divide-border/40 border border-border/70 rounded-lg overflow-hidden bg-surface">
                  {history.map((hist) => (
                    <div key={hist.job.id} className="p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-foreground">
                            Job {hist.job.id.slice(0, 8)}...
                          </span>
                          <JobStatusBadge status={hist.job.status} resolutionKind={hist.job.resolutionKind} />
                        </div>
                        <span className="text-[10px] text-muted">
                          {hist.job.finishedAt
                            ? new Date(hist.job.finishedAt).toLocaleTimeString()
                            : new Date(hist.job.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      <div className="text-[11px] text-muted">
                        Số mục: <strong className="text-foreground">{hist.items.length}</strong>
                        {" • "}
                        Thành công: <strong className="text-foreground">{hist.items.filter((i) => i.status === "COMPLETED").length}</strong>
                        {" • "}
                        Vàng: <strong className="font-mono text-foreground">{hist.derivedSpend.actualGoldSpent.toLocaleString()}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SpendSummaryCard({ spend }: { spend: DerivedQueueSpend }) {
  return (
    <div className="rounded-lg border border-border/70 bg-elevated/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider text-muted">
          Chi phí thực tế đã hạch toán
        </span>
        <span className="font-mono text-[11px] text-muted">
          Tổng {spend.totalAttemptCount} lượt cường hóa
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
        <div className="rounded border border-border/40 bg-surface p-1.5">
          <span className="text-[10px] text-muted block">Vàng:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualGoldSpent.toLocaleString()}
          </span>
        </div>
        <div className="rounded border border-border/40 bg-surface p-1.5">
          <span className="text-[10px] text-muted block">Ngọc (Gems):</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualGemSpent.toLocaleString()}
          </span>
        </div>
        <div className="rounded border border-border/40 bg-surface p-1.5">
          <span className="text-[10px] text-muted block">Vật liệu 1 & 2:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualMaterial1Spent} / {spend.actualMaterial2Spent}
          </span>
        </div>
        <div className="rounded border border-border/40 bg-surface p-1.5">
          <span className="text-[10px] text-muted block">Bùa đã dùng:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualCharmSpent} bùa
          </span>
        </div>
      </div>
    </div>
  );
}

function JobStatusBadge({
  status,
  resolutionKind,
}: {
  status: EnhancementQueueJob["status"];
  resolutionKind?: string | null;
}) {
  if (status === "CANCELLED" && resolutionKind === "ABANDON_UNRESOLVED") {
    return (
      <span className="rounded border border-warning/60 bg-warning/15 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-warning">
        CANCELLED (RESOLVED)
      </span>
    );
  }

  const styles: Record<string, string> = {
    QUEUED: "border-warning/40 bg-warning/10 text-warning",
    RUNNING: "border-accent/40 bg-accent/15 text-accent animate-pulse",
    PAUSING: "border-warning/40 bg-warning/10 text-warning",
    PAUSED: "border-warning/40 bg-warning/10 text-warning",
    COMPLETED: "border-online/40 bg-online/10 text-online font-bold",
    FAILED: "border-danger/40 bg-danger/10 text-danger font-bold",
    CANCELLED: "border-muted/40 bg-elevated text-muted",
    MANUAL_REVIEW_REQUIRED: "border-danger/60 bg-danger/20 text-danger font-bold",
    DRAFT: "border-border bg-elevated text-muted",
  };

  return (
    <span
      className={`rounded border px-1.5 py-0.2 font-mono text-[10px] font-semibold ${
        styles[status] ?? "border-border bg-elevated text-muted"
      }`}
    >
      {status}
    </span>
  );
}

function ItemStatusBadge({
  status,
}: {
  status: EnhancementQueueItem["status"] | "SKIPPED_AFTER_FAILURE";
}) {
  const styles: Record<string, string> = {
    PENDING: "border-border bg-elevated text-muted",
    RUNNING: "border-accent/40 bg-accent/10 text-accent animate-pulse",
    COMPLETED: "border-online/40 bg-online/10 text-online font-semibold",
    FAILED: "border-danger/40 bg-danger/10 text-danger font-semibold",
    CANCELLED: "border-muted/40 bg-elevated text-muted",
    MANUAL_REVIEW_REQUIRED: "border-danger/60 bg-danger/20 text-danger font-bold",
    SKIPPED_AFTER_FAILURE: "border-border bg-elevated/40 text-muted/60 italic",
  };

  return (
    <span
      className={`rounded border px-1.5 py-0.2 font-mono text-[9px] ${
        styles[status] ?? "border-border bg-elevated text-muted"
      }`}
    >
      {status}
    </span>
  );
}

function AttemptPhaseBadge({ phase }: { phase: string }) {
  const info = ATTEMPT_PHASE_INFO[phase as keyof typeof ATTEMPT_PHASE_INFO];
  if (!info) {
    return <span className="font-mono text-[9px] text-muted">{phase}</span>;
  }

  const colorClass = info.isSensitive
    ? "border-warning/50 bg-warning/15 text-warning font-semibold"
    : info.label === "Chưa bắt đầu"
      ? "border-border bg-elevated text-muted"
      : "border-accent/30 bg-accent/10 text-accent";

  return (
    <span
      title={info.description}
      className={`rounded border px-1.5 py-0.2 text-[9px] inline-block ${colorClass}`}
    >
      {info.label}
    </span>
  );
}

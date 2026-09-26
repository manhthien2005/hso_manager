"use client";

import { useMemo, useState } from "react";
import type {
  EnhancementQueueItem,
  EnhancementQueueJob,
} from "@/lib/types";
import {
  type AuthoritativeQueueWithItems,
  type DerivedQueueSpend,
  ATTEMPT_PHASE_INFO,
  determineItemProgressState,
  HISTORY_CLASSIFICATION,
} from "@/lib/queue-progress";
import { Button } from "@/components/ui/button";

interface EnhancementQueueProgressProps {
  activeQueue: AuthoritativeQueueWithItems;
  history?: AuthoritativeQueueWithItems[];
  onPauseQueue?: () => void;
  onCancelQueue?: () => void;
  isPausing?: boolean;
  isCancelling?: boolean;
  errorMessage?: string | null;
}

export function EnhancementQueueProgress({
  activeQueue,
  history = [],
  onPauseQueue,
  onCancelQueue,
  isPausing = false,
  isCancelling = false,
  errorMessage,
}: EnhancementQueueProgressProps) {
  const { job, items, derivedSpend } = activeQueue;
  const [showHistory, setShowHistory] = useState(false);

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

  return (
    <div id="enhancement-queue-progress-view" className="space-y-5">
      {/* 1. Header & Overall Queue Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-base text-foreground tracking-tight">
              Tiến trình hàng đợi cường hóa
            </span>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="mt-1 text-xs text-muted">
            Mã Job: <span className="font-mono text-foreground font-medium">{job.id.slice(0, 8)}...</span>
            {" • "}
            Khởi tạo: <span className="text-foreground">{new Date(job.createdAt).toLocaleTimeString()}</span>
            {job.startedAt ? (
              <>
                {" • "}
                Bắt đầu: <span className="text-foreground">{new Date(job.startedAt).toLocaleTimeString()}</span>
              </>
            ) : null}
          </p>
        </div>

        {/* Action Controls: Pause & Cancel */}
        <div className="flex items-center gap-2">
          {job.status === "QUEUED" || job.status === "RUNNING" ? (
            <Button
              id="pause-enhancement-queue-btn"
              variant="secondary"
              size="sm"
              onClick={onPauseQueue}
              disabled={isPausing || Boolean(job.pauseRequestedAt)}
              className="text-xs"
            >
              {job.pauseRequestedAt
                ? "Đang chờ dừng..."
                : isPausing
                  ? "Đang gửi..."
                  : "Tạm dừng"}
            </Button>
          ) : null}

          {["QUEUED", "RUNNING", "PAUSING", "PAUSED", "MANUAL_REVIEW_REQUIRED"].includes(job.status) ? (
            <Button
              id="cancel-enhancement-queue-btn"
              variant="danger"
              size="sm"
              onClick={onCancelQueue}
              disabled={isCancelling || Boolean(job.cancelRequestedAt)}
              className="text-xs"
            >
              {job.cancelRequestedAt
                ? "Đang chờ hủy..."
                : isCancelling
                  ? "Đang gửi..."
                  : "Hủy hàng đợi"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* 2. Pending Pause / Cancel Request Notices */}
      {job.pauseRequestedAt ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning flex items-start gap-2">
          <span className="font-semibold shrink-0">Lưu ý:</span>
          <span>
            Đã ghi nhận yêu cầu tạm dừng. Lượt cường hóa đang thực hiện (nếu có) sẽ hoàn tất và chốt kết quả trước khi dừng hàng đợi.
          </span>
        </div>
      ) : null}

      {job.cancelRequestedAt ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger flex items-start gap-2">
          <span className="font-semibold shrink-0">Lưu ý:</span>
          <span>
            Đã ghi nhận yêu cầu hủy bỏ. Lượt cường hóa đang thực hiện (nếu có) sẽ hoàn tất trước khi dừng các trang bị tiếp theo.
          </span>
        </div>
      ) : null}

      {/* 3. Prominent MANUAL_REVIEW_REQUIRED Alert Banner */}
      {isManualReview ? (
        <div
          id="manual-review-required-banner"
          className="rounded-lg border-2 border-danger/80 bg-danger/15 p-4 space-y-2 text-danger"
        >
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-danger animate-ping shrink-0" />
            <span className="font-bold text-sm tracking-tight uppercase">
              Cần kiểm tra thủ công (MANUAL_REVIEW_REQUIRED)
            </span>
          </div>
          <p className="text-xs leading-relaxed text-foreground/90 font-medium">
            Tiến trình cường hóa tự động đã tạm dừng để bảo vệ tài khoản và trang bị.
            Hệ thống không tự động thử lại (Không có tính năng Retry tự động) để tránh rủi ro mất đồ khi trạng thái chưa rõ ràng.
          </p>
          <p className="text-[11px] text-muted leading-relaxed">
            Vui lòng đăng nhập hoặc kiểm tra trực tiếp trong game để xác nhận kết quả lượt cường hóa gần nhất trước khi tiếp tục.
          </p>
        </div>
      ) : null}

      {/* Error Message banner */}
      {errorMessage ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          {errorMessage}
        </div>
      ) : null}

      {/* 4. Overall Progress Bar */}
      <div className="space-y-1.5 bg-elevated/40 border border-border/60 rounded-lg p-3.5">
        <div className="flex justify-between text-xs font-medium">
          <span className="text-muted">Tiến độ hoàn thành:</span>
          <span className="text-foreground font-mono">
            {completedCount} / {items.length} trang bị ({progressPercent}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-surface border border-border/40 overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 5. Authoritative Derived Actual Spend Summary */}
      <SpendSummaryCard spend={derivedSpend} />

      {/* 6. Active Item Focus (if RUNNING) */}
      {activeItem && job.status === "RUNNING" ? (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-accent animate-pulse" />
              <span className="text-xs font-semibold text-accent uppercase tracking-wider">
                Đang xử lý mục #{activeItem.queueOrder}: {activeItem.baseName}
              </span>
            </div>
            <span className="font-mono text-xs text-muted">
              Lượt thử #{activeItem.attemptCount}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="text-muted">
              Cấp độ: <span className="text-foreground font-bold font-mono">+{activeItem.currentLevel}</span>
              {" -> "}
              Mục tiêu: <span className="text-accent font-bold font-mono">+{activeItem.targetLevel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted">Giai đoạn:</span>
              <AttemptPhaseBadge phase={activeItem.attemptPhase} />
            </div>
          </div>

          {activeItem.attemptPhase === "EXECUTE_MAY_HAVE_BEEN_SENT" ? (
            <p className="text-[11px] text-warning bg-warning/10 border border-warning/30 rounded p-2 font-medium">
              * Lệnh cường hóa đã được phát đi và có thể đã gửi tới máy chủ game. Trạng thái nhạy cảm, vui lòng không tắt kết nối.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 7. Ordered Items Progression List */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-foreground tracking-tight uppercase text-muted">
          Danh sách trang bị ({items.length})
        </h4>

        <div className="divide-y divide-border/40 border border-border/70 rounded-lg overflow-hidden bg-surface">
          {itemProgressList.map(({ item, isUnexecutedDueToPriorFailure, displayStatus }) => (
            <div
              key={item.id}
              className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                item.id === activeItem?.id ? "bg-accent/5" : ""
              }`}
            >
              {/* Left: Identity & Levels */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted">
                    #{item.queueOrder}
                  </span>
                  <span className="font-semibold text-foreground">
                    {item.baseName}
                  </span>
                  <span className="text-muted text-[11px]">
                    (Ô {item.capturedSlot + 1})
                  </span>
                  <ItemStatusBadge status={displayStatus} />
                </div>

                <div className="flex flex-wrap items-center gap-3 text-muted text-[11px]">
                  <div>
                    Ban đầu: <span className="font-mono text-foreground font-medium">+{item.initialLevel}</span>
                  </div>
                  <div>
                    Hiện tại:{" "}
                    <span
                      className={`font-mono font-bold ${
                        item.currentLevel > item.initialLevel
                          ? "text-online"
                          : "text-foreground"
                      }`}
                    >
                      +{item.currentLevel}
                    </span>
                  </div>
                  <div>
                    Mục tiêu: <span className="font-mono text-accent font-medium">+{item.targetLevel}</span>
                  </div>
                  <div>
                    Loại tiền: <span className="text-foreground">{item.paymentType}</span>
                  </div>
                  <div>
                    Bùa: <span className="text-foreground">{item.charmMode}</span>
                  </div>
                  <div>
                    Số lượt: <span className="font-mono text-foreground">{item.attemptCount}</span>
                  </div>
                </div>

                {/* Attempt phase for active or settled item */}
                {item.attemptPhase && item.attemptPhase !== "NONE" ? (
                  <div className="pt-1 flex items-center gap-1.5">
                    <span className="text-[10px] text-muted">Giai đoạn:</span>
                    <AttemptPhaseBadge phase={item.attemptPhase} />
                  </div>
                ) : null}

                {/* Error info if present */}
                {item.errorCode || item.errorMessage ? (
                  <div className="mt-1 text-[11px] text-danger bg-danger/10 border border-danger/20 rounded p-1.5">
                    Lỗi [{item.errorCode ?? "UNKNOWN"}]: {item.errorMessage ?? "Thao tác thất bại"}
                  </div>
                ) : null}

                {/* Skipped note */}
                {isUnexecutedDueToPriorFailure ? (
                  <p className="text-[11px] text-muted italic">
                    Chưa thực hiện (Đã dừng do mục trước đó gặp lỗi/dừng lại)
                  </p>
                ) : null}
              </div>

              {/* Right: Authoritative Cumulative Actual Spend per Item */}
              <div className="sm:text-right shrink-0 bg-elevated/30 sm:bg-transparent p-2 sm:p-0 rounded border sm:border-0 border-border/30">
                <span className="text-[10px] text-muted block mb-0.5">Thực tế đã chi:</span>
                <div className="font-mono text-[11px] text-foreground space-y-0.5">
                  {item.actualGoldSpent > 0 ? (
                    <div>{item.actualGoldSpent.toLocaleString()} Vàng</div>
                  ) : null}
                  {item.actualGemSpent > 0 ? (
                    <div>{item.actualGemSpent.toLocaleString()} Gems</div>
                  ) : null}
                  {item.actualMaterial1Spent > 0 ||
                  item.actualMaterial2Spent > 0 ||
                  item.actualMaterial3Spent > 0 ||
                  item.actualMaterial4Spent > 0 ? (
                    <div className="text-[10px] text-muted">
                      Vật liệu: M1:{item.actualMaterial1Spent} M2:{item.actualMaterial2Spent} M3:{item.actualMaterial3Spent} M4:{item.actualMaterial4Spent}
                    </div>
                  ) : null}
                  {item.actualCharmSpent > 0 ? (
                    <div>{item.actualCharmSpent} Bùa</div>
                  ) : null}
                  {item.actualGoldSpent === 0 &&
                  item.actualGemSpent === 0 &&
                  item.actualMaterial1Spent === 0 &&
                  item.actualCharmSpent === 0 ? (
                    <span className="text-muted text-[10px]">Chưa phát sinh</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 8. Terminal History Section (Compact Accordion) */}
      {history.length > 0 ? (
        <div className="pt-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs text-muted hover:text-foreground"
          >
            {showHistory ? "▲ Ẩn lịch sử hàng đợi gần đây" : "▼ Xem lịch sử hàng đợi gần đây"} ({history.length})
          </Button>

          {showHistory ? (
            <div className="mt-3 space-y-3">
              <div className="divide-y divide-border/40 border border-border/70 rounded-lg overflow-hidden bg-surface">
                {history.map((hist) => (
                  <div key={hist.job.id} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-medium text-foreground">
                          Job {hist.job.id.slice(0, 8)}...
                        </span>
                        <JobStatusBadge status={hist.job.status} />
                      </div>
                      <span className="text-[11px] text-muted">
                        {hist.job.finishedAt
                          ? new Date(hist.job.finishedAt).toLocaleString()
                          : new Date(hist.job.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-[11px] text-muted">
                      Số mục: <span className="text-foreground">{hist.items.length}</span>
                      {" • "}
                      Hoàn thành: <span className="text-foreground">{hist.items.filter((i) => i.status === "COMPLETED").length}</span>
                      {" • "}
                      Vàng: <span className="font-mono text-foreground">{hist.derivedSpend.actualGoldSpent.toLocaleString()}</span>
                      {" • "}
                      Lượt: <span className="font-mono text-foreground">{hist.derivedSpend.totalAttemptCount}</span>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-muted/70 leading-relaxed italic">
                * Ghi chú hệ thống: Schema migration 013 lưu trữ tổng hợp tài nguyên thực tế theo từng trang bị ({HISTORY_CLASSIFICATION}). Chi tiết nhật ký từng lượt bấm độc lập không được hỗ trợ bởi schema hiện tại.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SpendSummaryCard({ spend }: { spend: DerivedQueueSpend }) {
  return (
    <div className="rounded-lg border border-border/70 bg-elevated/20 p-3.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider text-muted">
          Tổng chi phí thực tế đã hạch toán (Durable Settled Spend)
        </span>
        <span className="font-mono text-xs text-muted">
          Tổng {spend.totalAttemptCount} lượt cường hóa
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
        <div className="rounded border border-border/40 bg-surface p-2">
          <span className="text-[10px] text-muted block">Vàng đã tiêu:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualGoldSpent.toLocaleString()}
          </span>
        </div>

        <div className="rounded border border-border/40 bg-surface p-2">
          <span className="text-[10px] text-muted block">Gems đã tiêu:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualGemSpent.toLocaleString()}
          </span>
        </div>

        <div className="rounded border border-border/40 bg-surface p-2">
          <span className="text-[10px] text-muted block">Vật liệu 1 & 2:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            M1: {spend.actualMaterial1Spent} / M2: {spend.actualMaterial2Spent}
          </span>
        </div>

        <div className="rounded border border-border/40 bg-surface p-2">
          <span className="text-[10px] text-muted block">Bùa đã dùng:</span>
          <span className="font-mono text-xs font-bold text-foreground">
            {spend.actualCharmSpent} bùa
          </span>
        </div>
      </div>

      <p className="text-[10px] text-muted/80 pt-1 leading-relaxed">
        * Chi phí trên được tổng hợp chính xác từ các lượt cường hóa đã hoàn tất trong cơ sở dữ liệu.
        Không bao gồm phí di chuyển và không phản ánh chi phí dự toán trước khi thực hiện.
      </p>
    </div>
  );
}

function JobStatusBadge({ status }: { status: EnhancementQueueJob["status"] }) {
  const styles: Record<string, string> = {
    QUEUED: "border-warning/40 bg-warning/10 text-warning",
    RUNNING: "border-accent/40 bg-accent/15 text-accent animate-pulse",
    PAUSING: "border-warning/40 bg-warning/10 text-warning",
    PAUSED: "border-warning/40 bg-warning/15 text-warning",
    COMPLETED: "border-online/40 bg-online/10 text-online",
    FAILED: "border-danger/40 bg-danger/10 text-danger",
    CANCELLED: "border-muted/40 bg-elevated text-muted",
    MANUAL_REVIEW_REQUIRED: "border-danger/60 bg-danger/20 text-danger font-bold",
    DRAFT: "border-border bg-elevated text-muted",
  };

  return (
    <span
      className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
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
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
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
    return <span className="font-mono text-[10px] text-muted">{phase}</span>;
  }

  const colorClass = info.isSensitive
    ? "border-warning/50 bg-warning/15 text-warning font-semibold"
    : info.label === "Chưa bắt đầu"
      ? "border-border bg-elevated text-muted"
      : "border-accent/30 bg-accent/10 text-accent";

  return (
    <span
      title={info.description}
      className={`rounded border px-1.5 py-0.5 text-[10px] inline-block ${colorClass}`}
    >
      {info.label}
    </span>
  );
}

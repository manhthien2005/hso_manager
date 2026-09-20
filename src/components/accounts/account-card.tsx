"use client";

import { useState } from "react";
import type { Account } from "@/lib/types";
import { useAccountCommand } from "@/hooks/use-account-command";
import { AccountStatusBadge, HealthStatusBadge } from "@/components/ui/status";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TelemetryPanel } from "@/components/accounts/telemetry-panel";
import { EditAccountModal } from "@/components/accounts/edit-account-modal";
import { DeleteAccountModal } from "@/components/accounts/delete-account-modal";
import { formatServerDisplay } from "@/lib/game-servers";
import { formatAtkstate, formatTelemetryMap, healthOf } from "@/lib/format";
import { pendingKey, useZeusStore } from "@/store/zeus-store";

/**
 * AccountCard — Storm Steel Operational Account Row & Control.
 *
 * Scannable hierarchy (Phase 10 refinement):
 *   1. Identity: Account label (larger) + dual Status badges (Process + Health) + actions
 *   2. Quick-vitals strip: Lv / HP / Map / Atk — icon-prefixed, prominent
 *   3. Secondary metadata (smaller, muted): Server / RAM / PID
 *   4. Progressive disclosure: "Show diagnostics ▼" expandable telemetry drawer
 *   5. Action toolbar: Start/Stop/Restart with icons | Configure/Edit/Delete with icons
 */

type PendingAction = "stop" | "restart" | null;

export function AccountCard({
  account,
  disabledReason,
}: {
  account: Account;
  disabledReason?: string;
}) {
  const { run, busyWith } = useAccountCommand(account.id);
  const { isPending } = useZeusStore();

  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<PendingAction>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const isDeleting = isPending(pendingKey.accountDelete(account.id));
  const isStarting = isPending(pendingKey.command(account.id, "start"));
  const isStopping = isPending(pendingKey.command(account.id, "stop"));
  const isRestarting = isPending(pendingKey.command(account.id, "restart"));
  const isUpdating = isPending(pendingKey.accountUpdate(account.id));
  const isConfiguring = isPending(pendingKey.config(account.id));

  const isCommandBusy = isStarting || isStopping || isRestarting;
  const isAnyMutationPending = isDeleting || isCommandBusy || isUpdating || isConfiguring;
  const actionsDisabled = disabledReason !== undefined || account.status === "offline";

  const health = healthOf(account);
  const snap = account.snapshot;
  const isProcessAlive = account.status !== "stopped" && account.status !== "offline";

  // HP warning threshold for semantic color
  const hpPct = snap && snap.hpmax > 0 ? snap.hp / snap.hpmax : 1;
  const hpColor = hpPct < 0.3 ? "text-danger" : hpPct < 0.6 ? "text-warning" : "text-foreground";

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    try {
      await run(action);
      setConfirmAction(null);
    } catch {
      // errors handled by useAccountCommand / toast
      setConfirmAction(null);
    }
  };

  return (
    <Card className="p-3.5 transition-colors">
      {/* Top row: Identity & Dual Status */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-foreground truncate">
              {account.label}
            </h3>
            {account.config_status === "version_mismatch" ? (
              <span className="rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                Phiên bản cấu hình không tương thích
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted/70 truncate">{account.id}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AccountStatusBadge status={account.status} />
          {/* Only show HealthStatusBadge when it adds information beyond the process status */}
          {health !== "running" ? <HealthStatusBadge health={health} /> : null}
        </div>
      </div>

      {/* Quick-vitals strip (when process alive) */}
      {isProcessAlive ? (
        <div className="mt-2.5">
          {snap ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {/* Lv */}
              <div className="flex items-center gap-1 text-xs">
                <IconLv />
                <span className="text-muted text-[11px]">Lv</span>
                <span className="font-mono font-semibold text-foreground tabular">{snap.lv}</span>
              </div>
              {/* HP */}
              <div className="flex items-center gap-1 text-xs">
                <IconHp />
                <span className="text-muted text-[11px]">HP</span>
                <span className={`font-mono font-semibold tabular ${hpColor}`}>
                  {snap.hp}/{snap.hpmax}
                </span>
              </div>
              {/* Map */}
              <div className="flex items-center gap-1 text-xs">
                <IconMap />
                <span className="text-muted text-[11px]">Map</span>
                <span className="font-mono font-semibold text-foreground tabular">
                  {formatTelemetryMap(snap.map)}
                </span>
              </div>
              {/* Atk */}
              <div className="flex items-center gap-1 text-xs">
                <IconAtk />
                <span className="text-muted text-[11px]">Atk</span>
                <span className={`font-mono font-semibold tabular ${snap.atkstate >= 0 ? "text-accent" : "text-muted"}`}>
                  {formatAtkstate(snap.atkstate)}
                </span>
              </div>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-warning/70" />
              Đang chờ dữ liệu trạng thái…
            </span>
          )}
        </div>
      ) : null}

      {/* Secondary metadata row — muted, smaller */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-muted/70">
        <span>{formatServerDisplay(account.serverId)}</span>
        {account.characterName ? <span>{account.characterName}</span> : null}
        {account.ramMb !== null ? <span>{Math.round(account.ramMb)} MB</span> : null}
        {account.pid !== null ? <span>PID {account.pid}</span> : null}
      </div>

      {/* Disabled reason notice if parent offline */}
      {disabledReason ? (
        <p className="mt-2 text-xs font-medium text-warning px-1">{disabledReason}</p>
      ) : null}

      {/* Action Bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
        {/* Primary Operational Commands */}
        {account.status === "stopped" || account.status === "error" ? (
          <Button
            size="sm"
            variant="primary"
            busy={busyWith("start")}
            disabled={actionsDisabled || isDeleting || isAnyMutationPending}
            onClick={() => run("start")}
            icon={<IconPlay />}
          >
            Khởi động
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="secondary"
          busy={busyWith("stop")}
          disabled={actionsDisabled || account.status === "stopped" || isDeleting || isAnyMutationPending}
          onClick={() => setConfirmAction("stop")}
          icon={<IconStop />}
        >
          Dừng
        </Button>

        <Button
          size="sm"
          variant="secondary"
          busy={busyWith("restart")}
          disabled={actionsDisabled || account.status === "stopped" || isDeleting || isAnyMutationPending}
          onClick={() => setConfirmAction("restart")}
          icon={<IconRestart />}
        >
          Khởi động lại
        </Button>

        {/* Secondary Management Actions */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ButtonLink
            href={`/account/${account.id}/config`}
            size="sm"
            variant="secondary"
            disabled={isDeleting}
            icon={<IconGear />}
          >
            Cấu hình
          </ButtonLink>
          <Button
            size="sm"
            variant="secondary"
            disabled={actionsDisabled || isDeleting || isAnyMutationPending}
            onClick={() => setIsEditOpen(true)}
            icon={<IconPencil />}
          >
            Chỉnh sửa
          </Button>
          <Button
            size="sm"
            variant="danger"
            busy={isDeleting}
            disabled={actionsDisabled || isDeleting || isAnyMutationPending}
            onClick={() => setIsDeleteOpen(true)}
            icon={<IconTrash />}
          >
            Xóa
          </Button>
        </div>
      </div>

      {/* Diagnostics disclosure toggle (when process alive) */}
      {isProcessAlive ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setIsTelemetryOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            aria-expanded={isTelemetryOpen}
            aria-controls={`telemetry-${account.id}`}
          >
            <svg
              className={`size-3 transition-transform ${isTelemetryOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>{isTelemetryOpen ? "Thu gọn thông tin" : "Xem thông tin chi tiết"}</span>
          </button>
        </div>
      ) : null}

      {/* Progressive Telemetry Panel (Default Collapsed) */}
      {isTelemetryOpen ? (
        <div className="mt-3 border-t border-border pt-3">
          <TelemetryPanel account={account} />
        </div>
      ) : null}

      {/* Stop / Restart Confirmation Dialog */}
      {confirmAction !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-action-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isCommandBusy) {
              setConfirmAction(null);
            }
          }}
        >
          <Card className="w-full max-w-md p-5 shadow-2xl border-border bg-elevated">
            <div className="mb-3">
              <h2
                id="confirm-action-title"
                className={`text-sm font-semibold tracking-tight uppercase ${
                  confirmAction === "stop" ? "text-danger" : "text-warning"
                }`}
              >
                {confirmAction === "stop" ? "Xác nhận dừng tài khoản" : "Xác nhận khởi động lại tài khoản"}
              </h2>
              <p className="mt-2 text-xs text-muted">
                Bạn có chắc chắn muốn{" "}
                <strong className="text-foreground">
                  {confirmAction === "stop" ? "dừng" : "khởi động lại"}
                </strong>{" "}
                tài khoản:
              </p>
              <div className="mt-2 rounded border border-border bg-elevated/60 px-3 py-2">
                <span className="text-xs font-semibold text-foreground">{account.label}</span>
                <span className="ml-2 font-mono text-[11px] text-muted">({account.id})</span>
              </div>
            </div>

            <div
              role="alert"
              className="mb-4 rounded-md border border-border bg-elevated/40 p-3 text-xs text-muted space-y-1.5"
            >
              {confirmAction === "stop" ? (
                <p>
                  Thao tác này sẽ dừng tiến trình giả lập trên máy chủ. Tự động chiến đấu,
                  luyện cấp và truyền dữ liệu trạng thái sẽ dừng ngay lập tức.
                </p>
              ) : (
                <p>
                  Thao tác này sẽ dừng tiến trình giả lập hiện tại và khởi chạy lại ngay lập tức
                  với cấu hình đang hoạt động.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isCommandBusy}
                onClick={() => setConfirmAction(null)}
              >
                Hủy
              </Button>
              <Button
                type="button"
                variant={confirmAction === "stop" ? "danger" : "primary"}
                size="sm"
                busy={busyWith(confirmAction)}
                disabled={isCommandBusy}
                onClick={handleConfirmAction}
              >
                {confirmAction === "stop" ? "Dừng tài khoản" : "Khởi động lại"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Edit Modal */}
      {isEditOpen ? (
        <EditAccountModal
          account={account}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
        />
      ) : null}

      {/* Delete Modal */}
      {isDeleteOpen ? (
        <DeleteAccountModal
          account={account}
          isOpen={isDeleteOpen}
          onClose={() => setIsDeleteOpen(false)}
        />
      ) : null}
    </Card>
  );
}

// ── Icon Library ───────────────────────────────────────────────────────────────

/** Vitals icons — 10px, stroke-based */
function IconLv() {
  return (
    <svg viewBox="0 0 12 12" className="size-2.5 shrink-0 text-muted" fill="none" aria-hidden="true">
      <path d="M2 2h1.5l2.5 6 2.5-6H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHp() {
  return (
    <svg viewBox="0 0 12 12" className="size-2.5 shrink-0 text-danger/70" fill="none" aria-hidden="true">
      <path d="M6 10S1.5 7 1.5 4a2.5 2.5 0 0 1 4.5-1.5A2.5 2.5 0 0 1 10.5 4C10.5 7 6 10 6 10z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg viewBox="0 0 12 12" className="size-2.5 shrink-0 text-muted" fill="none" aria-hidden="true">
      <path d="M1 2.5l3.5 1 3-1.5 3.5 1.5v6L8 8.5l-3 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 3.5v6M8 2.5v6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function IconAtk() {
  return (
    <svg viewBox="0 0 12 12" className="size-2.5 shrink-0 text-muted" fill="none" aria-hidden="true">
      <path d="M2 10L10 2M10 2H7M10 2v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Action icons — size-3.5 */
function IconPlay() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M5 3.5l8 4.5-8 4.5V3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconRestart() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M12 8a4 4 0 1 1-1.2-2.85M12 2.5v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M12.25 3.75l-1.06 1.06M4.81 11.19l-1.06 1.06" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

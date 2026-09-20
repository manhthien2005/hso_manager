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
 * Scannable hierarchy:
 *   1. Identity: Account label + ID + dual Status badges (Process + Health)
 *   2. Operational summary: Character, Server, RAM, PID + quick telemetry vitals
 *   3. Commands: Start (instant), Stop & Restart (with explicit confirmation modal)
 *   4. Progressive disclosure: Telemetry & Diagnostics expandable drawer/panel
 *   5. Secondary management: Edit, Configure, Delete
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
    <Card className="p-4 transition-colors">
      {/* Top row: Identity & Dual Status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground truncate">
              {account.label}
            </h3>
            {account.config_status === "version_mismatch" ? (
              <span className="rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                Config Mismatch
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted truncate">{account.id}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AccountStatusBadge status={account.status} />
          <HealthStatusBadge health={health} />
        </div>
      </div>

      {/* Operational Facts Grid */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4 rounded-md border border-border/70 bg-elevated/40 p-2.5">
        <Fact label="Character" value={account.characterName ?? snap?.name ?? "—"} />
        <Fact label="Server" value={formatServerDisplay(account.serverId)} />
        <Fact
          label="RAM"
          value={account.ramMb === null ? "—" : `${Math.round(account.ramMb)} MB`}
        />
        <Fact
          label="PID"
          value={account.pid === null ? "—" : String(account.pid)}
        />
      </div>

      {/* Quick operational vitals summary if running */}
      {isProcessAlive ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
          {snap ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted text-[11px] font-mono">
              <span>
                Lv <strong className="text-foreground">{snap.lv}</strong>
              </span>
              <span>•</span>
              <span>
                HP{" "}
                <strong className="text-foreground">
                  {snap.hp}/{snap.hpmax}
                </strong>
              </span>
              <span>•</span>
              <span>
                Map{" "}
                <strong className="text-foreground">
                  {formatTelemetryMap(snap.map)}
                </strong>
              </span>
              <span>•</span>
              <span>
                Atk{" "}
                <strong className="text-foreground">
                  {formatAtkstate(snap.atkstate)}
                </strong>
              </span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="size-1.5 rounded-full bg-warning/70" />
              Waiting for telemetry snapshot…
            </span>
          )}

          {/* Progressive Disclosure Toggle Button */}
          <button
            type="button"
            onClick={() => setIsTelemetryOpen((open) => !open)}
            className="ml-auto inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            aria-expanded={isTelemetryOpen}
            aria-controls={`telemetry-${account.id}`}
          >
            <span>{isTelemetryOpen ? "Hide Diagnostics" : "Telemetry & Diagnostics"}</span>
            <svg
              className={`size-3.5 transition-transform ${isTelemetryOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      ) : null}

      {/* Disabled reason notice if parent offline */}
      {disabledReason ? (
        <p className="mt-2 text-xs font-medium text-warning px-1">{disabledReason}</p>
      ) : null}

      {/* Action Bar */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {/* Primary Operational Commands */}
        {account.status === "stopped" || account.status === "error" ? (
          <Button
            size="sm"
            variant="primary"
            busy={busyWith("start")}
            disabled={actionsDisabled || isDeleting || isAnyMutationPending}
            onClick={() => run("start")}
          >
            Start
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="secondary"
          busy={busyWith("stop")}
          disabled={actionsDisabled || account.status === "stopped" || isDeleting || isAnyMutationPending}
          onClick={() => setConfirmAction("stop")}
        >
          Stop
        </Button>

        <Button
          size="sm"
          variant="secondary"
          busy={busyWith("restart")}
          disabled={actionsDisabled || account.status === "stopped" || isDeleting || isAnyMutationPending}
          onClick={() => setConfirmAction("restart")}
        >
          Restart
        </Button>

        {/* Secondary Management Actions */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ButtonLink
            href={`/account/${account.id}/config`}
            size="sm"
            variant="secondary"
            disabled={isDeleting}
          >
            Configure
          </ButtonLink>
          <Button
            size="sm"
            variant="secondary"
            disabled={actionsDisabled || isDeleting || isAnyMutationPending}
            onClick={() => setIsEditOpen(true)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            busy={isDeleting}
            disabled={actionsDisabled || isDeleting || isAnyMutationPending}
            onClick={() => setIsDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Progressive Telemetry Panel (Default Collapsed) */}
      {isTelemetryOpen ? (
        <div className="mt-4 border-t border-border pt-3">
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
          <Card className="w-full max-w-md p-5 shadow-2xl border-border bg-card">
            <div className="mb-3">
              <h2
                id="confirm-action-title"
                className={`text-sm font-semibold tracking-tight uppercase ${
                  confirmAction === "stop" ? "text-danger" : "text-warning"
                }`}
              >
                Confirm {confirmAction === "stop" ? "Stop Account" : "Restart Account"}
              </h2>
              <p className="mt-2 text-xs text-muted">
                Are you sure you want to{" "}
                <strong className="text-foreground">{confirmAction}</strong> account:
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
                  Stopping will terminate the emulator process on this device. Active combat,
                  farming automation, and telemetry streaming will cease immediately.
                </p>
              ) : (
                <p>
                  Restarting will terminate the current emulator process and immediately relaunch
                  a new instance with the active configuration.
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
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirmAction === "stop" ? "danger" : "primary"}
                size="sm"
                busy={busyWith(confirmAction)}
                disabled={isCommandBusy}
                onClick={handleConfirmAction}
              >
                {confirmAction === "stop" ? "Confirm Stop" : "Confirm Restart"}
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wider text-muted font-semibold uppercase">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs font-medium tabular text-foreground">
        {value}
      </dd>
    </div>
  );
}

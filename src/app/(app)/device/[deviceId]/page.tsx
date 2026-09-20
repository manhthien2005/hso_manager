"use client";

import { use } from "react";
import Link from "next/link";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountStatusBadge, DeviceStatusBadge, HealthStatusBadge, MetricBar } from "@/components/ui/status";
import { describeError } from "@/services/api";
import { useAccountCommand } from "@/hooks/use-account-command";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import { formatRam, formatRelativeTime, formatUptime, healthOf } from "@/lib/format";
import { formatServerDisplay } from "@/lib/game-servers";
import type { Account, Device } from "@/lib/types";

/**
 * Device Operations & Detail Page — Storm Steel.
 *
 * Answers immediately:
 *   1. Is this node healthy or problematic?
 *   2. When did it last heartbeat?
 *   3. What state are the accounts on this node in?
 *   4. What can I do right now? (Open Viewer, Manage, Refresh)
 *   5. Subordinate hardware and runtime diagnostics at bottom.
 */
export default function DeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = use(params);
  const { devices, accountsOf, refreshDevice, isPending } = useZeusStore();
  const { push } = useToast();

  const found = devices.find((item) => item.deviceId === deviceId);
  if (found === undefined) {
    return (
      <NotFoundPanel
        title="Device not found"
        hint="No VPS with this device ID is registered to your fleet."
        identifier={deviceId}
      />
    );
  }

  const device: Device = found;
  const accounts = accountsOf(device.deviceId);
  const online = device.status === "online";
  const busy = isPending(pendingKey.device(device.deviceId));

  async function handleRefresh() {
    try {
      await refreshDevice(device.deviceId);
      push("success", "Device refreshed", `${device.name} heartbeat updated`);
    } catch (error) {
      push("error", "Refresh failed", describeError(error));
    }
  }

  return (
    <div className="space-y-5">
      {/* 1. Page Header with Node Identity & Primary Actions */}
      <PageHeader
        back={{ href: "/", label: "Dashboard" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl font-bold tracking-tight text-foreground">
              {device.name}
            </span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs text-muted">
            {device.deviceId} · {device.region} · Last seen {formatRelativeTime(device.lastSeen)}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" busy={busy} onClick={handleRefresh} icon={<IconRefresh />}>
              Refresh
            </Button>
            <ButtonLink
              href={`/device/${device.deviceId}/viewer`}
              size="sm"
              variant={online ? "primary" : "secondary"}
              disabled={!online}
              icon={<IconMonitor />}
            >
              Open Viewer
            </ButtonLink>
            <ButtonLink
              href={`/device/${device.deviceId}/accounts`}
              size="sm"
              variant="secondary"
              icon={<IconUsers />}
            >
              Manage Accounts
            </ButtonLink>
          </div>
        }
      />

      {/* 2. Operational Notice Banners (When abnormal) */}
      {!online ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-xs text-warning">
          <div className="flex items-center gap-2 font-medium">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
            <span>Node is offline</span>
          </div>
          <p className="mt-1 text-muted">
            Commands and remote noVNC viewer are unavailable until the agent reconnects. Last heartbeat was recorded {formatRelativeTime(device.lastSeen)}.
          </p>
        </div>
      ) : device.status === "error" ? (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-xs text-danger">
          <div className="flex items-center gap-2 font-medium">
            <span className="size-1.5 rotate-45 rounded-[1px] bg-danger" aria-hidden="true" />
            <span>Node is reporting an error</span>
          </div>
          <p className="mt-1 text-muted">
            Agent or container failure detected. Check server console logs or restart agent service.
          </p>
        </div>
      ) : null}

      {/* 3. Account Operational List (Primary content on this node) */}
      <section aria-labelledby="accounts-section-heading" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2
            id="accounts-section-heading"
            className="border-l-2 border-accent pl-2 text-[11px] font-semibold tracking-widest text-muted/90 uppercase"
          >
            Assigned Accounts ({accounts.length})
          </h2>
          <Link
            href={`/device/${device.deviceId}/accounts`}
            className="text-xs text-muted transition-colors hover:text-accent"
          >
            Open Account Manager →
          </Link>
        </div>

        {accounts.length === 0 ? (
          <Card className="flex flex-col items-center justify-center border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">No accounts configured on this node</p>
            <p className="mt-1 text-xs text-muted">
              Add bot accounts to run Knight Online instances on this VPS.
            </p>
            <div className="mt-3">
              <ButtonLink
                href={`/device/${device.deviceId}/accounts`}
                variant="primary"
                size="sm"
              >
                Configure Accounts
              </ButtonLink>
            </div>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {accounts.map((account) => (
              <DeviceAccountRow
                key={account.id}
                account={account}
                nodeOnline={online}
              />
            ))}
          </div>
        )}
      </section>

      {/* 4. Subordinate Hardware & Runtime Diagnostics */}
      <section aria-labelledby="diagnostics-section-heading" className="space-y-3 pt-2">
        <div className="px-1">
          <h2
            id="diagnostics-section-heading"
            className="border-l-2 border-accent pl-2 text-[11px] font-semibold tracking-widest text-muted/90 uppercase"
          >
            Hardware &amp; Runtime Diagnostics
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* CPU Metric */}
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
              <IconCpu />
              <span>CPU Load</span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="font-mono text-xl font-semibold tabular text-foreground">
                {online ? `${Math.round(device.metrics.cpu)}%` : "—"}
              </span>
              <span className="text-[11px] text-muted">30–60s</span>
            </div>
            {online ? (
              <div className="mt-2">
                <MetricBar percent={device.metrics.cpu} />
              </div>
            ) : null}
          </Card>

          {/* RAM Metric */}
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
              <IconRam />
              <span>Memory</span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="font-mono text-xl font-semibold tabular text-foreground">
                {online ? formatRam(device.metrics.ramUsedMb, device.metrics.ramTotalMb) : "—"}
              </span>
              <span className="text-[11px] text-muted">RAM</span>
            </div>
            {online && device.metrics.ramTotalMb > 0 ? (
              <div className="mt-2">
                <MetricBar percent={(device.metrics.ramUsedMb / device.metrics.ramTotalMb) * 100} />
              </div>
            ) : null}
          </Card>

          {/* Uptime */}
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
              <IconClock />
              <span>Uptime</span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="font-mono text-xl font-semibold tabular text-foreground">
                {online ? formatUptime(device.metrics.uptimeSeconds) : "—"}
              </span>
              <span className="text-[11px] text-muted">VPS runtime</span>
            </div>
          </Card>

          {/* Agent Metadata */}
          <Card className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
              <IconServer />
              <span>Agent / Wire</span>
            </div>
            <div className="mt-1.5 space-y-0.5 font-mono text-xs tabular text-muted">
              <div>Agent: <span className="text-foreground">{device.agentVersion || "—"}</span></div>
              <div>Runtime: <span className="text-foreground">{device.runtimeVersion || "—"}</span></div>
              <div>CTL v: <span className="text-foreground">{device.jar_ctl_version ?? "None"}</span></div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

/**
 * Compact Operational Account Row for Device Detail.
 * Prioritizes process state, health, character identity, and core start/stop actions.
 */
function DeviceAccountRow({
  account,
  nodeOnline,
}: {
  account: Account;
  nodeOnline: boolean;
}) {
  const { run, busyWith } = useAccountCommand(account.id);
  const health = healthOf(account);
  const isRunning = account.status === "running";
  const isStarting = account.status === "starting";
  const isRestarting = account.status === "restarting";
  const isBusy = busyWith("start") || busyWith("stop") || busyWith("restart");
  const actionsDisabled = !nodeOnline || account.status === "offline";

  const hasConfigMismatch = account.config_status === "version_mismatch";
  const hasCtlRejected = account.snapshot !== null && account.snapshot.ctl !== 1;
  const isWaitingTelemetry = isRunning && account.snapshot === null;

  return (
    <Card className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Account Info & States */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{account.label}</span>
          {account.characterName ? (
            <span className="text-xs text-muted font-medium">({account.characterName})</span>
          ) : null}
          <AccountStatusBadge status={account.status} />
          {/* Only show HealthStatusBadge when it adds information beyond the process status */}
          {health !== "running" ? <HealthStatusBadge health={health} /> : null}
        </div>

        {/* Quick operational facts row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted font-mono">
          <span>{formatServerDisplay(account.serverId)}</span>
          {account.snapshot ? (
            <span className="text-foreground font-medium">Lv {account.snapshot.lv}</span>
          ) : null}

          {/* Subdued telemetry notice or actionable warning */}
          {hasConfigMismatch ? (
            <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
              Config Mismatch
            </span>
          ) : hasCtlRejected ? (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
              CTL Refused (ctl={account.snapshot?.ctl})
            </span>
          ) : isWaitingTelemetry ? (
            <span className="text-[11px] text-muted italic">Waiting for telemetry</span>
          ) : null}
        </div>
      </div>

      {/* Operational Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {!isRunning && !isStarting && !isRestarting ? (
          <Button
            size="sm"
            variant="primary"
            busy={busyWith("start")}
            disabled={actionsDisabled || isBusy}
            onClick={() => run("start")}
            icon={<IconPlay />}
          >
            Start
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            busy={busyWith("stop")}
            disabled={actionsDisabled || isBusy}
            onClick={() => run("stop")}
            icon={<IconStop />}
          >
            Stop
          </Button>
        )}

        <Button
          size="sm"
          variant="secondary"
          busy={busyWith("restart")}
          disabled={actionsDisabled || account.status === "stopped" || isBusy}
          onClick={() => run("restart")}
          icon={<IconRestart />}
        >
          Restart
        </Button>

        <ButtonLink
          href={`/account/${account.id}/config`}
          size="sm"
          variant="secondary"
          icon={<IconGear />}
        >
          Config
        </ButtonLink>
      </div>
    </Card>
  );
}

// ── Icon Library ───────────────────────────────────────────────────────────────

function IconRefresh() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.9-4.15M13.5 1.5v3h-3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMonitor() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 14h5M8 11v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M11 7c1.1 0 2 .9 2 2M13 13c0-1.66-.9-3.1-2.2-3.85" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconCpu() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 4V2M8 4V2M10 4V2M6 14v-2M8 14v-2M10 14v-2M4 6H2M4 8H2M4 10H2M14 6h-2M14 8h-2M14 10h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconRam() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="1.5" y="5" width="13" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 5V3.5M6 5V3.5M8 5V3.5M10 5V3.5M12 5V3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4 11v1.5M6 11v1.5M8 11v1.5M10 11v1.5M12 11v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconServer() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12.5" cy="5" r="0.8" fill="currentColor" />
      <circle cx="12.5" cy="11" r="0.8" fill="currentColor" />
    </svg>
  );
}

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

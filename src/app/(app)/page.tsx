"use client";

import { useMemo } from "react";
import { DeviceCard } from "@/components/devices/device-card";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeError } from "@/services/api";
import { formatRelativeTime } from "@/lib/format";
import { useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import type { Account, Device } from "@/lib/types";

/**
 * Attention Item Model — Derived strictly from active fleet data.
 * Non-dismissible: persists until underlying state resolves.
 */
interface AttentionItem {
  id: string;
  severity: "danger" | "warning";
  title: string;
  location: string;
  reason: string;
  actionLabel: string;
  actionHref: string;
}

/**
 * Fleet Metrics Summary — Mathematically consistent derivation.
 * Eliminates previous summarize() bug: counts all accounts (running, transitioning, stopped, error, offline).
 */
interface FleetMetrics {
  nodesTotal: number;
  nodesOnline: number;
  nodesOffline: number;
  nodesError: number;
  nodesNeedingAttention: number;

  accountsTotal: number;
  accountsRunning: number;
  accountsTransitioning: number;
  accountsStopped: number;
  accountsError: number;
  accountsOffline: number;
  accountsNeedingAttention: number;
}

export default function DashboardPage() {
  const { devices, accounts, loadingFleet, reloadFleet } = useZeusStore();
  const { push } = useToast();

  async function handleRefresh() {
    try {
      await reloadFleet();
      push("info", "Fleet refreshed", `${devices.length} device(s) synchronized`);
    } catch (error) {
      push("error", "Refresh failed", describeError(error));
    }
  }

  // Derive metrics and grouping
  const metrics = useMemo(() => calculateFleetMetrics(devices, accounts), [devices, accounts]);
  const accountsByDevice = useMemo(() => groupAccounts(devices, accounts), [devices, accounts]);
  const attentionItems = useMemo(() => deriveAttentionItems(devices, accounts), [devices, accounts]);

  // Sort devices: nodes needing attention appear first to support the 2-second scan
  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const aUrgent = a.status === "error" ? 2 : a.status === "offline" ? 1 : 0;
      const bUrgent = b.status === "error" ? 2 : b.status === "offline" ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return a.name.localeCompare(b.name);
    });
  }, [devices]);

  return (
    <div className="space-y-5">
      {/* 1. Page Header */}
      <PageHeader
        title="Fleet Operations"
        subtitle={`${metrics.nodesTotal} VPS nodes · ${metrics.accountsTotal} accounts registered`}
        actions={
          <div className="flex items-center gap-2">
            <ButtonLink href="/pair" size="sm" variant="secondary" icon={<IconPlug />}>
              Pair Node
            </ButtonLink>
            <Button
              size="sm"
              busy={loadingFleet}
              onClick={handleRefresh}
              icon={<IconRefresh />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* 2. Fleet Status Strip (Replaces generic 5 KPI cards) */}
      <FleetStatusStrip metrics={metrics} />

      {/* 3. Attention Layer (Only renders when actionable issues exist; non-dismissible) */}
      {attentionItems.length > 0 ? (
        <section aria-labelledby="attention-layer-heading" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2
              id="attention-layer-heading"
              className="flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider text-danger uppercase"
            >
              <span className="size-1.5 rotate-45 rounded-[1px] bg-danger" aria-hidden="true" />
              Action Required ({attentionItems.length})
            </h2>
            <span className="text-[11px] text-muted">Items remain active until resolved</span>
          </div>

          <div className="space-y-2">
            {attentionItems.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 4. Operational Nodes Grid */}
      <section aria-labelledby="nodes-heading" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 id="nodes-heading" className="text-xs font-semibold tracking-wider text-muted uppercase">
            Active Fleet ({devices.length})
          </h2>
          <span className="text-[11px] text-muted">Sorted by operational priority</span>
        </div>

        {loadingFleet && devices.length === 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <NodeSkeleton />
            <NodeSkeleton />
          </div>
        ) : devices.length === 0 ? (
          <Card className="flex flex-col items-center justify-center border-dashed border-border px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No VPS nodes registered to this fleet</p>
            <p className="mt-1 text-xs text-muted">
              Connect your first node using the pair code displayed on your server console.
            </p>
            <div className="mt-4">
              <ButtonLink href="/pair" variant="primary" size="sm" icon={<IconPlug />}>
                Pair First Node
              </ButtonLink>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sortedDevices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                accounts={accountsByDevice.get(device.deviceId) ?? []}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Fleet Status Strip — Concise, data-dense status bar.
 */
function FleetStatusStrip({ metrics }: { metrics: FleetMetrics }) {
  const nodesAllGood = metrics.nodesNeedingAttention === 0;
  const accountsAllGood = metrics.accountsNeedingAttention === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs">
      {/* Nodes Summary */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Nodes:</span>
        <span className="font-mono font-medium text-foreground tabular">
          {metrics.nodesOnline}/{metrics.nodesTotal} Online
        </span>
        {!nodesAllGood ? (
          <span className="inline-flex items-center gap-1 rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-danger">
            {metrics.nodesNeedingAttention} Need Attention
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-online/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-online">
            All Healthy
          </span>
        )}
      </div>

      {/* Separator on wider screens */}
      <div className="hidden h-3 w-px bg-border sm:block" aria-hidden="true" />

      {/* Accounts Summary */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Accounts:</span>
        <span className="font-mono font-medium text-foreground tabular">
          {metrics.accountsRunning} Running
        </span>
        {metrics.accountsTransitioning > 0 ? (
          <span className="font-mono text-warning tabular">
            · {metrics.accountsTransitioning} In Flight
          </span>
        ) : null}
        <span className="font-mono text-muted tabular">
          · {metrics.accountsStopped} Stopped
        </span>
        {!accountsAllGood ? (
          <span className="inline-flex items-center gap-1 rounded bg-danger/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-danger">
            {metrics.accountsNeedingAttention} Error
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Attention Row — Clean, non-dismissible operational alert strip.
 */
function AttentionRow({ item }: { item: AttentionItem }) {
  const isDanger = item.severity === "danger";

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
        isDanger
          ? "border-danger/40 bg-danger/5 text-foreground"
          : "border-warning/40 bg-warning/5 text-foreground"
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span
          className={`mt-0.5 size-2 shrink-0 ${
            isDanger ? "rotate-45 rounded-[1px] bg-danger" : "rounded-full bg-warning"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${isDanger ? "text-danger" : "text-warning"}`}>
              {item.title}
            </span>
            <span className="text-xs text-muted">·</span>
            <span className="font-mono text-xs text-foreground truncate">{item.location}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted truncate">{item.reason}</p>
        </div>
      </div>

      <div className="shrink-0 self-end sm:self-auto">
        <ButtonLink
          href={item.actionHref}
          size="sm"
          variant={isDanger ? "danger" : "secondary"}
        >
          {item.actionLabel}
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * Skeleton Card for loading state.
 */
function NodeSkeleton() {
  return (
    <Card className="flex flex-col p-4 animate-pulse">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="h-4 w-32 rounded bg-elevated" />
        <div className="h-4 w-16 rounded-full bg-elevated" />
      </div>
      <div className="my-4 h-3 w-48 rounded bg-elevated" />
      <div className="space-y-2 border-t border-border/40 pt-3">
        <div className="h-8 rounded bg-elevated" />
        <div className="h-8 rounded bg-elevated" />
      </div>
      <div className="mt-4 flex gap-2 border-t border-border/40 pt-3">
        <div className="h-8 flex-1 rounded bg-elevated" />
        <div className="h-8 flex-1 rounded bg-elevated" />
      </div>
    </Card>
  );
}

/**
 * Deterministic calculation of fleet metrics.
 * Fixes previous bug by accounting for all 6 account statuses.
 */
function calculateFleetMetrics(devices: Device[], accounts: Account[]): FleetMetrics {
  let nodesOnline = 0;
  let nodesOffline = 0;
  let nodesError = 0;

  for (const device of devices) {
    if (device.status === "online") nodesOnline++;
    else if (device.status === "error") nodesError++;
    else nodesOffline++;
  }

  let accountsRunning = 0;
  let accountsTransitioning = 0;
  let accountsStopped = 0;
  let accountsError = 0;
  let accountsOffline = 0;

  for (const account of accounts) {
    if (account.status === "running") accountsRunning++;
    else if (account.status === "starting" || account.status === "restarting") accountsTransitioning++;
    else if (account.status === "stopped") accountsStopped++;
    else if (account.status === "error") accountsError++;
    else if (account.status === "offline") accountsOffline++;
  }

  const nodesNeedingAttention = nodesError + nodesOffline;

  // Derive accounts with actionable issues
  let accountsNeedingAttention = accountsError + accountsOffline;
  for (const account of accounts) {
    if (account.status !== "error" && account.status !== "offline") {
      if (
        account.config_status === "version_mismatch" ||
        (account.snapshot !== null && account.snapshot.ctl !== 1)
      ) {
        accountsNeedingAttention++;
      }
    }
  }

  return {
    nodesTotal: devices.length,
    nodesOnline,
    nodesOffline,
    nodesError,
    nodesNeedingAttention,
    accountsTotal: accounts.length,
    accountsRunning,
    accountsTransitioning,
    accountsStopped,
    accountsError,
    accountsOffline,
    accountsNeedingAttention,
  };
}

/**
 * Derives attention items from real fleet data according to strict priority rules.
 */
function deriveAttentionItems(devices: Device[], accounts: Account[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const deviceNameMap = new Map<string, string>(devices.map((d) => [d.deviceId, d.name]));

  // 1. Device Errors
  for (const device of devices) {
    if (device.status === "error") {
      items.push({
        id: `device-error-${device.id}`,
        severity: "danger",
        title: "Node Error",
        location: `${device.name} (${device.deviceId})`,
        reason: "Device reported error state. Agent or container requires inspection.",
        actionLabel: "Inspect Node",
        actionHref: `/device/${device.deviceId}`,
      });
    }
  }

  // 2. Device Offline
  for (const device of devices) {
    if (device.status === "offline") {
      items.push({
        id: `device-offline-${device.id}`,
        severity: "warning",
        title: "Node Offline",
        location: `${device.name} (${device.deviceId})`,
        reason: `Heartbeat lost · Last seen ${formatRelativeTime(device.lastSeen)}.`,
        actionLabel: "Inspect Node",
        actionHref: `/device/${device.deviceId}`,
      });
    }
  }

  // 3. Account Errors
  for (const account of accounts) {
    if (account.status === "error") {
      const nodeName = deviceNameMap.get(account.deviceId) ?? account.deviceId;
      items.push({
        id: `account-error-${account.id}`,
        severity: "danger",
        title: "Account Failure",
        location: `${account.label} on ${nodeName}`,
        reason: "Bot process exited unexpectedly with an error.",
        actionLabel: "Manage Account",
        actionHref: `/device/${account.deviceId}/accounts`,
      });
    }
  }

  // 4. Config Version Mismatch (Agent refused config)
  for (const account of accounts) {
    if (account.config_status === "version_mismatch") {
      items.push({
        id: `config-mismatch-${account.id}`,
        severity: "danger",
        title: "Config Version Mismatch",
        location: account.label,
        reason: "Control schema version does not match jar. Config apply was refused.",
        actionLabel: "Fix Config",
        actionHref: `/account/${account.id}/config`,
      });
    }
  }

  // 5. Control Rejected (ctl != 1 while snapshot exists)
  for (const account of accounts) {
    if (
      account.status !== "error" &&
      account.snapshot !== null &&
      account.snapshot.ctl !== 1
    ) {
      items.push({
        id: `ctl-rejected-${account.id}`,
        severity: "warning",
        title: `Control Rejected (ctl=${account.snapshot.ctl})`,
        location: account.label,
        reason: "Jar reports control file was unaccepted or property missing.",
        actionLabel: "Configure",
        actionHref: `/account/${account.id}/config`,
      });
    }
  }

  return items;
}

/**
 * Group accounts by device ID.
 */
function groupAccounts(devices: Device[], accounts: Account[]): Map<string, Account[]> {
  const known = new Set(devices.map((device) => device.deviceId));
  const grouped = new Map<string, Account[]>();
  for (const account of accounts) {
    if (!known.has(account.deviceId)) continue;
    const bucket = grouped.get(account.deviceId);
    if (bucket === undefined) grouped.set(account.deviceId, [account]);
    else bucket.push(account);
  }
  return grouped;
}

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

function IconPlug() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path
        d="M6 1v3M10 1v3M4 4h8l-1 5H5L4 4zM6 9v2a2 2 0 0 0 4 0V9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

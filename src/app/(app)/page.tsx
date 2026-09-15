"use client";

import { DeviceCard } from "@/components/devices/device-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { describeError } from "@/services/api";
import { useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import type { Account, Device, FleetSummary } from "@/lib/types";

/**
 * Fleet overview: summary counters + one card per VPS.
 * Accounts are grouped per device so a card renders without a second fetch.
 */
export default function DashboardPage() {
  const { devices, accounts, loadingFleet, reloadFleet } = useZeusStore();
  const { push } = useToast();

  async function handleRefresh() {
    try {
      await reloadFleet();
      push("info", "Fleet refreshed", `${devices.length} device(s) re-read`);
    } catch (error) {
      push("error", "Refresh failed", describeError(error));
    }
  }

  const summary = summarize(devices, accounts);
  const accountsByDevice = groupAccounts(devices, accounts);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${summary.devices} VPS · ${summary.accounts} accounts`}
        actions={
          <Button
            size="sm"
            busy={loadingFleet}
            onClick={handleRefresh}
            icon={<IconRefresh />}
          >
            Refresh
          </Button>
        }
      />

      <SummaryGrid summary={summary} />

      {loadingFleet && devices.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted">Loading devices…</Card>
      ) : devices.length === 0 ? (
        <Card className="px-4 py-10 text-center text-sm text-muted">
          No VPS registered to this account yet.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              accounts={accountsByDevice.get(device.deviceId) ?? []}
            />
          ))}
        </div>
      )}
    </>
  );
}

function summarize(devices: Device[], accounts: Account[]): FleetSummary {
  const summary: FleetSummary = {
    devices: devices.length,
    accounts: accounts.length,
    running: 0,
    stopped: 0,
    error: 0,
    devicesOnline: 0,
  };
  for (const device of devices) {
    if (device.status === "online") summary.devicesOnline += 1;
  }
  for (const account of accounts) {
    if (account.status === "running") summary.running += 1;
    else if (account.status === "stopped") summary.stopped += 1;
    else if (account.status === "error") summary.error += 1;
  }
  return summary;
}

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

function SummaryGrid({ summary }: { summary: FleetSummary }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Counter label="VPS" value={summary.devices} hint={`${summary.devicesOnline} online`} />
      <Counter label="Accounts" value={summary.accounts} />
      <Counter label="Running" value={summary.running} tone="online" />
      <Counter label="Stopped" value={summary.stopped} tone="offline" />
      <Counter label="Error" value={summary.error} tone={summary.error > 0 ? "danger" : "offline"} />
    </div>
  );
}

function Counter({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "online" | "offline" | "danger";
}) {
  const toneClass =
    tone === "online"
      ? "text-online"
      : tone === "danger"
        ? "text-danger"
        : tone === "offline"
          ? "text-muted"
          : "text-foreground";
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-1 font-mono text-2xl tabular ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </Card>
  );
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

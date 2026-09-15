"use client";

import { use, useState } from "react";
import { AccountCard } from "@/components/accounts/account-card";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { DeviceStatusBadge } from "@/components/ui/status";
import { useZeusStore } from "@/store/zeus-store";
import type { AccountStatus } from "@/lib/types";

/**
 * Account management for one VPS: status filter + the full account list.
 * The filter is local UI state; nothing is refetched when it changes.
 */

/** Chip order. Only statuses actually present on this VPS get a chip. */
const STATUS_ORDER: AccountStatus[] = [
  "running",
  "starting",
  "restarting",
  "stopped",
  "error",
  "offline",
];

export default function DeviceAccountsPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = use(params);
  const { devices, accountsOf } = useZeusStore();
  const [filter, setFilter] = useState<AccountStatus | "all">("all");

  const device = devices.find((item) => item.deviceId === deviceId);
  if (device === undefined) {
    return (
      <NotFoundPanel
        title="Device not found"
        hint="No VPS with this device ID is registered to your account."
        identifier={deviceId}
      />
    );
  }

  const accounts = accountsOf(device.deviceId);

  // Chips come from the statuses that exist here, so the per-status counts
  // always add up to "All" and no status is unfilterable.
  const counts = new Map<AccountStatus, number>();
  for (const account of accounts) {
    counts.set(account.status, (counts.get(account.status) ?? 0) + 1);
  }
  const chips = [
    { id: "all" as const, label: "All", count: accounts.length },
    ...STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
      id: status,
      label: status.charAt(0).toUpperCase() + status.slice(1),
      count: counts.get(status) ?? 0,
    })),
  ];

  // A live status change can empty the selected chip; fall back to "all".
  const activeFilter = chips.some((chip) => chip.id === filter) ? filter : "all";
  const visible =
    activeFilter === "all"
      ? accounts
      : accounts.filter((account) => account.status === activeFilter);

  return (
    <>
      <PageHeader
        back={{ href: `/device/${device.deviceId}`, label: device.name }}
        title="Accounts"
        subtitle={
          <span className="flex items-center gap-2">
            <span className="font-mono">{device.name}</span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        actions={
          <ButtonLink
            href={`/device/${device.deviceId}/viewer`}
            size="sm"
            variant="primary"
            disabled={device.status !== "online"}
          >
            Open Viewer
          </ButtonLink>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map((option) => {
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={activeFilter === option.id}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeFilter === option.id
                  ? "border-accent bg-accent/12 text-accent"
                  : "border-border bg-elevated text-muted hover:text-foreground"
              }`}
            >
              {option.label}
              <span className="ml-1.5 font-mono text-[11px] opacity-70">{option.count}</span>
            </button>
          );
        })}
      </div>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            title="No accounts yet"
            hint="Accounts appear here once the Zeus Agent registers them on this VPS."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              disabledReason={
                device.status === "online" ? undefined : "Device offline — commands unavailable"
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

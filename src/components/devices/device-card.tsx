import Link from "next/link";
import type { Account, Device } from "@/lib/types";
import { formatRam, formatRelativeTime, formatUptime } from "@/lib/format";
import { AccountStatusBadge, DeviceStatusBadge, MetricBar } from "@/components/ui/status";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";

/**
 * Dashboard VPS card. Mirrors the spec layout: name + status on top, metrics,
 * then the account rows, then [Manage] / [View].
 * Offline devices drop metrics for "Last seen" since there is nothing live.
 */
export function DeviceCard({ device, accounts }: { device: Device; accounts: Account[] }) {
  const online = device.status === "online";
  const detailHref = `/device/${device.deviceId}`;

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <Link href={detailHref} className="truncate font-mono text-sm font-semibold hover:text-accent">
            {device.name}
          </Link>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{device.deviceId}</p>
        </div>
        <DeviceStatusBadge status={device.status} />
      </div>

      <div className="mt-4 px-4">
        {online ? (
          <dl className="space-y-3">
            <Metric
              label="CPU"
              value={`${Math.round(device.metrics.cpu)}%`}
              percent={device.metrics.cpu}
            />
            <Metric
              label="RAM"
              value={formatRam(device.metrics.ramUsedMb, device.metrics.ramTotalMb)}
              percent={(device.metrics.ramUsedMb / device.metrics.ramTotalMb) * 100}
            />
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-muted">Uptime</dt>
              <dd className="font-mono text-xs tabular">{formatUptime(device.metrics.uptimeSeconds)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted">
            Last seen {formatRelativeTime(device.lastSeen)}
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-border px-4 py-3">
        <p className="mb-2 text-[11px] tracking-wide text-muted uppercase">
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </p>
        <ul className="space-y-1.5">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-sm">{account.label}</span>
              <AccountStatusBadge status={account.status} />
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto flex gap-2 border-t border-border px-4 py-3">
        <ButtonLink href={`${detailHref}/accounts`} variant="primary" className="flex-1">
          Manage
        </ButtonLink>
        <ButtonLink href={detailHref} className="flex-1">
          View
        </ButtonLink>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="font-mono text-xs tabular">{value}</dd>
      </div>
      <div className="mt-1.5">
        <MetricBar percent={percent} />
      </div>
    </div>
  );
}

import Link from "next/link";
import type { Account, Device } from "@/lib/types";
import { formatRam, formatRelativeTime, formatUptime } from "@/lib/format";
import { AccountStatusBadge, DeviceStatusBadge } from "@/components/ui/status";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";

/**
 * Operational Node Card — Storm Steel.
 * Compact master row/panel designed for fast 2-second fleet scanning.
 * Prioritizes device identity and account operational states over heavy telemetry bars.
 */
export function DeviceCard({
  device,
  accounts,
}: {
  device: Device;
  accounts: Account[];
}) {
  const online = device.status === "online";
  const detailHref = `/device/${device.deviceId}`;

  return (
    <Card className="flex flex-col border border-border bg-surface transition-colors hover:border-border-interactive/60">
      {/* Node Header Row */}
      <div className="flex items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
        <div className="min-w-0">
          <Link
            href={detailHref}
            className="truncate font-mono text-sm font-semibold tracking-tight text-foreground hover:text-accent"
          >
            {device.name}
          </Link>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
            {device.deviceId} · {device.region}
          </p>
        </div>
        <DeviceStatusBadge status={device.status} />
      </div>

      {/* Subordinate Hardware Facts */}
      <div className="border-b border-border/40 bg-elevated/20 px-4 py-2 text-xs text-muted">
        {online ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular">
            <span>CPU <strong className="font-semibold text-foreground">{Math.round(device.metrics.cpu)}%</strong></span>
            <span className="text-border">·</span>
            <span>RAM <strong className="font-semibold text-foreground">{formatRam(device.metrics.ramUsedMb, device.metrics.ramTotalMb)}</strong></span>
            <span className="text-border">·</span>
            <span>Up <strong className="font-semibold text-foreground">{formatUptime(device.metrics.uptimeSeconds)}</strong></span>
          </div>
        ) : (
          <p className="font-mono text-[11px] text-muted">
            Last seen {formatRelativeTime(device.lastSeen)}
          </p>
        )}
      </div>

      {/* Accounts List */}
      <div className="flex-1 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            Accounts ({accounts.length})
          </span>
          {accounts.length === 0 ? (
            <span className="text-[11px] text-muted">No accounts assigned</span>
          ) : null}
        </div>

        {accounts.length > 0 ? (
          <ul className="space-y-2">
            {accounts.map((account) => {
              const hasConfigIssue = account.config_status === "version_mismatch";
              const hasCtlIssue = account.snapshot !== null && account.snapshot.ctl !== 1;
              const isAliveWaiting =
                account.status === "running" && account.snapshot === null;

              return (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-elevated/30 px-2.5 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-medium text-foreground">{account.label}</span>
                      {account.characterName ? (
                        <span className="truncate text-muted">({account.characterName})</span>
                      ) : null}
                    </div>

                    {/* Operational sub-status note */}
                    {hasConfigIssue ? (
                      <p className="mt-0.5 text-[10px] text-danger">Config Version Mismatch</p>
                    ) : hasCtlIssue ? (
                      <p className="mt-0.5 text-[10px] text-warning">Control Rejected (ctl={account.snapshot?.ctl})</p>
                    ) : isAliveWaiting ? (
                      <p className="mt-0.5 text-[10px] text-muted">Waiting for telemetry</p>
                    ) : account.snapshot ? (
                      <p className="mt-0.5 font-mono text-[10px] text-muted">
                        Lv {account.snapshot.lv}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0">
                    <AccountStatusBadge status={account.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Action Footer */}
      <div className="mt-auto flex items-center gap-2 border-t border-border px-4 py-2.5">
        <ButtonLink
          href={`${detailHref}/accounts`}
          size="sm"
          variant="secondary"
          className="flex-1"
        >
          Manage Accounts
        </ButtonLink>
        <ButtonLink
          href={`${detailHref}/viewer`}
          size="sm"
          variant={online ? "primary" : "secondary"}
          disabled={!online}
          className="flex-1"
        >
          Open Viewer
        </ButtonLink>
      </div>
    </Card>
  );
}

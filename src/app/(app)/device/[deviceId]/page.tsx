"use client";

import { use } from "react";
import { NotFoundPanel } from "@/components/not-found-panel";
import { AccountCard } from "@/components/accounts/account-card";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, FactRow } from "@/components/ui/card";
import { DeviceStatusBadge, MetricBar } from "@/components/ui/status";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import { buildVncUrl, formatRam, formatRelativeTime, formatUptime } from "@/lib/format";
import type { Device } from "@/lib/types";

/**
 * VPS detail: identity, live metrics, viewer availability, account list and
 * Refresh / Open VNC / Manage accounts actions.
 *
 * Route param is `deviceId` (the agent fingerprint), matching the sidebar and
 * the viewer route; the internal `id` is never in a URL.
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
        hint="No VPS with this device ID is registered to your account."
        identifier={deviceId}
      />
    );
  }
  // Rebinding keeps the narrowed type inside the async handlers below.
  const device: Device = found;

  const accounts = accountsOf(device.deviceId);
  const online = device.status === "online";
  const busy = isPending(pendingKey.device(device.deviceId));
  const vncUrl = buildVncUrl(device.viewer_url);
  const vncAvailable = online && Boolean(vncUrl);

  async function handleRefresh() {
    try {
      await refreshDevice(device.deviceId);
      push("success", "Device refreshed", `${device.name} heartbeat updated`);
    } catch (error) {
      push("error", "Refresh failed", describeError(error));
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: "/", label: "Dashboard" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{device.name}</span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        subtitle={<span className="font-mono text-xs">{device.deviceId}</span>}
        actions={
          <>
            <Button size="sm" busy={busy} onClick={handleRefresh} icon={<IconRefresh />}>
              Refresh
            </Button>
            <ButtonLink
              href={vncUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              variant={vncAvailable ? "primary" : "secondary"}
              disabled={!vncAvailable}
              title={!online ? "Node offline" : !vncUrl ? "VNC URL is not available for this node." : "Open VNC in new tab"}
            >
              Open VNC
            </ButtonLink>
            <ButtonLink href={`/device/${device.deviceId}/accounts`} size="sm">
              Manage accounts
            </ButtonLink>
          </>
        }
      />

      {!online ? (
        <Card className="mb-4 border-warning/40 bg-warning/8 px-4 py-3">
          <p className="text-sm text-warning">
            {device.name} is offline. Commands and VNC are unavailable until the agent
            reconnects — last heartbeat {formatRelativeTime(device.lastSeen)}.
          </p>
        </Card>
      ) : !vncUrl ? (
        <Card className="mb-4 border-warning/40 bg-warning/8 px-4 py-3">
          <p className="text-sm text-warning">
            VNC URL is not available for this node.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Runtime" />
            <div className="px-4 py-3">
              {online ? (
                <>
                  <div className="mb-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-xs text-muted">CPU</span>
                      <span className="font-mono text-xs tabular">
                        {Math.round(device.metrics.cpu)}%
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <MetricBar percent={device.metrics.cpu} />
                    </div>
                  </div>
                  <div className="mb-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-xs text-muted">RAM</span>
                      <span className="font-mono text-xs tabular">
                        {formatRam(device.metrics.ramUsedMb, device.metrics.ramTotalMb)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <MetricBar
                        percent={(device.metrics.ramUsedMb / device.metrics.ramTotalMb) * 100}
                      />
                    </div>
                  </div>
                  <dl className="divide-y divide-border border-t border-border pt-2">
                    <FactRow label="Uptime" value={formatUptime(device.metrics.uptimeSeconds)} mono />
                    <FactRow label="Last seen" value={formatRelativeTime(device.lastSeen)} />
                    <FactRow label="VNC" value={vncUrl ? "Available" : "Not configured"} />
                  </dl>
                </>
              ) : (
                <dl className="divide-y divide-border">
                  <FactRow label="Last seen" value={formatRelativeTime(device.lastSeen)} />
                  <FactRow label="Uptime" value="—" mono />
                  <FactRow label="VNC" value="Node offline" />
                </dl>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Agent" />
            <dl className="divide-y divide-border px-4 py-2">
              <FactRow label="Region" value={device.region} />
              <FactRow label="Agent version" value={device.agentVersion} mono />
              <FactRow label="Runtime version" value={device.runtimeVersion} mono />
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Accounts"
              subtitle={`${accounts.length} on this VPS`}
              actions={
                <ButtonLink
                  href={`/device/${device.deviceId}/accounts`}
                  size="sm"
                  variant="ghost"
                >
                  Manage
                </ButtonLink>
              }
            />
            {accounts.length === 0 ? (
              <EmptyState
                title="No accounts on this VPS"
                hint="Accounts created by the Zeus Agent appear here once they register."
              />
            ) : (
              <div className="space-y-3 p-4">
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    disabledReason={online ? undefined : "Device offline — commands queued only"}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
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

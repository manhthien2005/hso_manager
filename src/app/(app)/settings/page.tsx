"use client";

import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, EmptyState, FactRow } from "@/components/ui/card";
import { DeviceStatusBadge } from "@/components/ui/status";
import { ButtonLink } from "@/components/ui/button";
import { useZeusStore } from "@/store/zeus-store";
import { formatRelativeTime } from "@/lib/format";

/**
 * Device information panel — the Supabase `devices` rows for this user.
 * Read-only in this phase: name, device ID, Railway region, last seen and the
 * agent/runtime versions the VPS reported.
 */
export default function SettingsPage() {
  const { devices, user } = useZeusStore();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Registered devices and the versions they report"
      />

      <Card className="mb-4">
        <CardHeader title="Account" />
        <dl className="divide-y divide-border px-4 py-2">
          <FactRow label="Signed in as" value={user?.displayName ?? "—"} />
          <FactRow label="Username" value={user?.username ?? "—"} mono />
          <FactRow label="Email" value={user?.email ?? "—"} />
        </dl>
      </Card>

      {devices.length === 0 ? (
        <Card>
          <EmptyState
            title="No devices registered"
            hint="Devices appear here once their Zeus Agent connects and claims this account."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {devices.map((device) => (
            <Card key={device.id}>
              <CardHeader
                title={<span className="font-mono">{device.name}</span>}
                subtitle={<span className="font-mono text-xs">{device.deviceId}</span>}
                actions={
                  <>
                    <DeviceStatusBadge status={device.status} />
                    <ButtonLink href={`/device/${device.deviceId}`} size="sm">
                      Details
                    </ButtonLink>
                  </>
                }
              />
              <dl className="divide-y divide-border px-4 py-2">
                <FactRow label="Device name" value={device.name} />
                <FactRow label="Device ID" value={device.deviceId} mono />
                <FactRow label="Railway region" value={device.region} />
                <FactRow label="Last seen" value={formatRelativeTime(device.lastSeen)} />
                <FactRow label="Agent version" value={device.agentVersion} mono />
                <FactRow label="Runtime version" value={device.runtimeVersion} mono />
                <FactRow
                  label="Viewer tunnel"
                  value={device.viewerAvailable ? "Available" : "Not registered"}
                />
              </dl>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

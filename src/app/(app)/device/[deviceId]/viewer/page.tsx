"use client";

import { use } from "react";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeviceStatusBadge } from "@/components/ui/status";
import { useZeusStore } from "@/store/zeus-store";
import { buildVncUrl, formatRelativeTime } from "@/lib/format";
import type { Device } from "@/lib/types";

/**
 * Remote VNC launch page.
 *
 * Direct noVNC access is handled by opening the canonical URL in a new browser tab:
 * https://<node-domain>/vnc.html?autoconnect=1&resize=scale&path=websockify
 *
 * The dashboard does not embed an iframe or manage WebSocket transport.
 */
export default function ViewerPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = use(params);
  const { devices } = useZeusStore();

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
  const device: Device = found;

  const online = device.status === "online";
  const vncUrl = buildVncUrl(device.viewer_url);
  const vncAvailable = online && Boolean(vncUrl);

  return (
    <>
      <PageHeader
        back={{ href: `/device/${device.deviceId}`, label: device.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Remote VNC</span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs">
            {device.deviceId} · last seen {formatRelativeTime(device.lastSeen)}
          </span>
        }
      />

      <Card className="p-6">
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <div className="max-w-md space-y-2">
            <h2 className="text-base font-semibold text-foreground">
              Direct noVNC Remote Desktop
            </h2>
            {!online ? (
              <p className="text-sm text-warning">
                {device.name} is offline — remote desktop requires an active online agent.
              </p>
            ) : !vncUrl ? (
              <p className="text-sm text-warning">
                VNC URL is not available for this node.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Direct noVNC access is available. Click below to open the remote desktop session directly in a new browser tab.
              </p>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink
              href={vncUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              variant="primary"
              size="md"
              disabled={!vncAvailable}
              title={!online ? "Node offline" : !vncUrl ? "VNC URL is not available for this node." : "Open VNC in new tab"}
            >
              Open VNC in New Tab
            </ButtonLink>
            <ButtonLink href={`/device/${device.deviceId}`} variant="secondary" size="md">
              Back to Device
            </ButtonLink>
            <ButtonLink href={`/device/${device.deviceId}/accounts`} variant="secondary" size="md">
              Manage Accounts
            </ButtonLink>
          </div>
        </div>
      </Card>
    </>
  );
}

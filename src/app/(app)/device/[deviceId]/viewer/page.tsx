"use client";

import { use } from "react";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeviceStatusBadge } from "@/components/ui/status";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import { formatRelativeTime } from "@/lib/format";
import type { Device } from "@/lib/types";

/**
 * Remote viewer host page.
 *
 * `ViewerSurface` is the only place noVNC will ever be mounted: today it draws
 * the placeholder, later it attaches a noVNC client to `session.url`. Nothing
 * else in the app imports noVNC or knows about the transport.
 *
 * The session itself lives in the store (loaded with the fleet), so this page
 * holds no data-fetching effect.
 */
export default function ViewerPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = use(params);
  const {
    devices,
    viewerSessionOf,
    connectViewer,
    disconnectViewer,
    isPending,
  } = useZeusStore();
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

  const session = viewerSessionOf(device.deviceId);
  const busy = isPending(pendingKey.viewer(deviceId));
  const online = device.status === "online";
  const connected = session?.state === "connected";

  async function handleConnect() {
    try {
      await connectViewer(device.deviceId);
      push("info", "Viewer session opened", "Mock transport — noVNC not wired yet");
    } catch (error) {
      push("error", "Connect failed", describeError(error));
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectViewer(device.deviceId);
      push("success", "Viewer closed", `${device.name} session ended`);
    } catch (error) {
      push("error", "Disconnect failed", describeError(error));
    }
  }

  return (
    <>
      <PageHeader
        back={{ href: `/device/${device.deviceId}`, label: device.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Remote Viewer</span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs">
            {device.deviceId} · last seen {formatRelativeTime(device.lastSeen)}
          </span>
        }
      />

      <Card className="overflow-hidden">
        <ViewerSurface
          online={online}
          connected={connected}
          busy={busy}
          reason={session?.reason ?? null}
          deviceName={device.name}
        />
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {connected ? (
          <Button variant="danger" busy={busy} onClick={handleDisconnect}>
            Disconnect
          </Button>
        ) : (
          <Button
            variant="primary"
            busy={busy}
            disabled={!online || !device.viewerAvailable}
            onClick={handleConnect}
          >
            Connect
          </Button>
        )}
        <ButtonLink href={`/device/${device.deviceId}/accounts`}>Manage accounts</ButtonLink>
        {!device.viewerAvailable ? (
          <p className="text-xs text-warning">
            No viewer tunnel registered for {device.name}.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The mount point for the future noVNC client.
 * Swap the placeholder body for `<RFB …/>` against `session.url`; the props
 * below are all it needs.
 */
function ViewerSurface({
  online,
  connected,
  busy,
  reason,
  deviceName,
}: {
  online: boolean;
  connected: boolean;
  busy: boolean;
  reason: string | null;
  deviceName: string;
}) {
  return (
    <div
      className="flex aspect-video w-full flex-col items-center justify-center gap-3 border-border bg-[repeating-linear-gradient(45deg,var(--surface),var(--surface)_10px,var(--elevated)_10px,var(--elevated)_20px)] px-6 text-center"
      data-viewer-host="novnc"
      aria-busy={busy}
    >
      <p className="font-mono text-sm tracking-wide text-muted">Remote Viewer</p>

      {connected ? (
        <>
          <p className="text-sm text-foreground">Session open on {deviceName}</p>
          {reason ? <p className="max-w-md text-xs text-muted">{reason}</p> : null}
          <p className="text-xs text-muted">
            The noVNC canvas renders in this frame once the Railway tunnel exists.
          </p>
        </>
      ) : online ? (
        <p className="text-sm text-muted">No session active</p>
      ) : (
        <p className="text-sm text-muted">
          {deviceName} is offline — the viewer needs a live agent.
        </p>
      )}

      <span className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1 text-[11px] text-muted">
        <span
          className={`size-1.5 rounded-full ${connected ? "bg-online" : "bg-offline"}`}
          aria-hidden="true"
        />
        {connected ? "connected" : "disconnected"}
      </span>
    </div>
  );
}

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
    console.log("[viewer] View clicked, device id:", device.deviceId);
    try {
      await connectViewer(device.deviceId);
      push("success", "Viewer session opened", `Connected to ${device.name}`);
    } catch (error) {
      console.error("[viewer] viewer open failed:", error);
      push("error", "Connect failed", describeError(error));
    }
  }

  async function handleDisconnect() {
    console.log("[viewer] Disconnect clicked, device id:", device.deviceId);
    try {
      await disconnectViewer(device.deviceId);
      push("success", "Viewer closed", `${device.name} session ended`);
    } catch (error) {
      console.error("[viewer] disconnect failed:", error);
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
          url={session?.url}
        />
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            <Button variant="danger" busy={busy} onClick={handleDisconnect}>
              Disconnect
            </Button>
            {session?.url ? (
              <ButtonLink href={session.url} target="_blank" rel="noopener noreferrer" variant="secondary">
                Open in New Tab
              </ButtonLink>
            ) : null}
          </>
        ) : (
          <Button
            variant="primary"
            busy={busy}
            disabled={!online}
            onClick={handleConnect}
          >
            {busy ? "Opening Viewer…" : "Open Viewer"}
          </Button>
        )}
        <ButtonLink href={`/device/${device.deviceId}/accounts`}>Manage accounts</ButtonLink>
        {!online ? (
          <p className="text-xs text-warning">
            {device.name} is offline — the viewer needs a live agent.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The mount point for the noVNC client.
 * When session.url is available, embeds an iframe to display the live remote desktop.
 */
function ViewerSurface({
  online,
  connected,
  busy,
  reason,
  deviceName,
  url,
}: {
  online: boolean;
  connected: boolean;
  busy: boolean;
  reason: string | null;
  deviceName: string;
  url?: string | null;
}) {
  if (connected && url) {
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-black" data-viewer-host="novnc">
        <iframe
          src={url}
          className="h-full w-full border-0"
          title={`Remote Viewer - ${deviceName}`}
          allow="fullscreen; clipboard-read; clipboard-write"
        />
      </div>
    );
  }

  return (
    <div
      className="flex aspect-video w-full flex-col items-center justify-center gap-3 border-border bg-[repeating-linear-gradient(45deg,var(--surface),var(--surface)_10px,var(--elevated)_10px,var(--elevated)_20px)] px-6 text-center"
      data-viewer-host="novnc"
      aria-busy={busy}
    >
      <p className="font-mono text-sm tracking-wide text-muted">Remote Viewer</p>

      {busy ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Opening viewer tunnel…</p>
          <p className="text-xs text-muted">Sending open-viewer command to agent and awaiting noVNC URL…</p>
        </div>
      ) : connected ? (
        <>
          <p className="text-sm text-foreground">Session open on {deviceName}</p>
          {reason ? <p className="max-w-md text-xs text-muted">{reason}</p> : null}
        </>
      ) : online ? (
        <p className="text-sm text-muted">Click &ldquo;Open Viewer&rdquo; below to start a live noVNC session.</p>
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
        {connected ? "connected" : busy ? "connecting" : "disconnected"}
      </span>
    </div>
  );
}

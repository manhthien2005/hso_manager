"use client";

import { use } from "react";
import Link from "next/link";
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
 * Remote noVNC Viewer — Storm Steel.
 * Centers the remote game machine as primary content.
 * Honest connection lifecycle: Disconnected -> Connecting -> Connected / Error.
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
        hint="No VPS with this device ID is registered to your fleet."
        identifier={deviceId}
      />
    );
  }

  const device: Device = found;
  const session = viewerSessionOf(device.deviceId);
  const busy = isPending(pendingKey.viewer(deviceId));
  const online = device.status === "online";
  const connected = session?.state === "connected";

  async function handleConnect() {
    try {
      await connectViewer(device.deviceId);
      push("success", "Viewer opened", `Connected to ${device.name}`);
    } catch (error) {
      push("error", "Connect failed", describeError(error));
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectViewer(device.deviceId);
      push("info", "Viewer disconnected", `Session closed for ${device.name}`);
    } catch (error) {
      push("error", "Disconnect failed", describeError(error));
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. Header Navigation */}
      <PageHeader
        back={{ href: `/device/${device.deviceId}`, label: device.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl font-bold tracking-tight text-foreground">
              Remote Viewer
            </span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs text-muted">
            {device.name} ({device.deviceId}) · Heartbeat {formatRelativeTime(device.lastSeen)}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  busy={busy}
                  onClick={handleDisconnect}
                >
                  Disconnect
                </Button>
                {session?.url ? (
                  <ButtonLink
                    href={session.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    variant="secondary"
                    icon={<IconExternalLink />}
                  >
                    Pop Out
                  </ButtonLink>
                ) : null}
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                busy={busy}
                disabled={!online}
                onClick={handleConnect}
                icon={<IconMonitor />}
              >
                {busy ? "Connecting…" : "Open Viewer"}
              </Button>
            )}

            <ButtonLink
              href={`/device/${device.deviceId}/accounts`}
              size="sm"
              variant="secondary"
            >
              Accounts
            </ButtonLink>
          </div>
        }
      />

      {/* 2. Primary Remote Canvas Container */}
      <Card className="overflow-hidden border border-border bg-surface shadow-lg">
        {/* Status Bar above Viewer */}
        <div className="flex flex-wrap items-center justify-between border-b border-border/80 bg-elevated/40 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                connected
                  ? "bg-online"
                  : busy
                    ? "bg-warning animate-pulse"
                    : !online
                      ? "border border-offline bg-transparent"
                      : "bg-offline"
              }`}
              aria-hidden="true"
            />
            <span className="font-medium text-foreground">
              {connected
                ? "Live noVNC Stream Active"
                : busy
                  ? "Establishing Tunnel with Agent…"
                  : !online
                    ? "Node Offline — Viewer Unavailable"
                    : "Viewer Ready to Connect"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-muted font-mono">
            <span>Transport: {session?.transport || "noVNC"}</span>
            <span>·</span>
            <span>Display: 1280×720</span>
          </div>
        </div>

        {/* The Mount Point */}
        <ViewerSurface
          online={online}
          connected={connected}
          busy={busy}
          reason={session?.reason ?? null}
          deviceName={device.name}
          url={session?.url}
          onConnect={handleConnect}
        />
      </Card>

      {/* 3. Subordinate Session & Security Guidance */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted">
        <div className="flex items-center gap-2">
          <span>Session security: Temporary timed lease via secure proxy.</span>
        </div>
        <Link
          href={`/device/${device.deviceId}`}
          className="text-muted hover:text-accent transition-colors"
        >
          Return to {device.name} details →
        </Link>
      </div>
    </div>
  );
}

/**
 * The Mount Point for noVNC Client.
 * Displays clean Storm Steel placeholder when disconnected,
 * and live iframe when connected.
 */
function ViewerSurface({
  online,
  connected,
  busy,
  reason,
  deviceName,
  url,
  onConnect,
}: {
  online: boolean;
  connected: boolean;
  busy: boolean;
  reason: string | null;
  deviceName: string;
  url?: string | null;
  onConnect: () => void;
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
      className="flex aspect-video w-full flex-col items-center justify-center gap-4 bg-background/50 px-6 py-12 text-center"
      data-viewer-host="novnc"
      aria-busy={busy}
    >
      <div className="flex size-14 items-center justify-center rounded-xl border border-border bg-surface text-muted shadow-sm">
        <IconMonitorLarge />
      </div>

      <div className="max-w-md space-y-1">
        {busy ? (
          <>
            <p className="font-mono text-sm font-semibold text-foreground">
              Requesting remote tunnel…
            </p>
            <p className="text-xs text-muted">
              Sending <code className="font-mono text-foreground">open-viewer</code> command to Zeus agent and awaiting noVNC URL endpoint (may take up to 15s)…
            </p>
          </>
        ) : connected ? (
          <>
            <p className="font-mono text-sm font-semibold text-foreground">
              Session initialized on {deviceName}
            </p>
            {reason ? <p className="text-xs text-muted">{reason}</p> : null}
          </>
        ) : online ? (
          <>
            <p className="font-mono text-sm font-semibold text-foreground">
              Direct Desktop Control
            </p>
            <p className="text-xs text-muted">
              Stream and interact with the game window directly inside your browser over encrypted HTML5 noVNC.
            </p>
            <div className="pt-2">
              <Button size="sm" variant="primary" onClick={onConnect}>
                Start Session
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-mono text-sm font-semibold text-warning">
              Host Node Unreachable
            </p>
            <p className="text-xs text-muted">
              {deviceName} is currently offline. Remote viewer requires an active heartbeat connection with the host agent.
            </p>
          </>
        )}
      </div>

      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-[11px] text-muted">
        <span
          className={`size-1.5 rounded-full ${
            connected
              ? "bg-online"
              : busy
                ? "bg-warning animate-pulse"
                : "border border-offline bg-transparent"
          }`}
          aria-hidden="true"
        />
        <span>{connected ? "session:active" : busy ? "tunnel:negotiating" : "session:idle"}</span>
      </div>
    </div>
  );
}

function IconMonitor() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 14h5M8 11v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconMonitorLarge() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconExternalLink() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path
        d="M6 3.5H3.5A1.5 1.5 0 0 0 2 5v7.5A1.5 1.5 0 0 0 3.5 14H11a1.5 1.5 0 0 0 1.5-1.5V10M9.5 2h4.5v4.5M7 9l7-7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

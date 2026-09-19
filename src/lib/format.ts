/**
 * Pure presentation helpers. No React, no state — safe to import from anywhere.
 */

import type { Account, HealthStatus, PlayerSnapshot } from "@/lib/types";

export function formatRelativeTime(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return "never";
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatRam(usedMb: number, totalMb?: number): string {
  if (totalMb === undefined) return `${usedMb} MB`;
  return `${usedMb} / ${totalMb} MB`;
}

export function formatBytesMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** `HH:mm` -> minutes since midnight; returns null on malformed input. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ── Telemetry helpers (Task 14, C4) ──────────────────────────────────────────

/**
 * Three-state health per WIRE-CONTRACT §6.
 *
 *   running   ⟺ process alive AND ctl==1 AND atkstate>=0
 *   degraded  ⟺ process alive AND (ctl!=1 OR atkstate<0 OR snapshot unparseable)
 *   stopped   ⟺ process not running
 *
 * "process alive" is proxied by account.status !== "stopped" && account.status !== "offline",
 * because the agent reports the actual PID state via account.status.
 */
export function healthOf(account: Account): HealthStatus {
  const processAlive =
    account.status !== "stopped" && account.status !== "offline";

  if (!processAlive) return "stopped";

  const snap = account.snapshot;
  if (!snap) return "degraded"; // no snapshot yet = degraded until jar publishes

  if (snap.ctl !== 1) return "degraded";
  if (snap.atkstate < 0) return "degraded";

  return "running";
}

/**
 * XP as permille — client render: `bA/10 + "," + bA%10 + "%"`
 * e.g. xp=105 → "10,5%"
 */
export function formatXp(xp: number): string {
  return `${Math.floor(xp / 10)},${xp % 10}%`;
}

/**
 * Gold / gem — null means the wallet opcode (16) has not been delivered yet.
 * Show "—" rather than 0, which would look like the account has no money.
 */
export function formatGold(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString();
}

/**
 * `atkstate` readable label per WIRE-CONTRACT §5.2.
 */
export function formatAtkstate(atkstate: number): string {
  switch (atkstate) {
    case 0: return "Fighting";
    case 1: return "Returning";
    case 2: return "Stabilising";
    default: return "—";
  }
}

/**
 * `stuck` readable warning label per WIRE-CONTRACT §5.2.
 */
export function formatStuck(stuck: number): string | null {
  if (stuck === 0) return null;
  if (stuck === 1) return "No mobs";
  if (stuck === 2) return "Terrain stuck";
  return `Stuck (${stuck})`;
}

/**
 * Format snapshot for a quota field.
 * quota <= 0 means auto stopped.
 */
export function formatQuota(snap: PlayerSnapshot): string {
  if (snap.quota <= 0) return "0 (limit reached)";
  return String(snap.quota);
}

/**
 * Normalizes a raw viewer/VNC URL, base domain, or complete noVNC address
 * into the canonical noVNC URL for direct browser navigation.
 *
 * Guarantees:
 * - Appends /vnc.html if missing or base path only
 * - Injects canonical noVNC WebSocket parameters:
 *   - host: parsed.hostname (never contains protocol)
 *   - port: explicit URL port or default (443 for HTTPS, 80 for HTTP)
 *   - encrypt: 1 for HTTPS, 0 for HTTP
 *   - path: preserves existing path or defaults to 'websockify'
 * - Preserves unrelated existing query parameters (e.g. autoconnect, resize)
 * - Actively overrides stale browser localStorage settings in noVNC 1.0.0
 */
export function sanitizeViewerUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.includes("://") && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      return null;
    }

    const parsed = new URL(
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`
    );
    if (!parsed.hostname) return null;

    const isHttps = parsed.protocol === "https:";
    const isHttp = parsed.protocol === "http:";
    if (!isHttps && !isHttp) return null;

    // Ensure canonical noVNC page when path is empty or root
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/vnc.html";
    }

    // Force canonical WebSocket connection parameters
    parsed.searchParams.set("host", parsed.hostname);
    parsed.searchParams.set("port", parsed.port || (isHttps ? "443" : "80"));
    parsed.searchParams.set("encrypt", isHttps ? "1" : "0");

    if (!parsed.searchParams.get("path")) {
      parsed.searchParams.set("path", "websockify");
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Builds canonical noVNC URL with default UI parameters (autoconnect=1, resize=scale).
 */
export function buildVncUrl(rawUrl: string | null | undefined): string | null {
  const sanitized = sanitizeViewerUrl(rawUrl);
  if (!sanitized) return null;

  try {
    const parsed = new URL(sanitized);
    if (!parsed.searchParams.has("autoconnect")) {
      parsed.searchParams.set("autoconnect", "1");
    }
    if (!parsed.searchParams.has("resize")) {
      parsed.searchParams.set("resize", "scale");
    }
    return parsed.toString();
  } catch {
    return sanitized;
  }
}




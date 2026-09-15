import type { ReactNode } from "react";
import type { AccountStatus, DeviceStatus } from "@/lib/types";

/**
 * Status is the most-read signal in this app, so every state gets an explicit
 * colour and an always-on dot. Labels are sentence case, matching the spec's
 * "ONLINE / Running" vocabulary.
 */

type Tone = "online" | "offline" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  online: "border-online/40 bg-online/12 text-online",
  offline: "border-offline/40 bg-offline/12 text-offline",
  warning: "border-warning/40 bg-warning/12 text-warning",
  danger: "border-danger/40 bg-danger/12 text-danger",
  neutral: "border-border bg-elevated text-muted",
};

const DEVICE_TONES: Record<DeviceStatus, Tone> = {
  online: "online",
  offline: "offline",
  error: "danger",
};

const ACCOUNT_TONES: Record<AccountStatus, Tone> = {
  running: "online",
  starting: "warning",
  restarting: "warning",
  stopped: "offline",
  error: "danger",
  offline: "neutral",
};

/** In-flight states get the pulsing dot so "working" reads differently. */
const ACCOUNT_BUSY: ReadonlySet<AccountStatus> = new Set([
  "starting",
  "restarting",
]);

function Badge({
  tone,
  label,
  busy = false,
  className = "",
}: {
  tone: Tone;
  label: string;
  busy?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${TONES[tone]} ${className}`}
    >
      <span
        className={`size-1.5 rounded-full bg-current ${busy ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function DeviceStatusBadge({
  status,
  className,
}: {
  status: DeviceStatus;
  className?: string;
}) {
  return (
    <Badge
      tone={DEVICE_TONES[status]}
      label={status}
      busy={status === "online"}
      className={className}
    />
  );
}

export function AccountStatusBadge({
  status,
  className,
}: {
  status: AccountStatus;
  className?: string;
}) {
  return (
    <Badge
      tone={ACCOUNT_TONES[status]}
      label={status}
      busy={ACCOUNT_BUSY.has(status)}
      className={className}
    />
  );
}

/** Thin utilisation bar for CPU / RAM. Colour shifts at 70% and 90%. */
export function MetricBar({ percent }: { percent: number }) {
  const value = Math.min(100, Math.max(0, percent));
  const bar =
    value >= 90 ? "bg-danger" : value >= 70 ? "bg-warning" : "bg-online";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-elevated"
      role="img"
      aria-label={`${Math.round(value)} percent used`}
    >
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

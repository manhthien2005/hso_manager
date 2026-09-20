import type { ReactNode } from "react";
import type { AccountStatus, DeviceStatus, HealthStatus } from "@/lib/types";

/**
 * Operational Status Primitives — Storm Steel.
 * Rules:
 *   - Indicator glyph + Textual label + Semantic color.
 *   - Healthy stable states (online, running) are completely STATIC.
 *   - Transitions (starting, restarting) pulse intentionally.
 *   - Offline/idle states render as a quiet hollow indicator.
 *   - Error/danger states render as a prominent diamond indicator.
 */

type Tone = "online" | "offline" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  online: "border-online/35 bg-online/10 text-online",
  offline: "border-offline/35 bg-offline/10 text-offline",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/35 bg-danger/10 text-danger",
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

const HEALTH_TONES: Record<HealthStatus, Tone> = {
  running: "online",
  degraded: "warning",
  stopped: "offline",
};

/** In-flight transition states get the pulsing dot so "working" reads differently. */
const ACCOUNT_BUSY: ReadonlySet<AccountStatus> = new Set([
  "starting",
  "restarting",
]);

function StatusGlyph({
  tone,
  busy = false,
}: {
  tone: Tone;
  busy?: boolean;
}) {
  if (busy) {
    return (
      <span
        className="size-1.5 rounded-full bg-current animate-pulse motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  }

  if (tone === "danger") {
    // Error / failure glyph: diamond indicator
    return (
      <span
        className="size-1.5 shrink-0 rotate-45 rounded-[1px] bg-current"
        aria-hidden="true"
      />
    );
  }

  if (tone === "offline" || tone === "neutral") {
    // Offline / stopped glyph: hollow ring
    return (
      <span
        className="size-1.5 shrink-0 rounded-full border border-current bg-transparent"
        aria-hidden="true"
      />
    );
  }

  // Stable healthy (online/running) or warning: solid clean circle
  return (
    <span
      className="size-1.5 shrink-0 rounded-full bg-current"
      aria-hidden="true"
    />
  );
}

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
      <StatusGlyph tone={tone} busy={busy} />
      {label}
    </span>
  );
}

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  online: "Trực tuyến",
  offline: "Mất kết nối",
  error: "Lỗi",
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  running: "Đang chạy",
  starting: "Đang khởi động",
  restarting: "Đang khởi động lại",
  stopped: "Đã dừng",
  error: "Lỗi",
  offline: "Mất kết nối",
};

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  running: "Ổn định",
  degraded: "Bất thường",
  stopped: "Đã dừng",
};

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
      label={DEVICE_STATUS_LABELS[status]}
      busy={false}
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
      label={ACCOUNT_STATUS_LABELS[status]}
      busy={ACCOUNT_BUSY.has(status)}
      className={className}
    />
  );
}

export function HealthStatusBadge({
  health,
  className,
}: {
  health: HealthStatus;
  className?: string;
}) {
  return (
    <Badge
      tone={HEALTH_TONES[health]}
      label={HEALTH_STATUS_LABELS[health]}
      busy={false}
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
      aria-label={`${Math.round(value)}% đang sử dụng`}
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

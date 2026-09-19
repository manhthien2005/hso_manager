/**
 * Telemetry panel (Task 14, C4) — renders the 48-key snapshot from zeus-player.txt.
 *
 * Design decisions enforced by WIRE-CONTRACT §5 / WEB-SPEC §5:
 *
 *   - healthOf() three-state: green=running, yellow=degraded, gray=stopped.
 *     "process alive" ≠ running; ctl must be valid (ctl===1).
 *     Attack automation state is not a health signal.
 *   - xp is permille (0..1000); rendered as `bA/10 + "," + bA%10 + "%"`.
 *   - gold/gem are null until opcode 16; rendered as "—" not "0".
 *   - quota ≤ 0 triggers "0 (limit reached)" — explains why auto stopped.
 *   - ctl ≠ 1 is always visible (red badge) regardless of process state.
 *   - stuck ≠ 0 shows a warning callout.
 *   - config_status='version_mismatch' shows a red banner at the top.
 *
 * The panel degrades gracefully: if snapshot is null it shows "waiting…" in
 * the degraded colour instead of crashing.
 */

import type { Account } from "@/lib/types";
import {
  formatXp,
  formatGold,
  formatAtkstate,
  formatStuck,
  formatQuota,
  formatTelemetryMap,
  formatTravelGoal,
  healthOf,
} from "@/lib/format";

// ── Health colour tokens ──────────────────────────────────────────────────────

const HEALTH_RING: Record<string, string> = {
  running: "ring-1 ring-success/50",
  degraded: "ring-1 ring-warning/50",
  stopped: "ring-1 ring-border",
};

const HEALTH_DOT: Record<string, string> = {
  running: "bg-success",
  degraded: "bg-warning",
  stopped: "bg-muted",
};

const HEALTH_LABEL: Record<string, string> = {
  running: "Running",
  degraded: "Degraded",
  stopped: "Stopped",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthBadge({ health }: { health: string }) {
  return (
    <span
      id="telemetry-health-badge"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${HEALTH_RING[health]}`}
    >
      <span className={`size-1.5 rounded-full ${HEALTH_DOT[health]}`} aria-hidden="true" />
      {HEALTH_LABEL[health]}
    </span>
  );
}

function CtlBadge({ ctl }: { ctl: number }) {
  const ok = ctl === 1;
  return (
    <span
      id="telemetry-ctl-badge"
      title={ctl === -1 ? "No -Dzeus.ctl.in property" : ctl === 0 ? "Control file refused" : "Control accepted"}
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}
    >
      ctl={ctl}
    </span>
  );
}

function AtkstateBadge({ atkstate }: { atkstate: number }) {
  const label = formatAtkstate(atkstate);
  const none = atkstate < 0;
  return (
    <span
      id="telemetry-atkstate-badge"
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${none ? "bg-muted/20 text-muted" : "bg-accent/15 text-accent"}`}
    >
      {label}
    </span>
  );
}

function StuckBadge({ stuck }: { stuck: number }) {
  const warning = formatStuck(stuck);
  if (!warning) return null;
  return (
    <span
      id="telemetry-stuck-badge"
      className="rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] text-warning"
    >
      ⚠ {warning}
    </span>
  );
}

function Row({ label, value, id }: { label: string; value: string; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="shrink-0 text-[11px] tracking-wide text-muted uppercase">{label}</dt>
      <dd id={id} className="truncate font-mono text-xs tabular">{value}</dd>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TelemetryPanel({ account }: { account: Account }) {
  const health = healthOf(account);
  const snap = account.snapshot;
  const versionMismatch = account.config_status === "version_mismatch";

  return (
    <div id={`telemetry-${account.id}`} className="space-y-3">
      {/* version_mismatch banner — C4.6 */}
      {versionMismatch ? (
        <div
          id="telemetry-version-mismatch-banner"
          className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2"
        >
          <p className="text-[11px] font-medium text-danger">
            ⚠️ Version mismatch — last config was NOT written to disk
          </p>
        </div>
      ) : null}

      {/* Health row with badges */}
      <div className="flex flex-wrap items-center gap-2">
        <HealthBadge health={health} />
        {snap ? (
          <>
            <CtlBadge ctl={snap.ctl} />
            <AtkstateBadge atkstate={snap.atkstate} />
            <StuckBadge stuck={snap.stuck} />
          </>
        ) : null}
      </div>

      {/* Snapshot grid */}
      {snap ? (
        <dl>
          <Row id="telemetry-lv" label="Level" value={String(snap.lv)} />
          <Row id="telemetry-xp" label="XP" value={formatXp(snap.xp)} />
          <Row
            id="telemetry-hp"
            label="HP"
            value={`${snap.hp} / ${snap.hpmax}`}
          />
          <Row
            id="telemetry-mp"
            label="MP"
            value={`${snap.mp} / ${snap.mpmax}`}
          />
          <Row id="telemetry-map" label="Map" value={formatTelemetryMap(snap.map)} />
          <Row id="telemetry-zone" label="Zone" value={String(snap.zone)} />
          {/* gold/gem: dash until opcode 16 delivers the wallet — C4.2 */}
          <Row id="telemetry-gold" label="Gold" value={formatGold(snap.gold)} />
          <Row id="telemetry-gem" label="Gem" value={formatGold(snap.gem)} />
          <Row
            id="telemetry-bag"
            label="Bag"
            value={`${snap.bag} / ${snap.bagmax}`}
          />
          {/* quota ≤ 0 = auto stopped — C4.3 */}
          <Row id="telemetry-quota" label="Quota" value={formatQuota(snap)} />
          {/* pkrank/pkmphp/pkgold — read back from client alongside requested — C4.7 */}
          <Row id="telemetry-pkrank" label="Pick Rank" value={String(snap.pkrank)} />

          {/* Travel state — only when travel module active */}
          {snap.travel !== 0 ? (
            <Row id="telemetry-travelstate" label="Travel" value={String(snap.travelstate)} />
          ) : null}
          <Row id="telemetry-travelgoal" label="Travel Goal" value={formatTravelGoal(snap.travelgoal)} />

          {/* Dungeon state — only when dungeon module active */}
          {snap.dungeonstate !== 0 ? (
            <Row
              id="telemetry-dungeonruns"
              label="Dungeon runs"
              value={String(snap.dungeonruns)}
            />
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-muted">
          {health === "stopped" ? "No snapshot (process stopped)" : "Waiting for snapshot…"}
        </p>
      )}
    </div>
  );
}

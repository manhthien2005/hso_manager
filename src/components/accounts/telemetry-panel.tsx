/**
 * Telemetry panel — renders structured diagnostic telemetry from PlayerSnapshot.
 *
 * Design decisions enforced by WIRE-CONTRACT §5 / WEB-SPEC §5 / Storm Steel:
 *   - healthOf() three-state: running, degraded, stopped.
 *   - Semantic grouping: Character & Vitals, Combat & Stance, Position & Navigation,
 *     Economy & Inventory, Automation Modules, Runtime & Control.
 *   - Preserves all contract IDs (telemetry-health-badge, telemetry-ctl-badge, etc.)
 *   - When process appears alive but snapshot is null, show subdued "Waiting for telemetry".
 *   - Version mismatch shows prominent warning banner.
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
import { HealthStatusBadge } from "@/components/ui/status";

// ── Badges ────────────────────────────────────────────────────────────────────

function CtlBadge({ ctl }: { ctl: number }) {
  const ok = ctl === 1;
  return (
    <span
      id="telemetry-ctl-badge"
      title={
        ctl === -1
          ? "No -Dzeus.ctl.in property"
          : ctl === 0
          ? "Control file refused"
          : "Control accepted"
      }
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${
        ok
          ? "border-success/35 bg-success/10 text-success"
          : "border-danger/35 bg-danger/10 text-danger"
      }`}
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
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase ${
        none
          ? "border-border bg-elevated text-muted"
          : "border-accent/35 bg-accent/10 text-accent"
      }`}
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
      className="rounded border border-warning/35 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-warning"
    >
      ⚠ {warning}
    </span>
  );
}

function FactItem({
  label,
  value,
  id,
  subtext,
}: {
  label: string;
  value: string;
  id?: string;
  subtext?: string;
}) {
  return (
    <div className="flex flex-col justify-center rounded border border-border/60 bg-elevated/40 px-2.5 py-1.5">
      <dt className="text-[10px] font-semibold tracking-wider text-muted uppercase">
        {label}
      </dt>
      <dd id={id} className="mt-0.5 truncate font-mono text-xs font-medium tabular text-foreground">
        {value}
        {subtext ? <span className="ml-1 text-[11px] font-normal text-muted">{subtext}</span> : null}
      </dd>
    </div>
  );
}

function DiagnosticSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold tracking-wider text-muted uppercase">
        {title}
      </h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TelemetryPanel({ account }: { account: Account }) {
  const health = healthOf(account);
  const snap = account.snapshot;
  const versionMismatch = account.config_status === "version_mismatch";

  return (
    <div id={`telemetry-${account.id}`} className="space-y-4 pt-1">
      {/* version_mismatch banner — C4.6 */}
      {versionMismatch ? (
        <div
          id="telemetry-version-mismatch-banner"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-danger font-bold text-xs">⚠️</span>
            <p className="text-xs font-semibold text-danger">
              Version Mismatch — pending configuration was NOT written to disk by agent
            </p>
          </div>
        </div>
      ) : null}

      {/* Health & Diagnostic Badges Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-elevated/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span id="telemetry-health-badge">
            <HealthStatusBadge health={health} />
          </span>
          {snap ? (
            <>
              <CtlBadge ctl={snap.ctl} />
              <AtkstateBadge atkstate={snap.atkstate} />
              <StuckBadge stuck={snap.stuck} />
            </>
          ) : null}
        </div>
        {snap ? (
          <span className="font-mono text-[11px] text-muted tabular">
            Snapshot v{snap.v} • t={snap.t}
          </span>
        ) : null}
      </div>

      {/* Snapshot Groups */}
      {snap ? (
        <div className="space-y-4">
          {/* Character & Vitals */}
          <DiagnosticSection title="Character & Vitals">
            <FactItem id="telemetry-lv" label="Level" value={String(snap.lv)} />
            <FactItem id="telemetry-xp" label="XP" value={formatXp(snap.xp)} />
            <FactItem
              id="telemetry-hp"
              label="HP"
              value={`${snap.hp} / ${snap.hpmax}`}
              subtext={
                snap.hpmax > 0
                  ? `(${Math.round((snap.hp / snap.hpmax) * 100)}%)`
                  : undefined
              }
            />
            <FactItem
              id="telemetry-mp"
              label="MP"
              value={`${snap.mp} / ${snap.mpmax}`}
              subtext={
                snap.mpmax > 0
                  ? `(${Math.round((snap.mp / snap.mpmax) * 100)}%)`
                  : undefined
              }
            />
            <FactItem
              label="Guild"
              value={snap.guild && snap.guild.length > 0 ? snap.guild : "—"}
            />
          </DiagnosticSection>

          {/* Combat & Automation */}
          <DiagnosticSection title="Combat & Automation">
            <FactItem label="Attack Phase" value={String(snap.atkphase)} />
            <FactItem
              label="Attack State"
              value={formatAtkstate(snap.atkstate)}
            />
            <FactItem
              label="Target ID"
              value={snap.target === 0 ? "None" : String(snap.target)}
            />
            <FactItem
              label="Stuck State"
              value={formatStuck(snap.stuck) ?? "Clear (0)"}
            />
            <FactItem
              label="Potions / Revives"
              value={`${snap.potions} / ${snap.revives}`}
            />
            <FactItem
              label="XP Rate"
              value={snap.xprate > 0 ? `${snap.xprate}/h` : "—"}
            />
          </DiagnosticSection>

          {/* Position & Travel */}
          <DiagnosticSection title="Position & Travel">
            <FactItem
              id="telemetry-map"
              label="Map"
              value={formatTelemetryMap(snap.map)}
              subtext={`(#${snap.map})`}
            />
            <FactItem
              id="telemetry-zone"
              label="Zone"
              value={String(snap.zone)}
            />
            <FactItem
              label="Coordinates"
              value={`X: ${snap.px}, Y: ${snap.py}`}
            />
            {snap.travel !== 0 ? (
              <FactItem
                id="telemetry-travelstate"
                label="Travel State"
                value={String(snap.travelstate)}
              />
            ) : null}
            <FactItem
              id="telemetry-travelgoal"
              label="Travel Goal"
              value={formatTravelGoal(snap.travelgoal)}
            />
            {snap.travelhops > 0 ? (
              <FactItem
                label="Travel Hops"
                value={String(snap.travelhops)}
              />
            ) : null}
            {snap.travelwhy && snap.travelwhy.trim() !== "" ? (
              <FactItem label="Travel Reason" value={snap.travelwhy} />
            ) : null}
          </DiagnosticSection>

          {/* Economy & Inventory */}
          <DiagnosticSection title="Economy & Inventory">
            <FactItem
              id="telemetry-gold"
              label="Gold"
              value={formatGold(snap.gold)}
            />
            <FactItem
              id="telemetry-gem"
              label="Gem"
              value={formatGold(snap.gem)}
            />
            <FactItem
              label="Wallet Opcode"
              value={snap.wallet !== null ? formatGold(snap.wallet) : "—"}
            />
            <FactItem
              id="telemetry-bag"
              label="Bag Slots"
              value={`${snap.bag} / ${snap.bagmax}`}
            />
            <FactItem
              id="telemetry-quota"
              label="Quota"
              value={formatQuota(snap)}
            />
            <FactItem
              id="telemetry-pkrank"
              label="Pick Rank"
              value={String(snap.pkrank)}
            />
            <FactItem
              label="Auto-Pick Flags"
              value={`Gold: ${snap.pkgold ? "ON" : "OFF"}, MP/HP: ${snap.pkmphp ? "ON" : "OFF"}`}
            />
          </DiagnosticSection>

          {/* Modules & Flags */}
          <DiagnosticSection title="Modules & Extended State">
            <FactItem
              label="Mount"
              value={
                snap.mount !== 0
                  ? snap.mounts && snap.mounts.length > 0
                    ? snap.mounts
                    : "Active"
                  : "None"
              }
            />
            <FactItem
              label="Buffs"
              value={snap.buffs && snap.buffs.length > 0 ? snap.buffs : "None"}
            />
            <FactItem
              label="Drops"
              value={snap.drops && snap.drops.length > 0 ? snap.drops : "None"}
            />
            {snap.dungeonstate !== 0 || snap.dungeonruns > 0 ? (
              <FactItem
                id="telemetry-dungeonruns"
                label="Dungeon Runs"
                value={String(snap.dungeonruns)}
                subtext={`(State ${snap.dungeonstate})`}
              />
            ) : null}
            {snap.enhancephase > 0 || snap.enhancedone > 0 ? (
              <FactItem
                label="Enhance Module"
                value={`Phase ${snap.enhancephase} (${snap.enhancedone} done)`}
              />
            ) : null}
            <FactItem
              label="Stale / State"
              value={`Stale: ${snap.stale}, State: ${snap.state}`}
            />
          </DiagnosticSection>
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-elevated/30 p-4 text-center">
          <p className="text-xs text-muted">
            {health === "stopped" ? (
              "No snapshot (process stopped)"
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-warning/70" />
                Waiting for telemetry snapshot…
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

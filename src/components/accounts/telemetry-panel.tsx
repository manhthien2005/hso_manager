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

// ── Icon helpers ──────────────────────────────────────────────────────────────

function IconWarning({ className = "size-3 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M8 2L14.5 13.5H1.5L8 2z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3M8 11v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function CtlBadge({ ctl }: { ctl: number }) {
  const ok = ctl === 1;
  return (
    <span
      id="telemetry-ctl-badge"
      title={
        ctl === -1
          ? "Không có thuộc tính -Dzeus.ctl.in"
          : ctl === 0
          ? "Tệp điều khiển bị từ chối"
          : "Tệp điều khiển được chấp nhận"
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
      className="inline-flex items-center gap-1 rounded border border-warning/35 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-warning"
    >
      <IconWarning />
      {warning}
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
      <h4 className="border-l-2 border-border/60 pl-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
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
            <IconWarning className="size-3.5 shrink-0 text-danger" />
            <p className="text-xs font-semibold text-danger">
              Phiên bản cấu hình không tương thích — cấu hình mới chưa được Agent áp dụng
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
          <DiagnosticSection title="Nhân vật & Sinh mệnh">
            <FactItem id="telemetry-lv" label="Cấp độ" value={String(snap.lv)} />
            <FactItem id="telemetry-xp" label="Kinh nghiệm (XP)" value={formatXp(snap.xp)} />
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
              label="Bang hội"
              value={snap.guild && snap.guild.length > 0 ? snap.guild : "—"}
            />
          </DiagnosticSection>

          {/* Combat & Automation */}
          <DiagnosticSection title="Chiến đấu & Tự động">
            <FactItem label="Giai đoạn đánh" value={String(snap.atkphase)} />
            <FactItem
              label="Trạng thái đánh"
              value={formatAtkstate(snap.atkstate)}
            />
            <FactItem
              label="Mục tiêu"
              value={snap.target === 0 ? "Không có" : String(snap.target)}
            />
            <FactItem
              label="Kẹt địa hình"
              value={formatStuck(snap.stuck) ?? "Bình thường (0)"}
            />
            <FactItem
              label="Bình máu / Hồi sinh"
              value={`${snap.potions} / ${snap.revives}`}
            />
            <FactItem
              label="Tốc độ XP"
              value={snap.xprate > 0 ? `${snap.xprate}/h` : "—"}
            />
          </DiagnosticSection>

          {/* Position & Travel */}
          <DiagnosticSection title="Vị trí & Di chuyển">
            <FactItem
              id="telemetry-map"
              label="Map"
              value={formatTelemetryMap(snap.map)}
              subtext={`(#${snap.map})`}
            />
            <FactItem
              id="telemetry-zone"
              label="Khu vực"
              value={String(snap.zone)}
            />
            <FactItem
              label="Tọa độ"
              value={`X: ${snap.px}, Y: ${snap.py}`}
            />
            {snap.travel !== 0 ? (
              <FactItem
                id="telemetry-travelstate"
                label="Trạng thái di chuyển"
                value={String(snap.travelstate)}
              />
            ) : null}
            <FactItem
              id="telemetry-travelgoal"
              label="Mục tiêu di chuyển"
              value={formatTravelGoal(snap.travelgoal)}
            />
            {snap.travelhops > 0 ? (
              <FactItem
                label="Chặng di chuyển"
                value={String(snap.travelhops)}
              />
            ) : null}
            {snap.travelwhy && snap.travelwhy.trim() !== "" ? (
              <FactItem label="Lý do di chuyển" value={snap.travelwhy} />
            ) : null}
          </DiagnosticSection>

          {/* Economy & Inventory */}
          <DiagnosticSection title="Tài nguyên & Túi đồ">
            <FactItem
              id="telemetry-gold"
              label="Vàng"
              value={formatGold(snap.gold)}
            />
            <FactItem
              id="telemetry-gem"
              label="Ngọc"
              value={formatGold(snap.gem)}
            />
            <FactItem
              label="Ví tiền"
              value={snap.wallet !== null ? formatGold(snap.wallet) : "—"}
            />
            <FactItem
              id="telemetry-bag"
              label="Ô túi đồ"
              value={`${snap.bag} / ${snap.bagmax}`}
            />
            <FactItem
              id="telemetry-quota"
              label="Hạn ngạch"
              value={formatQuota(snap)}
            />
            <FactItem
              id="telemetry-pkrank"
              label="Cấp nhặt đồ"
              value={String(snap.pkrank)}
            />
            <FactItem
              label="Tự nhặt đồ"
              value={`Vàng: ${snap.pkgold ? "BẬT" : "TẮT"}, HP/MP: ${snap.pkmphp ? "BẬT" : "TẮT"}`}
            />
          </DiagnosticSection>

          {/* Modules & Flags */}
          <DiagnosticSection title="Trạng thái mở rộng">
            <FactItem
              label="Thú cưỡi"
              value={
                snap.mount !== 0
                  ? snap.mounts && snap.mounts.length > 0
                    ? snap.mounts
                    : "Hoạt động"
                  : "Không có"
              }
            />
            <FactItem
              label="Hiệu ứng (Buff)"
              value={snap.buffs && snap.buffs.length > 0 ? snap.buffs : "Không có"}
            />
            <FactItem
              label="Vật phẩm rơi"
              value={snap.drops && snap.drops.length > 0 ? snap.drops : "Không có"}
            />
            {snap.dungeonstate !== 0 || snap.dungeonruns > 0 ? (
              <FactItem
                id="telemetry-dungeonruns"
                label="Lượt phó bản"
                value={String(snap.dungeonruns)}
                subtext={`(Trạng thái ${snap.dungeonstate})`}
              />
            ) : null}
            {snap.enhancephase > 0 || snap.enhancedone > 0 ? (
              <FactItem
                label="Cường hóa"
                value={`Giai đoạn ${snap.enhancephase} (xong ${snap.enhancedone})`}
              />
            ) : null}
            <FactItem
              label="Trạng thái dữ liệu"
              value={`Chờ: ${snap.stale}, Trạng thái: ${snap.state}`}
            />
          </DiagnosticSection>
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-elevated/30 p-4 text-center">
          <p className="text-xs text-muted">
            {health === "stopped" ? (
              "Không có dữ liệu (tiến trình đã dừng)"
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-warning/70" />
                Đang chờ dữ liệu trạng thái…
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

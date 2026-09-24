"use client";

import { use, useEffect, useRef, useState } from "react";
import { ConfigFieldInput } from "@/components/accounts/config-field";
import { AutoFarmPanel } from "@/components/accounts/auto-farm-panel";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountStatusBadge } from "@/components/ui/status";
import {
  CONTROL_SCHEMA,
  controlRecordToDraft,
  draftToControlRecord,
  defaultControlDraft,
  normalizeDraftForSave,
  validateDraft,
  determineControlVersionForSave,
  type ConfigDraft,
  type ConfigErrors,
  type ConfigPath,
  type ConfigValue,
} from "@/lib/config-schema";
import { isAttackMapSelectionDirty } from "@/lib/attack-spot";
import { isVisualQoLAvailableOnDevice } from "@/lib/capabilities";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import type { Account, Device } from "@/lib/types";

/**
 * Account Configuration — Storm Steel Editor (Phase 10 Refinement).
 *
 * Operational hierarchy & invariants:
 *   - Version-gated against `device.jar_ctl_version`.
 *   - Gated banner if jar version not reported or unsupported.
 *   - Version mismatch banner if last config write was refused by agent.
 *   - Offline device warning blocks saving while allowing draft inspection/edits.
 *   - Tab-based section navigation (CSS hidden/block — state fully preserved across tab switches).
 *   - Preserves Map 0, "__none__" sentinel, and attackMapIntent state.
 *   - Honest lifecycle copy: "Saved to control plane" (no fake agent ack).
 */
export default function AccountConfigPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);
  const { getAccount, getDevice } = useZeusStore();

  const account = getAccount(accountId);
  if (account === undefined) {
    return (
      <NotFoundPanel
        title="Không tìm thấy tài khoản"
        hint="Không tìm thấy tài khoản với ID này trong hệ thống."
        identifier={accountId}
      />
    );
  }

  return (
    <ConfigForm
      key={account.id}
      account={account}
      device={getDevice(account.deviceId)}
    />
  );
}

// ── Section icon & metadata map ──────────────────────────────────────────────

const SECTION_METADATA: Record<string, { title: string; description: string }> = {
  auto_farm: {
    title: "Tự động đánh",
    description: "Cấu hình chế độ đánh, vị trí, khu vực và nhặt vật phẩm.",
  },
  combat: {
    title: "Chiến đấu",
    description: "Thiết lập bình hồi phục HP/MP và kỹ năng hỗ trợ (Buff).",
  },
  travel: {
    title: "Di chuyển",
    description: "Mục tiêu di chuyển thủ công.",
  },
  recovery: {
    title: "Hồi phục",
    description: "Thiết lập tự hồi sinh và xử lý kẹt địa hình.",
  },
  mount: {
    title: "Thú cưỡi",
    description: "Sử dụng thú cưỡi trong khu vực chiến đấu.",
  },
  enhance: {
    title: "Cường hóa",
    description: "Tự động cường hóa trang bị (sử dụng bùa và vàng).",
  },
  dungeon: {
    title: "Phó bản",
    description: "Tự động tham gia phó bản.",
  },
  visual_qol: {
    title: "Giao diện & Hiệu ứng",
    description: "Tùy chọn hiển thị và hiệu ứng hình ảnh giúp giảm tải cho game.",
  },
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  auto_farm: <IconCrosshair />,
  combat: <IconSword />,
  travel: <IconCompass />,
  recovery: <IconHeart />,
  mount: <IconMount />,
  enhance: <IconSparkle />,
  dungeon: <IconDoor />,
  visual_qol: <IconEye />,
};

// ── Config Form ───────────────────────────────────────────────────────────────

function ConfigForm({
  account,
  device,
}: {
  account: Account;
  device: Device | undefined;
}) {
  const { saveConfig, isPending } = useZeusStore();
  const { push } = useToast();

  const jarCtlVersion = device?.jar_ctl_version ?? null;
  const isQoLCapable = isVisualQoLAvailableOnDevice(device);
  const accountControlVersion = account.control_version === 14 ? 14 : 13;
  const isExistingV14 = accountControlVersion === 14;

  const [qolEdited, setQolEdited] = useState(false);

  const targetControlVersion = determineControlVersionForSave({
    accountControlVersion,
    isDeviceQoLCapable: isQoLCapable,
    qolSettingsEdited: qolEdited,
  });

  const sections = CONTROL_SCHEMA[14];
  const visibleSections = sections.filter((s) => !s.hidden);
  const versionGated = jarCtlVersion === null || !CONTROL_SCHEMA[jarCtlVersion];

  const [draft, setDraft] = useState<ConfigDraft>(() =>
    account.control
      ? controlRecordToDraft(account.control, accountControlVersion)
      : defaultControlDraft(accountControlVersion),
  );
  const draftRef = useRef<ConfigDraft>(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Transient UI intent for attack map selection (Round 9B3 Corrective 1).
  // Distinguishes selecting Real Map 0 in the UI from canonical None while coordinates remain unset.
  const [attackMapIntent, setAttackMapIntent] = useState<string | null>(null);
  const attackMapIntentRef = useRef<string | null>(attackMapIntent);
  useEffect(() => {
    attackMapIntentRef.current = attackMapIntent;
  }, [attackMapIntent]);

  // Reset transient intent if account.control changes externally (e.g. reload or switch)
  const prevControlRef = useRef(account.control);
  useEffect(() => {
    if (prevControlRef.current !== account.control) {
      prevControlRef.current = account.control;
      setAttackMapIntent(null);
      attackMapIntentRef.current = null;
    }
  }, [account.control]);

  const [errors, setErrors] = useState<ConfigErrors>({});
  const [touched, setTouched] = useState(false);
  const saving = isPending(pendingKey.config(account.id));
  const persistedDraft = account.control
    ? controlRecordToDraft(account.control, accountControlVersion)
    : defaultControlDraft(accountControlVersion);

  const rawFieldsDirty =
    JSON.stringify(controlRecordToDraft(draftToControlRecord(draft, targetControlVersion), targetControlVersion)) !==
    JSON.stringify(persistedDraft);
  const qolFieldsDirty =
    isQoLCapable &&
    (draft["ui.effects"] !== persistedDraft["ui.effects"] ||
      draft["ui.hidePlayers"] !== persistedDraft["ui.hidePlayers"]);
  const attackMapDirty = isAttackMapSelectionDirty(
    persistedDraft,
    draft,
    attackMapIntent,
  );
  const dirty = rawFieldsDirty || qolFieldsDirty || attackMapDirty;
  const offline = device?.status !== "online";
  const errorCount = Object.keys(errors).length;

  // version_mismatch banner: the agent refused to write the last config
  const versionMismatch = account.config_status === "version_mismatch";

  const [resetKey, setResetKey] = useState(0);

  // Tab-based section navigation — CSS hidden/block keeps all sections mounted
  // so draft state, validation, and attackMapIntent survive tab switches.
  const [activeSection, setActiveSection] = useState<string>(
    visibleSections?.[0]?.id ?? "auto_farm",
  );

  function handleChange(path: ConfigPath, value: ConfigValue) {
    if (path === "ui.effects" || path === "ui.hidePlayers") {
      setQolEdited(true);
    }
    const next = { ...draftRef.current, [path]: value };
    draftRef.current = next;
    setDraft(next);
    if (touched) setErrors(validateDraft(next, targetControlVersion, attackMapIntentRef.current));
  }

  function handleBatchChange(updates: Partial<Record<ConfigPath, ConfigValue>>) {
    if ("ui.effects" in updates || "ui.hidePlayers" in updates) {
      setQolEdited(true);
    }
    const next = { ...draftRef.current, ...updates };
    draftRef.current = next;
    setDraft(next);
    if (touched) setErrors(validateDraft(next, targetControlVersion, attackMapIntentRef.current));
  }

  function handleAttackMapIntentChange(nextIntent: string | null) {
    attackMapIntentRef.current = nextIntent;
    setAttackMapIntent(nextIntent);
    if (touched) {
      setErrors(validateDraft(draftRef.current, targetControlVersion, nextIntent));
    }
  }

  async function handleSave() {
    if (jarCtlVersion === null || !CONTROL_SCHEMA[jarCtlVersion]) return;
    const currentDraft = draftRef.current;
    const nextErrors = validateDraft(currentDraft, targetControlVersion, attackMapIntentRef.current);
    setErrors(nextErrors);
    setTouched(true);
    if (Object.keys(nextErrors).length > 0) {
      push("error", "Chưa thể lưu cấu hình", "Vui lòng sửa các trường lỗi và thử lại");
      return;
    }
    try {
      const normalizedDraft = normalizeDraftForSave(currentDraft);
      const control = draftToControlRecord(normalizedDraft, targetControlVersion);
      await saveConfig(account.id, {
        control,
        controlVersion: targetControlVersion,
      });
      draftRef.current = normalizedDraft;
      setDraft(normalizedDraft);
      setTouched(false);
      setQolEdited(false);
      attackMapIntentRef.current = null;
      setAttackMapIntent(null);
      push(
        "success",
        "Đã lưu cấu hình",
        `Đã lưu cấu hình Control v${targetControlVersion} vào hệ thống điều khiển cho ${device?.name ?? "máy chủ"}`,
      );
    } catch (error) {
      push("error", "Lưu cấu hình thất bại", describeError(error));
    }
  }

  function handleReset() {
    const next = account.control
      ? controlRecordToDraft(account.control, accountControlVersion)
      : defaultControlDraft(accountControlVersion);
    draftRef.current = next;
    setDraft(next);
    setErrors({});
    setTouched(false);
    setQolEdited(false);
    attackMapIntentRef.current = null;
    setAttackMapIntent(null);
    setResetKey((k) => k + 1);
  }

  return (
    <div className="relative pb-24">
      <PageHeader
        icon={<IconSliders />}
        back={{
          href: device ? `/device/${device.deviceId}/accounts` : "/",
          label: device ? `Tài khoản trên ${device.name}` : "Tổng quan",
        }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Cấu hình {account.label}</span>
            <AccountStatusBadge status={account.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs text-muted">
            {device?.name ? `Máy chủ: ${device.name}` : "Hệ thống"} · Control v{jarCtlVersion ?? "?"}
          </span>
        }
      />

      {/* version_mismatch: agent refused last config — critical incident banner */}
      {versionMismatch ? (
        <div
          id="config-version-mismatch-banner"
          className="mb-5 rounded-md border border-danger/40 bg-danger/10 p-4 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <IconWarning className="size-4 shrink-0 mt-0.5 text-danger" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-danger">
                Phiên bản cấu hình không tương thích — Agent từ chối áp dụng
              </h3>
              <p className="text-xs text-foreground/90 leading-relaxed">
                Agent từ chối ghi tệp cấu hình xuống đĩa do phiên bản cấu hình không khớp với phiên bản jar giả lập đang chạy.
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Tài khoản vẫn tiếp tục hoạt động an toàn với cấu hình hợp lệ trước đó.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* version gate: jar version not recognised */}
      {versionGated ? (
        <div
          id="config-version-gate-banner"
          className="mb-5 rounded-md border border-warning/40 bg-warning/10 p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <IconWarning className="size-4 shrink-0 mt-0.5 text-warning" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-warning">
                {jarCtlVersion === null
                  ? "Chưa nhận diện phiên bản Jar"
                  : `Phiên bản Jar CTL ${jarCtlVersion} chưa được hỗ trợ`}
              </h3>
              <p className="text-xs text-foreground/90 leading-relaxed">
                {jarCtlVersion === null
                  ? "Agent chưa gửi thông tin phiên bản jar đang chạy. Vui lòng kết nối máy chủ và chờ nhịp kết nối đầu tiên."
                  : `Cần cập nhật trang quản trị hỗ trợ CTL v${jarCtlVersion}, hoặc sử dụng phiên bản jar tương thích trên máy chủ.`}
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Tài khoản vẫn đang hoạt động với cấu hình hợp lệ gần nhất.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {offline ? (
            <div className="mb-4 rounded-md border border-warning/35 bg-warning/10 px-4 py-3 text-xs text-warning flex items-center gap-2">
              <IconWarning className="size-3.5 shrink-0" />
              <span>
                {device?.name ?? "Máy chủ này"} đang mất kết nối. Bạn vẫn có thể xem và chỉnh sửa bản nháp cấu hình, nhưng không thể lưu vào hệ thống cho đến khi máy chủ kết nối lại.
              </span>
            </div>
          ) : null}

          {/* Section Tab Navigation Bar */}
          <div className="sticky top-16 z-20 -mx-4 mb-4 border-y border-border/80 bg-background/95 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div
              role="tablist"
              aria-label="Các mục cấu hình"
              className="flex items-center gap-0.5 overflow-x-auto"
              style={{ scrollbarWidth: "none" }}
            >
              {visibleSections!.map((sec) => {
                const secErrors = sec.fields.filter((f) => errors[f.path] !== undefined).length;
                const isSecDirty = sec.fields.some((f) => {
                  if (f.path === "atk.map" || f.path === "atk.x" || f.path === "atk.y" || f.path === "atk.zone") {
                    return (
                      draft[f.path] !== persistedDraft[f.path] ||
                      (f.path === "atk.map" && attackMapDirty)
                    );
                  }
                  return draft[f.path] !== persistedDraft[f.path];
                });
                const isActive = activeSection === sec.id;
                const secMeta = SECTION_METADATA[sec.id];

                return (
                  <button
                    key={sec.id}
                    role="tab"
                    id={`tab-${sec.id}`}
                    aria-controls={`section-${sec.id}`}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    type="button"
                    onClick={() => setActiveSection(sec.id)}
                    className={`relative inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isActive
                        ? "text-accent"
                        : secErrors > 0
                          ? "text-danger hover:bg-danger/5"
                          : isSecDirty
                            ? "text-accent/70 hover:bg-accent/5"
                            : "text-muted hover:text-foreground hover:bg-elevated/60"
                    }`}
                  >
                    {/* Active indicator: bottom border */}
                    {isActive ? (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />
                    ) : null}
                    <span className="shrink-0">{SECTION_ICONS[sec.id]}</span>
                    <span>{secMeta?.title ?? sec.title}</span>
                    {secErrors > 0 ? (
                      <span className="size-1.5 rounded-full bg-danger" aria-hidden="true" />
                    ) : isSecDirty ? (
                      <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section Panels — ALL always mounted; CSS hidden/block preserves state */}
          <div>
            {visibleSections!.map((section) => {
              const secErrors = section.fields.filter((f) => errors[f.path] !== undefined).length;
              const isSecDirty = section.fields.some((f) => {
                if (f.path === "atk.map" || f.path === "atk.x" || f.path === "atk.y" || f.path === "atk.zone") {
                  return (
                    draft[f.path] !== persistedDraft[f.path] ||
                    (f.path === "atk.map" && attackMapDirty)
                  );
                }
                return draft[f.path] !== persistedDraft[f.path];
              });

              const isActive = activeSection === section.id;
              const sectionMeta = SECTION_METADATA[section.id];
              const isAutoFarmActive = Number(draft["atk.mode"]) === 1 || Number(draft["atk.mode"]) === 2;

              return (
                <div
                  id={`section-${section.id}`}
                  key={section.id}
                  role="tabpanel"
                  aria-labelledby={`tab-${section.id}`}
                  className={isActive ? "block" : "hidden"}
                >
                  {section.id === "auto_farm" ? (
                    <AutoFarmPanel
                      draft={draft}
                      persistedDraft={persistedDraft}
                      errors={errors}
                      disabled={saving}
                      ctlVersion={targetControlVersion}
                      onChange={handleChange}
                      onBatchChange={handleBatchChange}
                      attackMapIntent={attackMapIntent}
                      onAttackMapIntentChange={handleAttackMapIntentChange}
                      isActive={isActive}
                      account={account}
                    />
                  ) : (
                    <Card className="overflow-hidden border border-border bg-surface shadow-xs">
                      {/* Section Header */}
                      <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-muted">{SECTION_ICONS[section.id]}</span>
                            <h3 className="text-sm font-semibold tracking-tight text-foreground">
                              {sectionMeta?.title ?? section.title}
                            </h3>
                          </div>
                          <div className="flex items-center gap-2">
                            {secErrors > 0 ? (
                              <span className="rounded border border-danger/35 bg-danger/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
                                {secErrors} {secErrors === 1 ? "lỗi" : "lỗi"}
                              </span>
                            ) : isSecDirty ? (
                              <span className="rounded border border-accent/35 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
                                Đã thay đổi
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {sectionMeta?.description ?? section.description ? (
                          <p className="mt-0.5 text-xs text-muted">{sectionMeta?.description ?? section.description}</p>
                        ) : null}
                      </div>

                      {/* Manual Travel Lockout Guidance Banner */}
                      {section.id === "travel" && isAutoFarmActive ? (
                        <div
                          id="manual-travel-lockout-banner"
                          className="m-4 mb-2 rounded-md border border-warning/35 bg-warning/10 p-3 text-xs text-warning sm:m-5 sm:mb-2 flex items-start gap-2.5"
                        >
                          <IconWarning className="size-4 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">Di chuyển thủ công đang bị khóa</p>
                            <p className="text-muted leading-relaxed">
                              Tự động đánh đang bật ({Number(draft["atk.mode"]) === 1 ? "Đứng yên" : "Di chuyển"}) nên nắm quyền điều khiển điểm đến.
                              Vui lòng chuyển chế độ Tự động đánh sang Tắt để sử dụng Di chuyển thủ công.
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {/* Visual QoL Compatibility Banner when device not capable */}
                      {section.id === "visual_qol" && !isQoLCapable ? (
                        <div
                          id="visual-qol-compatibility-banner"
                          className="m-4 mb-2 rounded-md border border-warning/35 bg-warning/10 p-3 text-xs text-warning sm:m-5 sm:mb-2 flex items-start gap-2.5"
                        >
                          <IconWarning className="size-4 shrink-0 mt-0.5" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">
                              {isExistingV14
                                ? "Máy chủ hiện tại chưa hỗ trợ thiết lập Giao diện & Hiệu ứng"
                                : "Cần cập nhật runtime để sử dụng tính năng này"}
                            </p>
                            <p className="text-muted leading-relaxed">
                              {isExistingV14
                                ? "Cấu hình đã lưu trước đó vẫn được giữ nguyên đầy đủ. Vui lòng cập nhật phiên bản runtime mới hơn trên máy chủ để có thể áp dụng các tùy chọn này."
                                : "Tính năng tắt hiệu ứng và ẩn người chơi yêu cầu phiên bản runtime mới hơn trên máy chủ."}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {/* Section Fields */}
                      <div className="divide-y divide-border/40 px-4 sm:px-5">
                        {section.fields.map((field) => {
                          const isFieldDisabled =
                            saving ||
                            (section.id === "travel" && field.path === "nav.target" && isAutoFarmActive) ||
                            (section.id === "visual_qol" && !isQoLCapable);

                          return (
                            <div
                              key={`${field.path}-${resetKey}`}
                              className="py-2.5 first:pt-2.5 last:pb-2.5"
                            >
                              <ConfigFieldInput
                                field={field}
                                value={draft[field.path] ?? ""}
                                values={draft}
                                error={errors[field.path]}
                                disabled={isFieldDisabled}
                                onChange={handleChange}
                                onBatchChange={handleBatchChange}
                                attackMapIntent={attackMapIntent}
                                onAttackMapIntentChange={handleAttackMapIntentChange}
                                telemetryMounts={account.snapshot?.mounts}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sticky Save Action Bar — compact py-2 */}
          <div className="sticky bottom-0 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-elevated/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 shadow-lg z-30">
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                busy={saving}
                disabled={offline || !dirty || versionGated}
                onClick={handleSave}
                icon={<IconSave />}
              >
                Lưu thay đổi
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={saving || !dirty}
                onClick={handleReset}
              >
                Đặt lại
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {offline ? (
                <span className="font-medium text-warning flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Máy chủ mất kết nối — không thể lưu
                </span>
              ) : saving ? (
                <span className="font-medium text-accent flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
                  Đang lưu cấu hình…
                </span>
              ) : errorCount > 0 ? (
                <span className="font-medium text-danger flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-danger" aria-hidden="true" />
                  {errorCount} {errorCount === 1 ? "trường cần sửa" : "trường cần sửa"}
                </span>
              ) : dirty ? (
                <span className="font-medium text-warning flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Có thay đổi chưa lưu
                </span>
              ) : (
                <span className="font-mono text-muted flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-online" aria-hidden="true" />
                  Control v{jarCtlVersion ?? "?"} · Đã lưu vào hệ thống điều khiển
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Icon Library ───────────────────────────────────────────────────────────────

function IconCrosshair({ className = "size-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M8 1v3M8 12v3M1 8h3M12 8h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWarning({ className = "size-3.5 shrink-0" }: { className?: string }) {
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

function IconSave() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M13.5 13.5H2.5V2.5h8.5l2.5 2.5v8.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="5" y="2.5" width="4" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4" y="9" width="8" height="4.5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconSword() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M14.5 1.5l-6.5 6.5M11 1.5l3.5 3.5M6.5 9.5l-2.5 2.5-2.5.5.5-2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 1.5l6.5 6.5M5 1.5l-3.5 3.5M9.5 9.5l2.5 2.5 2.5.5-.5-2.5-2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <polygon points="8,2.5 10,8 8,6.8 6,8" fill="currentColor" />
      <polygon points="8,13.5 10,8 8,9.2 6,8" stroke="currentColor" strokeWidth="0.8" fill="currentColor" fillOpacity="0.25" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M6.5 1.5h3M7 1.5v2h2v-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.5 3.5h3L13 10.5a3 3 0 0 1-3 4H6a3 3 0 0 1-3-4l3.5-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 8v3M6.5 9.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconMount() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path
        d="M3 14.5c0-2 .8-3.5 2-4.5.3-.3.8-1.5.8-2.5 0-1.5.5-3.5 1.5-4.8.4-.5 1.4-.3 1.8.2l.5 1.6 2.4 1.2c1 .5 1.5 1.5 1.5 2.5 0 .8-.5 1.3-1.5 1.5L9.5 10.5l-.5 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6.5 6.5l-2-1M6 9l-2-1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="10" cy="6.8" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M2 7h12l-1.5 2H11v3.5l1.5 1.5H3.5L5 12.5V9H3.5L2 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12.5 2l-3 3M10.5 1.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 3.5l.4-.8.4.8.8.4-.8.4-.4.8-.4-.8-.8-.4.8-.4z" fill="currentColor" />
    </svg>
  );
}

function IconDoor() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M2.5 14.5V6.5a5.5 5.5 0 0 1 11 0v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M1.5 14.5h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M5.5 7.5v7M8 6v8.5M10.5 7.5v7M3.5 10.5h9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="5.5" cy="4" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.5" fill="currentColor" />
      <circle cx="6.5" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconEye({ className = "size-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

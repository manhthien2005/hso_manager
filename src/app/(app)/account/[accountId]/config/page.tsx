"use client";

import { use, useEffect, useRef, useState } from "react";
import { ConfigFieldInput } from "@/components/accounts/config-field";
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
  validateDraft,
  type ConfigDraft,
  type ConfigErrors,
  type ConfigPath,
  type ConfigValue,
} from "@/lib/config-schema";
import { isAttackMapSelectionDirty } from "@/lib/attack-spot";
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
        title="Account not found"
        hint="No account with this ID is registered to your fleet."
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

// ── Section icon map ──────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, React.ReactNode> = {
  combat: <IconSword />,
  travel: <IconCompass />,
  loot: <IconBag />,
  recovery: <IconHeart />,
  mount: <IconMount />,
  enhance: <IconSparkle />,
  dungeon: <IconDoor />,
  spot: <IconPin />,
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
  const sections = jarCtlVersion !== null ? CONTROL_SCHEMA[jarCtlVersion] : undefined;
  const versionGated = jarCtlVersion === null || sections === undefined;

  const [draft, setDraft] = useState<ConfigDraft>(() =>
    account.control
      ? controlRecordToDraft(account.control)
      : defaultControlDraft(),
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
    ? controlRecordToDraft(account.control)
    : defaultControlDraft();

  const rawFieldsDirty =
    JSON.stringify(controlRecordToDraft(draftToControlRecord(draft))) !==
    JSON.stringify(persistedDraft);
  const attackMapDirty = isAttackMapSelectionDirty(
    persistedDraft,
    draft,
    attackMapIntent,
  );
  const dirty = rawFieldsDirty || attackMapDirty;
  const offline = device?.status !== "online";
  const errorCount = Object.keys(errors).length;

  // version_mismatch banner: the agent refused to write the last config
  const versionMismatch = account.config_status === "version_mismatch";

  const [resetKey, setResetKey] = useState(0);

  // Tab-based section navigation — CSS hidden/block keeps all sections mounted
  // so draft state, validation, and attackMapIntent survive tab switches.
  const [activeSection, setActiveSection] = useState<string>(
    sections?.[0]?.id ?? "combat",
  );

  function handleChange(path: ConfigPath, value: ConfigValue) {
    const next = { ...draftRef.current, [path]: value };
    draftRef.current = next;
    setDraft(next);
    if (touched) setErrors(validateDraft(next, jarCtlVersion ?? 0, attackMapIntentRef.current));
  }

  function handleBatchChange(updates: Partial<Record<ConfigPath, ConfigValue>>) {
    const next = { ...draftRef.current, ...updates };
    draftRef.current = next;
    setDraft(next);
    if (touched) setErrors(validateDraft(next, jarCtlVersion ?? 0, attackMapIntentRef.current));
  }

  function handleAttackMapIntentChange(nextIntent: string | null) {
    attackMapIntentRef.current = nextIntent;
    setAttackMapIntent(nextIntent);
    if (touched) {
      setErrors(validateDraft(draftRef.current, jarCtlVersion ?? 0, nextIntent));
    }
  }

  async function handleSave() {
    if (jarCtlVersion === null || !sections) return;
    const currentDraft = draftRef.current;
    const nextErrors = validateDraft(currentDraft, jarCtlVersion, attackMapIntentRef.current);
    setErrors(nextErrors);
    setTouched(true);
    if (Object.keys(nextErrors).length > 0) {
      push("error", "Config not saved", "Fix the highlighted fields and try again");
      return;
    }
    try {
      const control = draftToControlRecord(currentDraft);
      await saveConfig(account.id, {
        control,
        controlVersion: jarCtlVersion,
      });
      setTouched(false);
      attackMapIntentRef.current = null;
      setAttackMapIntent(null);
      push(
        "success",
        "Config saved",
        `Control v${jarCtlVersion} saved to control plane for ${device?.name ?? "device"}`,
      );
    } catch (error) {
      push("error", "Save failed", describeError(error));
    }
  }

  function handleReset() {
    const next = account.control
      ? controlRecordToDraft(account.control)
      : defaultControlDraft();
    draftRef.current = next;
    setDraft(next);
    setErrors({});
    setTouched(false);
    attackMapIntentRef.current = null;
    setAttackMapIntent(null);
    setResetKey((k) => k + 1);
  }

  return (
    <div className="relative pb-24">
      <PageHeader
        back={{
          href: device ? `/device/${device.deviceId}/accounts` : "/",
          label: device ? `${device.name} accounts` : "Dashboard",
        }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Configure {account.label}</span>
            <AccountStatusBadge status={account.status} />
          </span>
        }
        subtitle={
          <span className="font-mono text-xs text-muted">
            {account.id} · {device?.name ?? account.deviceId} · Control v{jarCtlVersion ?? "?"}
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
                Version Mismatch — Last Configuration Refused by Agent
              </h3>
              <p className="text-xs text-foreground/90 leading-relaxed">
                The agent refused to write the control file to disk because the schema version does not match the running emulator jar version.
              </p>
              <p className="text-xs text-muted leading-relaxed">
                The account continues running safely with the previous valid configuration.
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
                  ? "Jar Version Not Yet Reported"
                  : `Jar CTL Version ${jarCtlVersion} Is Not Supported`}
              </h3>
              <p className="text-xs text-foreground/90 leading-relaxed">
                {jarCtlVersion === null
                  ? "The agent has not yet reported which jar it is running. Connect the device and wait for the first heartbeat."
                  : `Update the web dashboard to support CTL version ${jarCtlVersion}, or roll back the jar on this device.`}
              </p>
              <p className="text-xs text-muted leading-relaxed">
                The account continues running with the last valid config that was saved.
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
                {device?.name ?? "This device"} is offline. You can edit the configuration draft, but saving to the control plane is blocked until the agent reconnects.
              </span>
            </div>
          ) : null}

          {/* Section Tab Navigation Bar */}
          <div className="sticky top-16 z-20 -mx-4 mb-4 border-y border-border/80 bg-background/95 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div
              className="flex items-center gap-0.5 overflow-x-auto"
              style={{ scrollbarWidth: "none" }}
            >
              {sections!.map((sec) => {
                const secErrors = sec.fields.filter((f) => errors[f.path] !== undefined).length;
                const isSecDirty = sec.fields.some((f) => {
                  if (f.path === "atk.map" || f.path === "atk.x" || f.path === "atk.y") {
                    return (
                      draft[f.path] !== persistedDraft[f.path] ||
                      (f.path === "atk.map" && attackMapDirty)
                    );
                  }
                  return draft[f.path] !== persistedDraft[f.path];
                });
                const isActive = activeSection === sec.id;

                return (
                  <button
                    key={sec.id}
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
                    aria-pressed={isActive}
                  >
                    {/* Active indicator: bottom border */}
                    {isActive ? (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-accent" aria-hidden="true" />
                    ) : null}
                    <span className="shrink-0">{SECTION_ICONS[sec.id]}</span>
                    <span>{sec.title}</span>
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
            {sections!.map((section) => {
              const secErrors = section.fields.filter((f) => errors[f.path] !== undefined).length;
              const isSecDirty = section.fields.some((f) => {
                if (f.path === "atk.map" || f.path === "atk.x" || f.path === "atk.y") {
                  return (
                    draft[f.path] !== persistedDraft[f.path] ||
                    (f.path === "atk.map" && attackMapDirty)
                  );
                }
                return draft[f.path] !== persistedDraft[f.path];
              });

              const isActive = activeSection === section.id;

              return (
                <div
                  id={`section-${section.id}`}
                  key={section.id}
                  className={isActive ? "block" : "hidden"}
                >
                  <Card className="overflow-hidden border border-border bg-surface shadow-xs">
                    {/* Section Header */}
                    <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-muted">{SECTION_ICONS[section.id]}</span>
                          <h3 className="text-sm font-semibold tracking-tight text-foreground">
                            {section.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          {secErrors > 0 ? (
                            <span className="rounded border border-danger/35 bg-danger/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
                              {secErrors} error{secErrors === 1 ? "" : "s"}
                            </span>
                          ) : isSecDirty ? (
                            <span className="rounded border border-accent/35 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
                              Modified
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {section.description ? (
                        <p className="mt-0.5 text-xs text-muted">{section.description}</p>
                      ) : null}
                    </div>

                    {/* Section Fields — tighter py-2.5 padding */}
                    <div className="divide-y divide-border/40 px-4 sm:px-5">
                      {section.fields.map((field) => (
                        <div
                          key={`${field.path}-${resetKey}`}
                          className="py-2.5 first:pt-2.5 last:pb-2.5"
                        >
                          <ConfigFieldInput
                            field={field}
                            value={draft[field.path] ?? ""}
                            values={draft}
                            error={errors[field.path]}
                            disabled={saving}
                            onChange={handleChange}
                            onBatchChange={handleBatchChange}
                            attackMapIntent={attackMapIntent}
                            onAttackMapIntentChange={handleAttackMapIntentChange}
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
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
                Save Changes
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={saving || !dirty}
                onClick={handleReset}
              >
                Reset
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {offline ? (
                <span className="font-medium text-warning flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Device offline — reconnect to save
                </span>
              ) : saving ? (
                <span className="font-medium text-accent flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-accent animate-pulse" aria-hidden="true" />
                  Saving to control plane…
                </span>
              ) : errorCount > 0 ? (
                <span className="font-medium text-danger flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-danger" aria-hidden="true" />
                  {errorCount} field{errorCount === 1 ? " needs" : "s need"} attention
                </span>
              ) : dirty ? (
                <span className="font-medium text-warning flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                  Unsaved changes
                </span>
              ) : (
                <span className="font-mono text-muted flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-online" aria-hidden="true" />
                  Control v{jarCtlVersion ?? "?"} · Saved to control plane
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
      <path d="M10 2l4 4-7 7-1.5-1.5L4 13l-1-1 1.5-1.5L3 9l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 5.5L9 9l-3.5 1.5 1.5-3.5 3.5-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function IconBag() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M5 5.5V4a3 3 0 0 1 6 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="2" y="5.5" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M8 13S2 9 2 5.5a3 3 0 0 1 6-1A3 3 0 0 1 14 5.5C14 9 8 13 8 13z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function IconMount() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <ellipse cx="8" cy="9" rx="5" ry="3.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 9v3M12 9v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 9c0-2 4-4 4-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconSparkle() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.2 4.2l2.1 2.1M9.7 9.7l2.1 2.1M11.8 4.2l-2.1 2.1M6.3 9.7l-2.1 2.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconDoor() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="3.5" y="2" width="9" height="13" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11" cy="8.5" r="0.8" fill="currentColor" />
      <path d="M3.5 15h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M8 2a4 4 0 0 1 4 4c0 3-4 8-4 8S4 9 4 6a4 4 0 0 1 4-4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

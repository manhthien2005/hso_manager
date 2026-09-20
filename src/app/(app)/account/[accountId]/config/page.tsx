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
 * Account Configuration — Storm Steel Editor.
 *
 * Operational hierarchy & invariants:
 *   - Version-gated against `device.jar_ctl_version`.
 *   - Gated banner if jar version not reported or unsupported.
 *   - Version mismatch banner if last config write was refused by agent.
 *   - Offline device warning blocks saving while allowing draft inspection/edits.
 *   - Quick section sub-navigation with error/dirty indicators.
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

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(`section-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

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
            <span className="text-danger text-base shrink-0 mt-0.5" aria-hidden="true">
              ⚠️
            </span>
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
            <span className="text-warning text-base shrink-0 mt-0.5" aria-hidden="true">
              ⚠️
            </span>
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
              <span aria-hidden="true">⚠️</span>
              <span>
                {device?.name ?? "This device"} is offline. You can edit the configuration draft, but saving to the control plane is blocked until the agent reconnects.
              </span>
            </div>
          ) : null}

          {/* Section Quick Navigation Bar */}
          <div className="sticky top-16 z-20 -mx-4 mb-6 border-y border-border/80 bg-background/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted shrink-0">
                Jump to:
              </span>
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

                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => scrollToSection(sec.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                      secErrors > 0
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : isSecDirty
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-border bg-elevated/50 text-muted hover:border-border hover:bg-elevated hover:text-foreground"
                    }`}
                  >
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

          {/* Section Forms */}
          <div className="space-y-6">
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

              return (
                <div
                  id={`section-${section.id}`}
                  key={section.id}
                  className="scroll-mt-28"
                >
                  <Card className="overflow-hidden border border-border bg-surface shadow-xs">
                    {/* Section Header */}
                    <div className="border-b border-border/70 bg-elevated/40 px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold tracking-tight text-foreground">
                          {section.title}
                        </h3>
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

                    {/* Section Fields list with hairline dividers */}
                    <div className="divide-y divide-border/40 px-4 sm:px-5">
                      {section.fields.map((field) => (
                        <div
                          key={`${field.path}-${resetKey}`}
                          className="py-3.5 first:pt-3 last:pb-3"
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

          {/* Sticky Save Action Bar */}
          <div className="sticky bottom-0 -mx-4 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-elevated/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 shadow-lg z-30">
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                busy={saving}
                disabled={offline || !dirty || versionGated}
                onClick={handleSave}
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

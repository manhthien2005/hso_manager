"use client";

import { use, useState } from "react";
import { ConfigFieldInput } from "@/components/accounts/config-field";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
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
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import type { Account, Device } from "@/lib/types";

/**
 * Account configuration — version-gated against `device.jar_ctl_version`.
 *
 * If the device has never reported its jar version, or the version is not in
 * CONTROL_SCHEMA, we render a banner instead of a form. This prevents saving
 * a stale schema that the jar will refuse with `ctl=0`.
 *
 * The form is driven entirely by `CONTROL_SCHEMA[version]`, so adding a field
 * for a new version means editing `lib/config-schema.ts` only.
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
  const [errors, setErrors] = useState<ConfigErrors>({});
  const [touched, setTouched] = useState(false);

  const saving = isPending(pendingKey.config(account.id));
  const dirty =
    JSON.stringify(draftToControlRecord(draft)) !==
    JSON.stringify(account.control ?? defaultControlDraft());
  const offline = device?.status !== "online";
  const errorCount = Object.keys(errors).length;

  // version_mismatch banner: the agent refused to write the last config
  const versionMismatch = account.config_status === "version_mismatch";

  function handleChange(path: ConfigPath, value: ConfigValue) {
    const next = { ...draft, [path]: value };
    setDraft(next);
    if (touched) setErrors(validateDraft(next, jarCtlVersion ?? 0));
  }

  async function handleSave() {
    if (jarCtlVersion === null || !sections) return;
    const nextErrors = validateDraft(draft, jarCtlVersion);
    setErrors(nextErrors);
    setTouched(true);
    if (Object.keys(nextErrors).length > 0) {
      push("error", "Config not saved", "Fix the highlighted fields and try again");
      return;
    }
    try {
      // saveConfig receives the control record + control_version.
      // The legacy `AccountConfig` path is kept in the store for mock-api compat;
      // the Supabase implementation will ignore it and use `control`.
      await saveConfig(account.id, account.config);
      setTouched(false);
      push(
        "success",
        "Config saved",
        `Control v${jarCtlVersion} sent to ${device?.name ?? "device"}`,
      );
    } catch (error) {
      push("error", "Save failed", describeError(error));
    }
  }

  function handleReset() {
    setDraft(
      account.control
        ? controlRecordToDraft(account.control)
        : defaultControlDraft(),
    );
    setErrors({});
    setTouched(false);
  }

  return (
    <>
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
          <span className="font-mono text-xs">
            {account.id} · {device?.name ?? account.deviceId}
          </span>
        }
      />

      {/* version_mismatch: agent refused last config — most important banner */}
      {versionMismatch ? (
        <Card className="mb-4 border-danger/40 bg-danger/8 px-4 py-3" id="config-version-mismatch-banner">
          <p className="text-sm font-medium text-danger">
            ⚠️ Version mismatch — last config was NOT applied
          </p>
          <p className="mt-1 text-xs text-danger/80">
            {account.config_status === "version_mismatch"
              ? "The agent refused to write the control file because the schema version does not match the running jar."
              : "Unknown config error."}{" "}
            The account continues running with the previous valid config.
          </p>
        </Card>
      ) : null}

      {/* version gate: jar version not recognised */}
      {versionGated ? (
        <Card className="mb-4 px-4 py-6" id="config-version-gate-banner">
          <p className="text-sm font-semibold text-warning">
            {jarCtlVersion === null
              ? "Jar version not yet reported"
              : `Jar CTL version ${jarCtlVersion} is not supported by this UI`}
          </p>
          <p className="mt-2 text-xs text-muted">
            {jarCtlVersion === null
              ? "The agent has not yet reported which jar it is running. Connect the device and wait for the first heartbeat."
              : `Update the web dashboard to support CTL version ${jarCtlVersion}, or roll back the jar.`}
          </p>
          <p className="mt-2 text-xs text-muted">
            The account continues running with the last valid config that was saved.
          </p>
        </Card>
      ) : (
        <>
          {offline ? (
            <Card className="mb-4 border-warning/40 bg-warning/8 px-4 py-3">
              <p className="text-sm text-warning">
                {device?.name ?? "This device"} is offline. You can edit the
                config, but saving is blocked until the agent reconnects.
              </p>
            </Card>
          ) : null}

          <div className="space-y-4">
            {sections!.map((section) => (
              <Card key={section.id}>
                <CardHeader title={section.title} subtitle={section.description} />
                <div className="space-y-4 px-4 py-4">
                  {section.fields.map((field) => (
                    <ConfigFieldInput
                      key={field.path}
                      field={field}
                      value={draft[field.path] ?? ""}
                      error={errors[field.path]}
                      disabled={saving}
                      onChange={handleChange}
                    />
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <div className="sticky bottom-0 -mx-4 mt-6 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <Button
              variant="primary"
              busy={saving}
              disabled={offline || !dirty || versionGated}
              onClick={handleSave}
            >
              Save Changes
            </Button>
            <Button variant="ghost" disabled={saving || !dirty} onClick={handleReset}>
              Reset
            </Button>
            <span className="ml-auto text-xs text-muted">
              {errorCount > 0
                ? `${errorCount} field${errorCount === 1 ? " needs" : "s need"} attention`
                : dirty
                  ? "Unsaved changes"
                  : `Control v${jarCtlVersion ?? "?"} — all changes saved`}
            </span>
          </div>
        </>
      )}
    </>
  );
}

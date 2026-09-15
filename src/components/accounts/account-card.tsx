"use client";

import Link from "next/link";
import type { Account } from "@/lib/types";
import { useAccountCommand } from "@/hooks/use-account-command";
import { AccountStatusBadge } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TelemetryPanel } from "@/components/accounts/telemetry-panel";

/**
 * Account row per the spec: label, status, character, server, RAM, PID and the
 * Stop / Restart / Configure actions.
 *
 * `disabledReason` lets a parent (offline device) kill the actions with an
 * explanation instead of letting each click fail through the API.
 *
 * TelemetryPanel (Task 14, C4) is embedded here so snapshot data is visible
 * from the fleet dashboard without navigating away.
 */
export function AccountCard({
  account,
  disabledReason,
}: {
  account: Account;
  disabledReason?: string;
}) {
  const { run, busyWith } = useAccountCommand(account.id);
  const actionsDisabled = disabledReason !== undefined || account.status === "offline";

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{account.label}</h3>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{account.id}</p>
        </div>
        <AccountStatusBadge status={account.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Fact label="Character" value={account.characterName ?? "—"} />
        <Fact label="Server" value={account.serverId === null ? "—" : String(account.serverId)} />
        <Fact label="RAM" value={account.ramMb === null ? "—" : `${Math.round(account.ramMb)} MB`} />
        <Fact label="PID" value={account.pid === null ? "—" : String(account.pid)} />
      </dl>

      {/* Telemetry panel: snapshot + health badges + version_mismatch banner */}
      <div className="mt-4 border-t border-border pt-3">
        <TelemetryPanel account={account} />
      </div>

      {disabledReason ? (
        <p className="mt-3 text-xs text-warning">{disabledReason}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {account.status === "stopped" || account.status === "error" ? (
          <Button
            size="sm"
            variant="primary"
            busy={busyWith("start")}
            disabled={actionsDisabled}
            onClick={() => run("start")}
          >
            Start
          </Button>
        ) : null}
        <Button
          size="sm"
          busy={busyWith("stop")}
          disabled={actionsDisabled || account.status === "stopped"}
          onClick={() => run("stop")}
        >
          Stop
        </Button>
        <Button
          size="sm"
          busy={busyWith("restart")}
          disabled={actionsDisabled || account.status === "stopped"}
          onClick={() => run("restart")}
        >
          Restart
        </Button>
        <Link
          href={`/account/${account.id}/config`}
          className="ml-auto inline-flex h-8 items-center rounded-md border border-border bg-elevated px-3 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          Configure
        </Link>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs tabular">{value}</dd>
    </div>
  );
}


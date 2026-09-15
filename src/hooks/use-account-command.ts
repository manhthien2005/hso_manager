import { useCallback } from "react";
import { CommandFailedError, describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";

/**
 * Shared Start / Stop / Restart flow so every surface behaves identically:
 * pending button -> mock latency -> state update -> success or error toast.
 *
 * `apply-config` and the viewer commands have their own surfaces (config form,
 * viewer page) and are not routed through here.
 *
 * A failed command still settles the account into `error`; the store already
 * applied it via the realtime listener, so only the toast differs.
 */

export type AccountCommand = "start" | "stop" | "restart";

const VERBS: Record<AccountCommand, string> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
};

export function useAccountCommand(accountId: string) {
  const { runCommand, isPending, getAccount } = useZeusStore();
  const { push } = useToast();

  const run = useCallback(
    async (command: AccountCommand) => {
      const label = getAccount(accountId)?.label ?? "Account";
      try {
        const { account } = await runCommand({ accountId, type: command });
        push("success", `${VERBS[command]} complete`, `${label} is now ${account.status}`);
      } catch (error) {
        const title =
          error instanceof CommandFailedError
            ? `${VERBS[command]} failed`
            : `${VERBS[command]} rejected`;
        push("error", title, describeError(error));
      }
    },
    [accountId, getAccount, push, runCommand],
  );

  return {
    run,
    /** True only for the command this button triggered, so siblings stay enabled. */
    busyWith: (command: AccountCommand) =>
      isPending(pendingKey.command(accountId, command)),
  };
}

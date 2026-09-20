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

import { ACCOUNT_STATUS_LABELS } from "@/components/ui/status";

export type AccountCommand = "start" | "stop" | "restart";

const VERBS: Record<AccountCommand, string> = {
  start: "Khởi động",
  stop: "Dừng",
  restart: "Khởi động lại",
};

export function useAccountCommand(accountId: string) {
  const { runCommand, isPending, getAccount } = useZeusStore();
  const { push } = useToast();

  const run = useCallback(
    async (command: AccountCommand) => {
      const label = getAccount(accountId)?.label ?? "Tài khoản";
      try {
        const { account } = await runCommand({ accountId, type: command });
        const statusLabel = ACCOUNT_STATUS_LABELS[account.status] ?? account.status;
        push("success", `${VERBS[command]} hoàn tất`, `${label} hiện đang ${statusLabel}`);
      } catch (error) {
        const title =
          error instanceof CommandFailedError
            ? `${VERBS[command]} thất bại`
            : `${VERBS[command]} bị từ chối`;
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

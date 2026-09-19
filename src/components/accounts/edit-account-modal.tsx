"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { SERVER_OPTIONS } from "@/lib/game-servers";
import type { Account, UpdateAccountInput } from "@/lib/types";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";

interface EditAccountModalProps {
  account: Account;
  isOpen: boolean;
  onClose: () => void;
}

export function EditAccountModal({
  account,
  isOpen,
  onClose,
}: EditAccountModalProps) {
  if (!isOpen) return null;

  return (
    <EditAccountModalContent
      key={account.id}
      account={account}
      onClose={onClose}
    />
  );
}

function EditAccountModalContent({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const { updateAccount, isPending } = useZeusStore();
  const { push } = useToast();

  const initialServer = account.serverId ?? account.config?.serverId ?? 0;
  const currentUsername = account.config.accountName;

  const [label, setLabel] = useState(account.label);
  const [username, setUsername] = useState(currentUsername);
  const [password, setPassword] = useState("");
  const [serverIndex, setServerIndex] = useState(initialServer);

  const [errors, setErrors] = useState<{
    label?: string;
    username?: string;
    password?: string;
    serverIndex?: string;
  }>({});

  const isSubmitting = isPending(pendingKey.accountUpdate(account.id));
  const usernameChanged = username !== currentUsername;
  const isRunning = ["running", "starting", "restarting"].includes(account.status);

  // Close on Escape if not submitting
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors: {
      label?: string;
      username?: string;
      password?: string;
      serverIndex?: string;
    } = {};

    const trimmedLabel = label.trim();

    if (trimmedLabel.length === 0) {
      newErrors.label = "Account label must not be empty";
    }

    if (username.trim().length === 0) {
      newErrors.username = "Username must not be empty";
    }

    if (usernameChanged && password.length === 0) {
      newErrors.password = "Password is required when changing username.";
    }

    if (
      typeof serverIndex !== "number" ||
      !Number.isInteger(serverIndex) ||
      !SERVER_OPTIONS.some((server) => server.value === serverIndex)
    ) {
      newErrors.serverIndex = "Please select a valid game server";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    const serverChanged = serverIndex !== (account.serverId ?? account.config?.serverId);
    const credentialsChanged = usernameChanged || password.length > 0;

    let credentials: UpdateAccountInput["credentials"] = undefined;
    if (!usernameChanged && password.length > 0) {
      // Case B: Password change only - preserve exact current username
      credentials = {
        username: currentUsername,
        password,
      };
    } else if (usernameChanged && password.length > 0) {
      // Case D: Username change + password supplied
      credentials = {
        username,
        password,
      };
    }

    try {
      const updated = await updateAccount({
        accountId: account.id,
        label: trimmedLabel,
        serverIndex,
        credentials,
      });

      // Clear password state immediately after Save to minimize sensitive lifetime
      setPassword("");
      onClose();

      if (isRunning && (serverChanged || credentialsChanged)) {
        push(
          "info",
          "Account updated",
          "Saved. Restart the account to apply login/server changes.",
        );
      } else {
        push(
          "success",
          "Account updated",
          `${updated.label} was updated successfully.`,
        );
      }
    } catch (error) {
      // Clear password on error to protect credentials in memory, keep modal open
      setPassword("");
      push("error", "Failed to update account", describeError(error));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-lg p-4 sm:p-5 shadow-xl border-border bg-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="edit-account-title" className="text-sm font-semibold tracking-tight">
              Edit Account
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted">{account.id}</p>
          </div>
        </div>

        {isRunning ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-accent/30 bg-accent/10 p-3 text-xs text-foreground/90"
          >
            This account is currently active. Server and credential changes will take effect after you restart the account.
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              id="edit-account-label"
              label="Label"
              placeholder="Main farmer"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (errors.label) setErrors((prev) => ({ ...prev, label: undefined }));
              }}
              disabled={isSubmitting}
              error={errors.label}
            />

            <SelectField
              id="edit-account-server"
              label="Server"
              options={[...SERVER_OPTIONS]}
              value={serverIndex}
              onChange={(e) => {
                setServerIndex(Number(e.target.value));
                if (errors.serverIndex) {
                  setErrors((prev) => ({ ...prev, serverIndex: undefined }));
                }
              }}
              disabled={isSubmitting}
              error={errors.serverIndex}
            />

            <TextField
              id="edit-account-username"
              label="Username"
              placeholder="Game username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (errors.username) {
                  setErrors((prev) => ({ ...prev, username: undefined }));
                }
              }}
              disabled={isSubmitting}
              autoComplete="off"
              error={errors.username}
            />

            <TextField
              id="edit-account-password"
              label="Password"
              type="password"
              placeholder="Leave blank to keep current password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              disabled={isSubmitting}
              autoComplete="new-password"
              help={
                usernameChanged
                  ? "Password is required when changing username."
                  : "Leave blank to keep the current password"
              }
              error={errors.password}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              busy={isSubmitting}
              disabled={isSubmitting}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

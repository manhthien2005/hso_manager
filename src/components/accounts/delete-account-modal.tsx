"use client";

import { useEffect, useRef } from "react";
import { Button, Spinner } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Account } from "@/lib/types";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";

interface DeleteAccountModalProps {
  account: Account;
  isOpen: boolean;
  onClose: () => void;
}

export function DeleteAccountModal({
  account,
  isOpen,
  onClose,
}: DeleteAccountModalProps) {
  if (!isOpen) return null;

  return (
    <DeleteAccountModalContent
      key={account.id}
      account={account}
      onClose={onClose}
    />
  );
}

function DeleteAccountModalContent({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const { deleteAccount, isPending } = useZeusStore();
  const { push } = useToast();

  const isDeleting = isPending(pendingKey.accountDelete(account.id));
  const isStopping = isPending(pendingKey.command(account.id, "stop"));
  const isSubmittingRef = useRef(false);

  // Close on Escape only if not deleting
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDeleting && !isSubmittingRef.current) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDeleting, onClose]);

  const handleConfirm = async () => {
    if (isDeleting || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    try {
      await deleteAccount(account.id);
      push(
        "success",
        "Account deleted",
        `${account.label} has been permanently deleted.`,
      );
      onClose();
    } catch (error) {
      push("error", "Delete failed", describeError(error));
    } finally {
      isSubmittingRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting && !isSubmittingRef.current) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-md p-4 sm:p-5 shadow-xl border-border bg-elevated">
        <div className="mb-4">
          <h2
            id="delete-account-title"
            className="text-sm font-semibold tracking-tight text-danger"
          >
            Delete Account
          </h2>
          <p className="mt-1 text-xs text-muted">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">{account.label}</span>?
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{account.id}</p>
        </div>

        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-foreground/90 space-y-2"
        >
          <p className="font-semibold text-danger">
            Deleting this account is permanent and cannot be undone.
          </p>
          <ul className="list-disc pl-4 space-y-1 text-muted">
            <li>
              The Web will first ask the Agent to stop and verify the emulator process.
            </li>
            <li>
              Only after that Stop is confirmed will the account record be deleted.
            </li>
            <li>
              Account runtime and command history for this account are removed by database cascade.
            </li>
            <li>
              The slot index is permanently retired and is not reused.
            </li>
          </ul>
        </div>

        {isDeleting ? (
          <div className="mb-4 rounded-md border border-border bg-elevated/50 p-3 text-xs flex items-center gap-2">
            <Spinner className="size-4 text-accent" />
            <span className="text-foreground font-medium">
              {isStopping
                ? "Stopping emulator process..."
                : "Deleting account records..."}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isDeleting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            busy={isDeleting}
            disabled={isDeleting}
            onClick={handleConfirm}
          >
            {isDeleting
              ? isStopping
                ? "Stopping..."
                : "Deleting..."
              : "Confirm Delete"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

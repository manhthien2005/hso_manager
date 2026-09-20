"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";

/**
 * Login Page — Zeus Control Plane Entry.
 *
 * Contract:
 *   - Authenticates via Supabase Auth (signInWithPassword).
 *   - Redirects already-signed-in operators to dashboard ("/").
 *   - Displays clear actionable error diagnostics on failure.
 */
export default function LoginPage() {
  const { ready, user, login, isPending } = useZeusStore();
  const { push } = useToast();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const busy = isPending(pendingKey.auth);

  useEffect(() => {
    if (ready && user !== null) {
      router.replace("/");
    }
  }, [ready, user, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setFormError("Please enter both email address and password.");
      return;
    }

    try {
      await login({ username: trimmedUser, password });
      router.replace("/");
    } catch (error) {
      const message = describeError(error);
      setFormError(message);
      push("error", "Authentication Failed", message);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-sm sm:max-w-md">
        {/* Brand Header: Restrained Industrial Identity */}
        <div className="mb-6 text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-lg border border-border bg-surface text-accent shadow-xs">
            {/* Geometric Storm Steel Monogram */}
            <svg
              className="size-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>

          <div>
            <h1 className="font-mono text-xl font-bold tracking-[0.25em] text-foreground uppercase">
              ZEUS CONTROL PLANE
            </h1>
            <p className="text-xs text-muted mt-1">
              Industrial Fleet Automation for Knight Online (HSO)
            </p>
          </div>
        </div>

        {/* Authentication Card */}
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-7 shadow-xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <TextField
              name="username"
              label="Operator Email"
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="operator@zeus-fleet.internal"
              value={username}
              disabled={busy}
              className="min-h-[44px]"
              onChange={(event) => {
                setUsername(event.target.value);
                if (formError) setFormError(null);
              }}
            />

            <TextField
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              disabled={busy}
              className="min-h-[44px]"
              onChange={(event) => {
                setPassword(event.target.value);
                if (formError) setFormError(null);
              }}
            />

            {formError ? (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-xs text-danger"
              >
                <p className="font-medium">Authentication Failed</p>
                <p className="mt-0.5 text-danger/90 leading-relaxed">{formError}</p>
              </div>
            ) : null}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                className="w-full min-h-[44px]"
              >
                {busy ? "Authenticating Session…" : "Sign In to Fleet Control"}
              </Button>
            </div>
          </form>

          {/* Security & Access Notice */}
          <div className="mt-6 border-t border-border pt-4 text-center">
            <p className="text-[11px] text-muted leading-relaxed">
              Restricted operational terminal · Encrypted token authentication
            </p>
          </div>
        </div>

        {/* Subordinate System Version Footer */}
        <div className="mt-6 text-center text-[11px] text-muted/70 font-mono">
          <span>HSO Manager · Storm Steel Edition</span>
        </div>
      </div>
    </div>
  );
}

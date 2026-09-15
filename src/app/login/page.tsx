"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { SEED_CREDENTIALS } from "@/services/seed-data";

/**
 * Mock login. Supabase Auth replaces `api.login` only; this form stays.
 * Already-signed-in users are bounced to the dashboard.
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
    if (ready && user !== null) router.replace("/");
  }, [ready, user, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      await login({ username, password });
      router.replace("/");
    } catch (error) {
      const message = describeError(error);
      setFormError(message);
      push("error", "Login failed", message);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-mono text-2xl font-semibold tracking-[0.4em]">ZEUS</h1>
          <p className="mt-2 text-xs text-muted">Knight Cloud control panel</p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-lg border border-border bg-surface p-6"
        >
          <TextField
            name="username"
            label="Username / Email"
            autoComplete="username"
            autoFocus
            value={username}
            disabled={busy}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />

          {formError ? (
            <p role="alert" className="text-xs text-danger">
              {formError}
            </p>
          ) : null}

          <Button type="submit" variant="primary" busy={busy} className="w-full">
            {busy ? "Signing in…" : "Login"}
          </Button>

          <p className="border-t border-border pt-4 text-center text-[11px] text-muted">
            Demo credentials —{" "}
            <span className="font-mono text-foreground">
              {SEED_CREDENTIALS.username} / {SEED_CREDENTIALS.password}
            </span>
          </p>
        </form>
      </div>
    </div>
  );
}

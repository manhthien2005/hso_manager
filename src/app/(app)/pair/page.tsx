"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/store/toast-store";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useZeusStore } from "@/store/zeus-store";
import { Card } from "@/components/ui/card";

/**
 * Pairing page — user nhập pair code 8 ký tự in trên Railway log.
 *
 * Flow:
 *   User mở Railway log → thấy "PAIR CODE: A3F9B21C"
 *   → nhập vào form này
 *   → gọi Supabase RPC claim_device(code)
 *   → device xuất hiện trong sidebar
 *   → redirect về dashboard
 */
export default function PairPage() {
  const router = useRouter();
  const { push } = useToast();
  const { reloadFleet } = useZeusStore();

  const [code, setCode] = useState(["", "", "", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const fullCode = code.join("").toUpperCase();
  const isComplete = fullCode.length === 8 && /^[0-9A-F]{8}$/.test(fullCode);

  function handleChange(index: number, value: string) {
    const char = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(-1);
    const next = [...code];
    next[index] = char;
    setCode(next);
    setError(null);

    // Auto-advance
    if (char && index < 7) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < 7) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/[^0-9a-fA-F]/g, "")
      .toUpperCase()
      .slice(0, 8);
    if (pasted.length > 0) {
      e.preventDefault();
      const next = Array(8).fill("");
      for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]!;
      setCode(next);
      inputs.current[Math.min(pasted.length, 7)]?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isComplete || busy) return;

    setBusy(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc("claim_device", { code: fullCode } as any);

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      // Reload fleet so new device appears in sidebar.
      await reloadFleet();

      setSuccess(true);
      push("success", "Device paired!", `Device ID: ${data}`);

      setTimeout(() => router.replace("/"), 1500);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Pairing failed. Check the code and try again.";
      setError(message);
      push("error", "Pairing failed", message);
      // Clear code on error
      setCode(Array(8).fill(""));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Pair a device"
        subtitle="Link a new VPS to your account using the code shown in Railway logs"
      />

      <div className="mx-auto max-w-md">
        <Card className="p-8">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="text-4xl">✓</span>
              <p className="font-mono text-lg text-online">Device paired!</p>
              <p className="text-sm text-muted">Redirecting to dashboard…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-2 text-center">
                <p className="text-sm text-muted">
                  Enter the 8-character code from your Railway service log
                </p>
                <p className="font-mono text-xs text-muted">
                  <span className="text-foreground">PAIR CODE:</span> A3F9B21C
                </p>
              </div>

              {/* 8-char hex input — split into individual boxes */}
              <div className="flex justify-center gap-2" onPaste={handlePaste}>
                {code.map((char, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputs.current[i] = el; }}
                    id={`pair-char-${i}`}
                    type="text"
                    inputMode="text"
                    maxLength={1}
                    value={char}
                    disabled={busy}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    autoFocus={i === 0}
                    className={[
                      "h-12 w-10 rounded-md border text-center font-mono text-lg uppercase",
                      "bg-elevated text-foreground outline-none transition-colors",
                      "focus:border-accent focus:ring-1 focus:ring-accent",
                      char ? "border-border" : "border-border/50",
                      busy ? "opacity-50 cursor-not-allowed" : "",
                      /* separator gap after char 3 */
                      i === 3 ? "mr-2" : "",
                    ].join(" ")}
                  />
                ))}
              </div>

              {error ? (
                <p role="alert" className="text-center text-xs text-danger">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                busy={busy}
                disabled={!isComplete}
              >
                {busy ? "Pairing…" : "Pair device"}
              </Button>

              <div className="border-t border-border pt-4 space-y-2 text-xs text-muted">
                <p className="font-medium text-foreground">Where to find the code</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Open your Railway project → select the service</li>
                  <li>Click <span className="font-mono text-foreground">Deployments → View logs</span></li>
                  <li>
                    Look for{" "}
                    <span className="font-mono text-foreground bg-elevated px-1 rounded">
                      PAIR CODE: XXXXXXXX
                    </span>
                  </li>
                  <li>Type or paste the 8-character code above</li>
                </ol>
              </div>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}


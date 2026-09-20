"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/store/toast-store";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useZeusStore } from "@/store/zeus-store";
import { Card } from "@/components/ui/card";

/**
 * Device Pairing — Claim a new VPS node into the fleet.
 *
 * Contract:
 *   - 8 hexadecimal characters: [0-9A-F]{8}
 *   - Authenticated RPC: claim_device(code)
 *   - On success: reloads fleet and redirects to dashboard.
 */
export default function PairPage() {
  const router = useRouter();
  const { push } = useToast();
  const { reloadFleet } = useZeusStore();

  const [code, setCode] = useState<string[]>(["", "", "", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const fullCode = code.join("").toUpperCase();
  const enteredCount = code.filter((c) => c.length > 0).length;
  const isComplete = fullCode.length === 8 && /^[0-9A-F]{8}$/.test(fullCode);

  const focusInput = useCallback((index: number) => {
    const target = inputs.current[index];
    if (target) {
      target.focus();
      target.select();
    }
  }, []);

  function handleChange(index: number, value: string) {
    const filtered = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    if (!filtered && value.length > 0) {
      // User typed an invalid character (non-hex)
      return;
    }

    const char = filtered.slice(-1);
    const next = [...code];
    next[index] = char;
    setCode(next);
    setError(null);

    // Auto-advance if character entered
    if (char && index < 7) {
      focusInput(index + 1);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (!code[index] && index > 0) {
        // Current box empty: move to previous box, clear it, and focus
        const next = [...code];
        next[index - 1] = "";
        setCode(next);
        focusInput(index - 1);
        e.preventDefault();
      } else if (code[index]) {
        // Current box has char: clear it in place
        const next = [...code];
        next[index] = "";
        setCode(next);
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      focusInput(index - 1);
    } else if (e.key === "ArrowRight" && index < 7) {
      e.preventDefault();
      focusInput(index + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusInput(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusInput(7);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const raw = e.clipboardData.getData("text").trim();

    // Check for standard pairing code patterns:
    // 1. "PAIR CODE: A3F9B21C" or "pair code: a3f9-b21c"
    // 2. "A3F9-B21C" or "A3F9 B21C"
    // 3. Raw hex string up to 8 chars: "A3F9B21C"
    const prefixMatch = raw.match(/^(?:PAIR\s*CODE:\s*)?([0-9a-fA-F]{4})[-\s]?([0-9a-fA-F]{4})$/i);
    let hexCode = "";

    if (prefixMatch) {
      hexCode = (prefixMatch[1] + prefixMatch[2]).toUpperCase();
    } else {
      // If the trimmed text consists strictly of hex characters and standard delimiters (- or space)
      const clean = raw.replace(/[-\s]/g, "");
      if (/^[0-9a-fA-F]{1,8}$/.test(clean)) {
        hexCode = clean.toUpperCase();
      } else {
        // Arbitrary string with unrelated words - do not cherry-pick letters
        setError("Nội dung dán không phải là mã ghép nối hợp lệ.");
        return;
      }
    }

    if (hexCode.length > 0) {
      const next = Array(8).fill("");
      for (let i = 0; i < hexCode.length; i++) {
        next[i] = hexCode[i]!;
      }
      setCode(next);
      setError(null);

      const targetIndex = Math.min(hexCode.length, 7);
      focusInput(targetIndex);
    }
  }

  function handleClear() {
    setCode(Array(8).fill(""));
    setError(null);
    focusInput(0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isComplete || busy) return;

    setBusy(true);
    setError(null);

    try {
      // Direct Supabase RPC invocation (preserving existing architecture contract)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcError } = await supabase.rpc("claim_device", { code: fullCode } as any);

      if (rpcError) {
        throw new Error(rpcError.message || "Ghép nối thiết bị thất bại. Mã ghép nối có thể không đúng hoặc đã được sử dụng.");
      }

      const deviceId = typeof data === "string" ? data : String(data ?? "");
      setPairedDeviceId(deviceId);

      // Reload fleet so newly linked node appears in store/sidebar
      await reloadFleet();

      setSuccess(true);
      push("success", "Ghép nối thiết bị thành công", deviceId ? `Mã thiết bị: ${deviceId}` : "Đã ghép nối máy chủ");

      setTimeout(() => {
        router.replace(deviceId ? `/device/${deviceId}` : "/");
      }, 1500);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Ghép nối thất bại. Vui lòng kiểm tra Agent trên máy chủ đang chạy và mã chưa hết hạn.";
      setError(message);
      push("error", "Ghép nối thất bại", message);
      // Retain the entered code so the operator can inspect and correct typographical errors
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Ghép nối thiết bị"
        subtitle="Liên kết máy chủ VPS vào hệ thống điều khiển bằng mã ghép nối 8 ký tự"
        actions={
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center text-xs text-muted hover:text-foreground transition-colors"
          >
            ← Quay lại danh sách máy chủ
          </Link>
        }
      />

      <div className="mx-auto max-w-lg">
        <Card className="p-5 sm:p-7 shadow-lg border-border bg-surface">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite">
              <div className="flex size-12 items-center justify-center rounded-full border border-online/35 bg-online/10 text-online">
                <svg
                  className="size-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Ghép nối máy chủ thành công
                </h2>
                {pairedDeviceId ? (
                  <p className="font-mono text-xs text-muted">
                    Mã thiết bị: <span className="text-foreground">{pairedDeviceId}</span>
                  </p>
                ) : null}
                <p className="text-xs text-muted">
                  Đang đồng bộ dữ liệu và chuyển hướng…
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Context instructions */}
              <div className="space-y-1.5 text-center">
                <p className="text-xs text-muted">
                  Nhập mã ghép nối 8 ký tự được hiển thị trong nhật ký khi khởi động máy chủ:
                </p>
                <div className="inline-flex items-center gap-2 rounded-md border border-border bg-elevated/80 px-2.5 py-1 font-mono text-xs">
                  <span className="text-muted">MÃ GHÉP NỐI:</span>
                  <span className="font-semibold text-accent tracking-widest">A3F9B21C</span>
                </div>
              </div>

              {/* Segmented 8-char hex input: 4 chars + separator + 4 chars */}
              <div
                role="group"
                aria-label="Mã ghép nối thiết bị 8 ký tự"
                className="flex items-center justify-center gap-1 sm:gap-2"
                onPaste={handlePaste}
              >
                {code.map((char, i) => (
                  <div key={i} className="flex items-center">
                    <input
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      id={`pair-char-${i}`}
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={1}
                      value={char}
                      disabled={busy}
                      aria-label={`Ký tự ${i + 1} / 8`}
                      aria-invalid={error ? "true" : undefined}
                      onChange={(e) => handleChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      autoFocus={i === 0}
                      className={[
                        "h-12 w-8 sm:w-10 md:w-11 min-h-[44px] rounded-md border text-center font-mono text-base sm:text-lg font-semibold uppercase",
                        "bg-elevated text-foreground transition-colors",
                        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
                        char ? "border-border-interactive bg-elevated/90" : "border-border/60",
                        error ? "border-danger/60 text-danger" : "",
                        busy ? "opacity-50 cursor-not-allowed" : "",
                      ].join(" ")}
                    />
                    {/* Visual delimiter separating groups of 4 */}
                    {i === 3 ? (
                      <span
                        className="mx-1 sm:mx-1.5 text-xs text-muted font-mono select-none"
                        aria-hidden="true"
                      >
                        –
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Status helper & validation indicator */}
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full ${
                      isComplete
                        ? "bg-online"
                        : enteredCount > 0
                          ? "bg-warning"
                          : "bg-muted/50"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-muted">
                    {isComplete
                      ? "8/8 ký tự · Mã hợp lệ"
                      : enteredCount > 0
                        ? `${enteredCount}/8 ký tự đã nhập`
                        : "Ký tự hex (0–9, A–F)"}
                  </span>
                </div>

                {enteredCount > 0 && !busy ? (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-muted hover:text-foreground underline transition-colors cursor-pointer"
                  >
                    Xóa mã
                  </button>
                ) : null}
              </div>

              {/* Error feedback banner */}
              {error ? (
                <div
                  id="pair-error"
                  role="alert"
                  aria-live="polite"
                  className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-xs text-danger"
                >
                  <p className="font-semibold">Ghép nối thất bại</p>
                  <p className="mt-0.5 text-danger/90 leading-relaxed">{error}</p>
                </div>
              ) : null}

              {/* Action button */}
              <div className="pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full min-h-[44px]"
                  busy={busy}
                  disabled={!isComplete}
                >
                  {busy ? "Đang ghép nối…" : "Ghép nối thiết bị"}
                </Button>
              </div>

              {/* Operator Diagnostic Guidance */}
              <div className="border-t border-border pt-4 space-y-2 text-xs text-muted">
                <p className="font-medium text-foreground">Hướng dẫn tìm mã ghép nối:</p>
                <ol className="list-decimal pl-4 space-y-1 text-muted/90 leading-relaxed">
                  <li>Khởi động tiến trình Zeus Agent trên máy chủ VPS hoặc container.</li>
                  <li>Xem nhật ký console / stdout khi khởi động.</li>
                  <li>
                    Tìm dòng:{" "}
                    <span className="font-mono text-foreground bg-elevated px-1.5 py-0.5 rounded border border-border">
                      PAIR CODE: XXXXXXXX
                    </span>
                  </li>
                  <li>
                    Nhập hoặc dán mã 8 ký tự vào ô trên. Mỗi mã chỉ được ghép nối một lần.
                  </li>
                </ol>
              </div>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}


"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Toast, ToastTone } from "@/lib/types";

/**
 * Minimal toast stack. Auto-dismiss after 4s; error toasts linger longer.
 * No portal library — rendered fixed in the layout's provider tree.
 */

const DISMISS_MS: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  error: 7000,
};

interface ToastApi {
  toasts: Toast[];
  push(tone: ToastTone, title: string, description?: string): void;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      counter += 1;
      const toast: Toast = { id: `toast_${counter}`, tone, title, description };
      setToasts((current) => [...current.slice(-3), toast]);
    },
    [],
  );

  // One timer per toast keeps dismissal independent of later pushes.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismiss(toast.id), DISMISS_MS[toast.tone]),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [toasts, dismiss]);

  const value = useMemo<ToastApi>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 p-4 sm:inset-x-auto sm:right-0 sm:bottom-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto w-full sm:w-90 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm ${TONE_STYLES[toast.tone]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-xs text-muted">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded p-1 text-muted hover:text-foreground"
              aria-label="Đóng thông báo"
            >
              <IconClose />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success/40 bg-success/12 text-success",
  error: "border-danger/40 bg-danger/12 text-danger",
  info: "border-border bg-elevated text-foreground",
};

function IconClose() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

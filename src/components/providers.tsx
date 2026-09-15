"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/store/toast-store";
import { ZeusStoreProvider } from "@/store/zeus-store";

/**
 * Client provider boundary. The root layout stays a Server Component; this is
 * the only client component it renders.
 * Order matters: ZeusStore actions surface results through toasts.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ZeusStoreProvider>{children}</ZeusStoreProvider>
    </ToastProvider>
  );
}

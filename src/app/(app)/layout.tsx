import { AuthGate } from "@/components/app-shell";
import type { ReactNode } from "react";

/** Every route in this group is authenticated and gets the dashboard frame. */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import type { User } from "@/lib/types";

/**
 * Authenticated app frame.
 *
 * Desktop: fixed sidebar + scrolling main. Mobile: top bar with a drawer.
 * The same nav array drives both so they can't drift.
 *
 * `AuthGate` owns the signed-out redirect; `AppShell` below it always has a
 * user, so the render body never branches on auth.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Exact match only — avoids "/" lighting up on every route. */
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: <IconGrid />, exact: true },
  { href: "/settings", label: "Settings", icon: <IconGear /> },
];

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, user } = useZeusStore();
  const router = useRouter();
  const signedOut = ready && user === null;
  // Redirect is a side effect; doing it in render would warn and double-fire.
  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  // Explicit `user === null` keeps TS narrowing into the AppShell branch.
  if (!ready || user === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted">
          {signedOut ? "Redirecting to login…" : "Loading Zeus…"}
        </p>
      </div>
    );
  }

  return <AppShell user={user}>{children}</AppShell>;
}

function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const { devices, logout, isPending } = useZeusStore();
  const { push } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const signingOut = isPending(pendingKey.auth);

  async function handleLogout() {
    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      push("error", "Sign out failed", describeError(error));
    }
  }

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
          onNavigate={() => setDrawerOpen(false)}
        />
      ))}

      <p className="mt-5 mb-1 px-3 text-[11px] tracking-wide text-muted uppercase">
        Devices
      </p>
      {devices.map((device) => {
        const href = `/device/${device.deviceId}`;
        return (
          <NavLink
            key={device.id}
            href={href}
            label={device.name}
            mono
            active={pathname.startsWith(href)}
            onNavigate={() => setDrawerOpen(false)}
            trailing={
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  device.status === "online" ? "bg-online" : "bg-offline"
                }`}
                aria-hidden="true"
              />
            }
          />
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-border px-4 py-3">
      <p className="truncate text-xs text-muted">{user.displayName}</p>
      <button
        type="button"
        onClick={handleLogout}
        disabled={signingOut}
        className="mt-1 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto px-3 py-3">{nav}</div>
        {footer}
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-72 flex-col border-r border-border bg-surface">
            <Brand />
            <div className="flex-1 overflow-y-auto px-3 py-3">{nav}</div>
            {footer}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md border border-border p-2 text-muted"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
          >
            <IconMenu />
          </button>
          <span className="font-mono text-sm font-semibold tracking-[0.3em]">ZEUS</span>
          <span className="size-9" aria-hidden="true" />
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
  onNavigate,
  mono = false,
  trailing,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onNavigate(): void;
  mono?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-100 ${
        active
          ? "bg-elevated text-foreground"
          : "text-muted hover:bg-elevated/60 hover:text-foreground"
      } ${mono ? "font-mono text-xs" : ""}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-4">
      <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
      <span className="font-mono text-sm font-semibold tracking-[0.3em]">ZEUS</span>
    </div>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

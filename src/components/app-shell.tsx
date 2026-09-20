"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";
import type { DeviceStatus, User } from "@/lib/types";

/**
 * Authenticated app frame — Storm Steel Operational Shell.
 *
 * Desktop: fixed sidebar (256px) + scrollable main content.
 * Mobile: top header with accessible drawer (touch targets >= 44px).
 * Unifies navigation across desktop and mobile, with instant device status indicators.
 */

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Exact match only — avoids "/" lighting up on every route. */
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Tổng quan", icon: <IconGrid />, exact: true },
  { href: "/pair", label: "Ghép nối máy chủ", icon: <IconPlug /> },
  { href: "/settings", label: "Cài đặt", icon: <IconGear /> },
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
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex items-center gap-2.5 text-xs text-muted">
          <span className="size-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
          <span>{signedOut ? "Đang chuyển hướng đến trang đăng nhập…" : "Đang kết nối đến Zeus…"}</span>
        </div>
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
      push("error", "Đăng xuất thất bại", describeError(error));
    }
  }

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Điều hướng chính">
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

      <div className="mt-5 mb-1.5 flex items-center justify-between px-3">
        <p className="text-[10px] font-semibold tracking-wider text-muted uppercase">
          Máy chủ ({devices.length})
        </p>
      </div>

      <div className="space-y-0.5">
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
              trailing={<SidebarDeviceDot status={device.status} />}
            />
          );
        })}
      </div>
    </nav>
  );

  const footer = (
    <div className="shrink-0 border-t border-border bg-surface/90 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{user.displayName || user.username}</p>
        {user.email ? (
          <p className="truncate text-[11px] text-muted">{user.email}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={signingOut}
        className="mt-1.5 inline-flex text-xs text-muted transition-colors hover:text-danger disabled:opacity-50"
      >
        {signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop Persistent Sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto px-3 py-3">{nav}</div>
        {footer}
      </aside>

      {/* Mobile Navigation Drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Đóng lớp phủ menu"
            className="absolute inset-0 bg-background/80 backdrop-blur-xs transition-opacity"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-72 max-w-[80vw] flex-col border-r border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pr-2">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex size-11 items-center justify-center rounded-md text-muted hover:text-foreground"
                aria-label="Đóng bảng điều hướng"
              >
                <IconClose />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">{nav}</div>
            {footer}
          </div>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-col">
        {/* Mobile Top Header with 44px touch targets */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-2 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex size-11 items-center justify-center rounded-md border border-border bg-elevated/50 text-foreground transition-colors hover:bg-elevated"
            aria-label="Mở menu điều hướng"
            aria-expanded={drawerOpen}
          >
            <IconMenu />
          </button>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold tracking-[0.25em]">ZEUS</span>
          </div>
          <div className="size-11" aria-hidden="true" />
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
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
      className={`group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-100 ${
        active
          ? "border-l-2 border-accent bg-elevated/80 pl-[10px] font-medium text-foreground"
          : "text-muted hover:bg-elevated/40 hover:text-foreground"
      } ${mono ? "font-mono text-xs" : ""}`}
    >
      {icon ? <span className="shrink-0 text-muted group-hover:text-foreground">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function SidebarDeviceDot({ status }: { status: DeviceStatus }) {
  if (status === "online") {
    return <span className="size-1.5 shrink-0 rounded-full bg-online" aria-label="Trực tuyến" />;
  }
  if (status === "error") {
    return (
      <span
        className="size-1.5 shrink-0 rotate-45 rounded-[1px] bg-danger"
        aria-label="Lỗi"
      />
    );
  }
  return (
    <span
      className="size-1.5 shrink-0 rounded-full border border-offline bg-transparent"
      aria-label="Mất kết nối"
    />
  );
}

function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-4">
      <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
      <span className="font-mono text-sm font-semibold tracking-[0.25em] text-foreground">ZEUS</span>
      <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-muted uppercase">
        HSO
      </span>
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
    <svg viewBox="0 0 16 16" className="size-5" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconPlug() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M6 1v3M10 1v3M4 4h8l-1 5H5L4 4zM6 9v2a2 2 0 0 0 4 0V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
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
  { href: "/pair", label: "Ghép nối thiết bị", icon: <IconPlug /> },
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

  const isCollapsed = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("zeus:sidebar", onStoreChange);
      window.addEventListener("storage", onStoreChange);
      return () => {
        window.removeEventListener("zeus:sidebar", onStoreChange);
        window.removeEventListener("storage", onStoreChange);
      };
    },
    () => {
      try {
        return localStorage.getItem("zeus_sidebar_collapsed") === "true";
      } catch {
        return false;
      }
    },
    () => false,
  );

  const toggleCollapsed = () => {
    try {
      const current = localStorage.getItem("zeus_sidebar_collapsed") === "true";
      localStorage.setItem("zeus_sidebar_collapsed", String(!current));
      window.dispatchEvent(new Event("zeus:sidebar"));
    } catch {}
  };

  async function handleLogout() {
    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      push("error", "Đăng xuất thất bại", describeError(error));
    }
  }

  const renderNav = (collapsed: boolean, onNav?: () => void) => (
    <nav className="flex flex-col gap-1" aria-label="Điều hướng chính">
      {NAV.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          icon={item.icon}
          active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
          onNavigate={() => {
            onNav?.();
          }}
          collapsed={collapsed}
        />
      ))}

      {collapsed ? (
        <div className="my-3 border-t border-border/60 mx-1" aria-hidden="true" />
      ) : (
        <div className="mt-5 mb-1.5 flex items-center justify-between px-3">
          <p className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            Máy chủ ({devices.length})
          </p>
        </div>
      )}

      <div className="space-y-0.5">
        {devices.map((device) => {
          const href = `/device/${device.deviceId}`;
          const active = pathname.startsWith(href);
          if (collapsed) {
            return (
              <Link
                key={device.id}
                href={href}
                title={`${device.name} (${device.status === "online" ? "Trực tuyến" : device.status === "error" ? "Lỗi" : "Mất kết nối"})`}
                aria-label={device.name}
                onClick={() => onNav?.()}
                className={`flex size-9 items-center justify-center mx-auto rounded-md transition-colors ${
                  active ? "bg-elevated border border-accent/40" : "hover:bg-elevated/50"
                }`}
              >
                <SidebarDeviceDot status={device.status} />
              </Link>
            );
          }
          return (
            <NavLink
              key={device.id}
              href={href}
              label={device.name}
              mono
              active={active}
              onNavigate={() => onNav?.()}
              trailing={<SidebarDeviceDot status={device.status} />}
            />
          );
        })}
      </div>
    </nav>
  );

  const renderFooter = (collapsed: boolean) => {
    const userInitial = (user.email || user.displayName || user.username || "U")[0].toUpperCase();
    const displayIdentifier = user.email || user.displayName || user.username;

    return (
      <div className={`shrink-0 border-t border-border bg-surface/95 ${collapsed ? "p-2" : "px-3 py-2.5"}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-elevated font-mono text-xs font-semibold text-foreground shadow-xs"
              title={displayIdentifier}
              aria-label={displayIdentifier}
            >
              {userInitial}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              title={signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
              aria-label="Đăng xuất"
              className="flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            >
              <IconLogout />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-elevated font-mono text-xs font-semibold text-foreground shadow-xs"
                aria-hidden="true"
              >
                {userInitial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground" title={displayIdentifier}>
                  {displayIdentifier}
                </p>
                <p className="truncate text-[10px] text-muted">
                  Người vận hành
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              title={signingOut ? "Đang đăng xuất…" : "Đăng xuất"}
              aria-label="Đăng xuất"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
            >
              <IconLogout />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`min-h-dvh bg-background lg:grid ${
        isCollapsed ? "lg:grid-cols-[4.5rem_1fr]" : "lg:grid-cols-[16rem_1fr]"
      } transition-[grid-template-columns] duration-200 ease-in-out`}
    >
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface lg:flex transition-[width] duration-200 ease-in-out ${
          isCollapsed ? "w-[4.5rem]" : "w-64"
        }`}
      >
        <Brand collapsed={isCollapsed} onToggle={toggleCollapsed} />
        <div className={`flex-1 overflow-y-auto ${isCollapsed ? "px-1.5 py-3" : "px-3 py-3"}`}>
          {renderNav(isCollapsed)}
        </div>
        {renderFooter(isCollapsed)}
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
              <Brand collapsed={false} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex size-11 items-center justify-center rounded-md text-muted hover:text-foreground"
                aria-label="Đóng bảng điều hướng"
              >
                <IconClose />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">{renderNav(false, () => setDrawerOpen(false))}</div>
            {renderFooter(false)}
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
          <div className="flex items-center justify-center gap-1.5">
            <IconLightning className="size-4 text-amber-400 zeus-lightning-icon" />
            <span className="font-mono text-base font-black tracking-[0.25em] pl-[0.25em] zeus-logo-glow">
              ZEUS
            </span>
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
  collapsed = false,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onNavigate(): void;
  mono?: boolean;
  trailing?: React.ReactNode;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center rounded-md transition-colors duration-100 ${
        collapsed
          ? "justify-center p-2.5"
          : "gap-2.5 px-3 py-2 text-sm"
      } ${
        active
          ? collapsed
            ? "border border-accent/40 bg-elevated/90 text-accent"
            : "border-l-2 border-accent bg-elevated/80 pl-[10px] font-medium text-foreground"
          : "text-muted hover:bg-elevated/40 hover:text-foreground"
      } ${mono && !collapsed ? "font-mono text-xs" : ""}`}
    >
      {icon ? (
        <span className={`shrink-0 ${active ? "text-accent" : "text-muted group-hover:text-foreground"}`}>
          {icon}
        </span>
      ) : null}
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {!collapsed ? trailing : null}
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

function Brand({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="relative flex shrink-0 items-center justify-center border-b border-border bg-elevated/15 px-3 py-3.5 min-h-[4.25rem]">
      {collapsed ? (
        <div className="flex flex-col items-center justify-center" title="Hệ thống điều khiển ZEUS">
          <div className="flex size-9 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 shadow-xs">
            <IconLightning className="size-5 text-amber-400 zeus-lightning-icon" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center w-full px-2 text-center">
          <div className="flex items-center justify-center gap-1.5">
            <IconLightning className="size-5 text-amber-400 shrink-0 zeus-lightning-icon" />
            <span className="font-mono text-xl font-black tracking-[0.3em] pl-[0.3em] uppercase select-none zeus-logo-glow">
              ZEUS
            </span>
          </div>
          <span className="mt-0.5 font-mono text-[9px] font-semibold tracking-widest text-muted/60 uppercase">
            Bảng điều khiển
          </span>
        </div>
      )}

      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
          aria-label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
          className={`absolute flex size-6 items-center justify-center rounded-md border border-border/80 bg-surface text-muted transition-colors hover:border-accent/50 hover:bg-elevated hover:text-foreground ${
            collapsed
              ? "-right-3 top-1/2 -translate-y-1/2 z-20 shadow-md"
              : "right-2 top-1/2 -translate-y-1/2"
          }`}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
      ) : null}
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

function IconLightning({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M9.2 1L3 8.5h4.5L6.5 15 13 7.5H8.5L9.2 1z" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <path d="M6 2.5H3.5A1.5 1.5 0 0 0 2 4v8a1.5 1.5 0 0 0 1.5 1.5H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 11.5L14 8l-3.5-3.5M13.5 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

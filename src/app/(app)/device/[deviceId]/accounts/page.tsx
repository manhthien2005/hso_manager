"use client";

import { use, useState } from "react";
import { AccountCard } from "@/components/accounts/account-card";
import { CreateAccountForm } from "@/components/accounts/create-account-form";
import { NotFoundPanel } from "@/components/not-found-panel";
import { PageHeader } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { ACCOUNT_STATUS_LABELS, DeviceStatusBadge } from "@/components/ui/status";
import { useZeusStore } from "@/store/zeus-store";
import type { AccountStatus } from "@/lib/types";

/**
 * Account management for one VPS: status filter + the full account list.
 * The filter is local UI state; nothing is refetched when it changes.
 */

/** Chip order. Only statuses actually present on this VPS get a chip. */
const STATUS_ORDER: AccountStatus[] = [
  "running",
  "starting",
  "restarting",
  "stopped",
  "error",
  "offline",
];

export default function DeviceAccountsPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = use(params);
  const { devices, accountsOf } = useZeusStore();
  const [filter, setFilter] = useState<AccountStatus | "all">("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const device = devices.find((item) => item.deviceId === deviceId);
  if (device === undefined) {
    return (
      <NotFoundPanel
        title="Không tìm thấy máy chủ"
        hint="Không có máy chủ VPS nào với mã thiết bị này trong hệ thống của bạn."
        identifier={deviceId}
      />
    );
  }

  const accounts = accountsOf(device.deviceId);

  // Chips come from the statuses that exist here, so the per-status counts
  // always add up to "All" and no status is unfilterable.
  const counts = new Map<AccountStatus, number>();
  for (const account of accounts) {
    counts.set(account.status, (counts.get(account.status) ?? 0) + 1);
  }
  const chips = [
    { id: "all" as const, label: "Tất cả", count: accounts.length },
    ...STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
      id: status,
      label: ACCOUNT_STATUS_LABELS[status] ?? status,
      count: counts.get(status) ?? 0,
    })),
  ];

  // A live status change can empty the selected chip; fall back to "all".
  const activeFilter = chips.some((chip) => chip.id === filter) ? filter : "all";
  const visible =
    activeFilter === "all"
      ? accounts
      : accounts.filter((account) => account.status === activeFilter);

  return (
    <>
      <PageHeader
        icon={<IconUsers />}
        back={{ href: `/device/${device.deviceId}`, label: device.name }}
        title="Quản lý tài khoản"
        subtitle={
          <span className="flex items-center gap-2">
            <span className="font-mono text-foreground font-semibold">{device.name}</span>
            <DeviceStatusBadge status={device.status} />
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => setIsCreateOpen((open) => !open)}
            >
              {isCreateOpen ? "Hủy" : "Thêm tài khoản"}
            </Button>
            <ButtonLink
              href={`/device/${device.deviceId}/viewer`}
              size="sm"
              variant="primary"
              disabled={device.status !== "online"}
            >
              Mở điều khiển từ xa
            </ButtonLink>
          </div>
        }
      />

      {isCreateOpen ? (
        <div className="mb-6">
          <CreateAccountForm
            device={device}
            onClose={() => {
              setIsCreateOpen(false);
              setIsSubmitting(false);
            }}
            onSubmittingChange={setIsSubmitting}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chips.map((option) => {
          const isActive = activeFilter === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={isActive}
              className={`inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent ${
                isActive
                  ? "border-accent bg-accent/15 text-accent shadow-xs"
                  : "border-border bg-elevated/60 text-muted hover:border-border hover:bg-elevated hover:text-foreground"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] tabular ${
                  isActive ? "bg-accent/20 text-accent" : "bg-surface text-muted"
                }`}
              >
                {option.count}
              </span>
            </button>
          );
        })}
      </div>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có tài khoản nào"
            hint="Thêm tài khoản game để quản lý trên máy chủ này."
            action={
              !isCreateOpen ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsCreateOpen(true)}
                >
                  Thêm tài khoản
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              disabledReason={
                device.status === "online" ? undefined : "Máy chủ mất kết nối — không thể gửi lệnh"
              }
            />
          ))}
        </div>
      )}
    </>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
      <path d="M6 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13.5v-1a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 2.5a2 2 0 0 1 0 3.5M14 13.5v-1a2.8 2.8 0 0 0-2-2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

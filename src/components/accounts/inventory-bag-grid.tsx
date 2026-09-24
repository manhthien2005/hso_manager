"use client";

import { useMemo, useState } from "react";
import type { InventoryCatalogPayload, InventoryItemCatalog } from "@/lib/inventory";
import type { AccountStatus } from "@/lib/types";

interface InventoryBagGridProps {
  inventory: InventoryCatalogPayload | null;
  isAvailable: boolean;
  accountStatus: AccountStatus;
  selectedSlots: Set<number>;
  staleSlots?: Set<number>;
  onSelectItem: (item: InventoryItemCatalog) => void;
}

export function InventoryBagGrid({
  inventory,
  isAvailable,
  accountStatus,
  selectedSlots,
  staleSlots = new Set(),
  onSelectItem,
}: InventoryBagGridProps) {
  const [hoveredItem, setHoveredItem] = useState<InventoryItemCatalog | null>(null);

  const capacity = inventory?.bag_capacity ?? 42;
  const items = inventory?.items ?? [];

  // Map items by slot for rapid cell lookup
  const itemsBySlot = useMemo(() => {
    const map = new Map<number, InventoryItemCatalog>();
    for (const item of items) {
      map.set(item.slot, item);
    }
    return map;
  }, [items]);

  // Determine total display slots (up to capacity, capped at 126)
  const totalSlots = Math.min(Math.max(capacity, items.length), 126);
  const slotsArray = useMemo(() => Array.from({ length: totalSlots }, (_, i) => i), [totalSlots]);

  if (!isAvailable) {
    return (
      <div
        id="inventory-unavailable-gate"
        className="rounded-lg border border-border/60 bg-surface/50 p-6 text-center"
      >
        <div className="mx-auto mb-2.5 flex size-10 items-center justify-center rounded-full bg-elevated text-muted">
          <IconBackpack className="size-5" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">
          {accountStatus !== "running"
            ? "Tài khoản chưa chạy"
            : "Chưa có dữ liệu túi đồ từ runtime"}
        </h4>
        <p className="mt-1 text-xs text-muted max-w-md mx-auto">
          {accountStatus !== "running"
            ? "Túi đồ chỉ khả dụng khi tài khoản đang ở trạng thái Hoạt động (running). Khởi động tài khoản để đọc danh sách vật phẩm thời gian thực."
            : "Runtime chưa gửi dữ liệu túi đồ (snapshot.inventory v=1). Kiểm tra phiên bản runtime tương thích."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bag Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">Túi đồ nhân vật</span>
          <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-muted">
            {items.length} / {capacity} ô
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm border border-accent bg-accent/20" />
            Trang bị cường hóa
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm border border-border bg-elevated/40" />
            Vật phẩm khác
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm border border-dashed border-border/60 bg-surface/30" />
            Ô trống
          </span>
        </div>
      </div>

      {/* 7-Column Bag Grid (Native Compact Layout) */}
      <div
        id="bag-grid-container"
        className="grid grid-cols-7 gap-1.5 rounded-lg border border-border/80 bg-background/60 p-2 sm:gap-2 sm:p-3"
      >
        {slotsArray.map((slotIndex) => {
          const item = itemsBySlot.get(slotIndex);
          const isOccupied = Boolean(item);
          const isSelected = selectedSlots.has(slotIndex);
          const isStale = staleSlots.has(slotIndex);
          const isCandidate = item?.candidate_for_enhancement ?? false;

          if (!isOccupied || !item) {
            return (
              <div
                key={`empty-${slotIndex}`}
                id={`bag-cell-empty-${slotIndex}`}
                className="group relative flex aspect-square flex-col items-center justify-center rounded-md border border-dashed border-border/40 bg-surface/20 text-muted/30 transition-colors select-none"
              >
                <span className="text-[10px] font-mono group-hover:text-muted/60">
                  {slotIndex + 1}
                </span>
              </div>
            );
          }

          return (
            <div
              key={`item-${slotIndex}-${item.template_id}`}
              id={`bag-cell-${slotIndex}`}
              role="button"
              tabIndex={isCandidate ? 0 : -1}
              aria-label={`${item.display_name}${isCandidate ? " (Nhấn để thêm vào hàng đợi)" : ""}`}
              onClick={() => {
                if (isCandidate) {
                  onSelectItem(item);
                }
              }}
              onMouseEnter={() => setHoveredItem(item)}
              onMouseLeave={() => setHoveredItem(null)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && isCandidate) {
                  e.preventDefault();
                  onSelectItem(item);
                }
              }}
              className={`group relative flex aspect-square flex-col justify-between rounded-md border p-1 text-left transition-all select-none ${
                isSelected
                  ? "border-accent bg-accent/15 ring-2 ring-accent/60 shadow-sm"
                  : isStale
                    ? "border-warning bg-warning/10 ring-1 ring-warning"
                    : isCandidate
                      ? "border-accent/40 bg-elevated/80 hover:border-accent hover:bg-elevated cursor-pointer hover:shadow-xs"
                      : "border-border/60 bg-surface/60 opacity-70 cursor-not-allowed"
              }`}
            >
              {/* Top Row: Tier badge or slot number */}
              <div className="flex items-center justify-between gap-0.5 text-[9px] font-mono">
                <span className="text-muted/70">{slotIndex + 1}</span>
                {item.level > 0 ? (
                  <span className="rounded bg-accent/20 px-1 font-semibold text-accent">
                    +{item.level}
                  </span>
                ) : null}
              </div>

              {/* Center: Item Name / Visual Fallback */}
              <div className="my-auto truncate text-center">
                <p className="truncate text-[11px] font-medium leading-tight text-foreground group-hover:text-accent">
                  {item.display_name}
                </p>
                {item.tier > 0 ? (
                  <span className="text-[9px] text-muted">Tier {item.tier}</span>
                ) : null}
              </div>

              {/* Bottom Row: Count / Bind / Durability flags */}
              <div className="flex items-center justify-between text-[9px]">
                {item.bind ? (
                  <span className="text-warning text-[9px]" title="Đã khóa">
                    🔒
                  </span>
                ) : (
                  <span />
                )}
                {item.count > 1 ? (
                  <span className="rounded bg-surface px-1 font-mono font-semibold text-foreground/90">
                    x{item.count}
                  </span>
                ) : item.durability !== null ? (
                  <span className="font-mono text-[8px] text-muted">
                    {item.durability}
                  </span>
                ) : null}
              </div>

              {/* Selection Checkmark Badge */}
              {isSelected ? (
                <div className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] text-accent-contrast shadow-xs">
                  ✓
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Hover Item Detail Preview */}
      {hoveredItem ? (
        <div className="rounded-md border border-border/80 bg-elevated/70 p-2 text-xs flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {hoveredItem.display_name}
            </span>
            {hoveredItem.level > 0 ? (
              <span className="rounded bg-accent/15 px-1.5 py-0.2 font-mono text-[10px] font-medium text-accent">
                Cấp +{hoveredItem.level}
              </span>
            ) : null}
            {hoveredItem.tier > 0 ? (
              <span className="rounded bg-surface px-1.5 py-0.2 text-[10px] text-muted">
                Phẩm cấp {hoveredItem.tier}
              </span>
            ) : null}
            {hoveredItem.bind ? (
              <span className="text-warning text-[11px]">Đã khóa</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-muted text-[11px]">
            {hoveredItem.durability !== null ? (
              <span>Độ bền: {hoveredItem.durability}</span>
            ) : null}
            {hoveredItem.count > 1 ? (
              <span>Số lượng: {hoveredItem.count}</span>
            ) : null}
            <span className="font-mono">Ô {hoveredItem.slot + 1}</span>
            {hoveredItem.candidate_for_enhancement ? (
              <span className="text-accent font-medium">Có thể cường hóa</span>
            ) : (
              <span className="text-muted/70">Không hỗ trợ cường hóa</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconBackpack({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7a2 2 0 012-2h8a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 5V3a2 2 0 012-2v0a2 2 0 012 2v2M7 11h6M7 14h6"
      />
    </svg>
  );
}

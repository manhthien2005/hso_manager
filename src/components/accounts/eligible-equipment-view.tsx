"use client";

import { useMemo, useState } from "react";
import type { InventoryCatalogPayload, InventoryItemCatalog, InventoryFreshnessInfo } from "@/lib/inventory";
import type { AccountStatus } from "@/lib/types";
import { InventoryBagGrid } from "./inventory-bag-grid";
import { cleanItemName, getItemLevelColor, getTierInfo } from "@/lib/item-visuals";

interface EligibleEquipmentViewProps {
  inventory: InventoryCatalogPayload | null;
  isAvailable: boolean;
  accountStatus: AccountStatus;
  queuedSlots: Set<number>;
  onAddToQueue: (item: InventoryItemCatalog) => void;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  freshness: InventoryFreshnessInfo;
  refreshError: string | null;
}

export function EligibleEquipmentView({
  inventory,
  isAvailable,
  accountStatus,
  queuedSlots,
  onAddToQueue,
  onRefresh,
  isRefreshing,
  freshness,
  refreshError,
}: EligibleEquipmentViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("ALL");
  const [showFullBag, setShowFullBag] = useState(false);

  // Extract only enhancement-eligible equipment using existing contract
  const allEligibleItems = useMemo(() => {
    if (!inventory?.items) return [];
    return inventory.items.filter((item) => item.candidate_for_enhancement);
  }, [inventory]);

  // Extract unique levels for filter dropdown
  const availableLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const item of allEligibleItems) {
      levels.add(item.level);
    }
    return Array.from(levels).sort((a, b) => a - b);
  }, [allEligibleItems]);

  // Filtered equipment list based on search and level
  const displayedItems = useMemo(() => {
    let items = allEligibleItems;

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (it) =>
          it.display_name.toLowerCase().includes(q) ||
          it.base_name.toLowerCase().includes(q),
      );
    }

    if (levelFilter !== "ALL") {
      const lvl = Number(levelFilter);
      items = items.filter((it) => it.level === lvl);
    }

    return items;
  }, [allEligibleItems, searchQuery, levelFilter]);

  if (!isAvailable) {
    return (
      <div
        id="inventory-unavailable-gate"
        className="rounded-lg border border-border/70 bg-surface/40 p-6 text-center"
      >
        <div className="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-full bg-elevated text-muted">
          <IconBackpack className="size-4" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">
          {accountStatus !== "running"
            ? "Tài khoản chưa chạy"
            : "Chưa có dữ liệu túi đồ"}
        </h4>
        <p className="mt-1 text-xs text-muted max-w-sm mx-auto">
          {accountStatus !== "running"
            ? "Túi đồ chỉ khả dụng khi tài khoản đang ở trạng thái Hoạt động (running)."
            : "Chờ runtime gửi bản tin snapshot túi đồ đầu tiên để hiển thị trang bị."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface shadow-xs overflow-hidden">
      {/* 1. Header with Freshness Indicator and Refresh Action */}
      <div className="border-b border-border/70 bg-elevated/30 px-3.5 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Trang bị có thể cường hóa
            </h3>
            <span
              id="eligible-equipment-count-badge"
              className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent"
            >
              {allEligibleItems.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Freshness Badge */}
            <span
              id="inventory-freshness-badge"
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                freshness.isStale
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              }`}
              title={
                freshness.ageSeconds != null
                  ? `Độ trễ snapshot: ${freshness.ageSeconds} giây (Lấy từ snapshot runtime)`
                  : "Dữ liệu từ snapshot runtime gần nhất"
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  freshness.isStale ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
                }`}
              />
              <span>{freshness.text}</span>
            </span>

            {/* Manual Refresh Button */}
            <button
              type="button"
              id="refresh-inventory-btn"
              onClick={() => void onRefresh()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-elevated disabled:opacity-50 transition-colors"
              title="Làm mới túi đồ từ snapshot runtime gần nhất"
            >
              <IconRefresh className={`size-3.5 ${isRefreshing ? "animate-spin text-accent" : ""}`} />
              <span>{isRefreshing ? "Đang tải..." : "Làm mới túi đồ"}</span>
            </button>
          </div>
        </div>

        {/* Small Refresh Error Notice (preserving current list) */}
        {refreshError ? (
          <div
            id="refresh-inventory-error"
            className="mt-2 rounded border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] text-warning flex items-center justify-between"
          >
            <span>{refreshError}</span>
          </div>
        ) : null}
      </div>

      {/* 2. Compact Search & Filter Toolbar */}
      <div className="border-b border-border/60 bg-surface/50 p-2.5 sm:px-4 flex flex-wrap items-center gap-2">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[160px]">
          <input
            type="text"
            id="equipment-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên trang bị..."
            className="w-full rounded-md border border-border bg-elevated/60 px-2.5 py-1 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-hidden"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* Level Filter Dropdown */}
        {availableLevels.length > 1 ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-muted">Cấp:</span>
            <select
              id="equipment-level-filter"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="rounded-md border border-border bg-elevated px-2 py-1 text-xs font-medium text-foreground focus:border-accent focus:outline-hidden"
            >
              <option value="ALL">Tất cả ({allEligibleItems.length})</option>
              {availableLevels.map((lvl) => (
                <option key={lvl} value={lvl}>
                  +{lvl} ({allEligibleItems.filter((i) => i.level === lvl).length})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* 3. Primary Equipment Cards (Compact Grid) */}
      <div className="p-3 sm:p-4">
        {displayedItems.length === 0 ? (
          <div
            id="no-eligible-equipment-message"
            className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted"
          >
            {allEligibleItems.length === 0 ? (
              <p>Túi đồ hiện không có trang bị nào đủ điều kiện cường hóa.</p>
            ) : (
              <p>Không tìm thấy trang bị phù hợp với điều kiện tìm kiếm.</p>
            )}
          </div>
        ) : (
          <div
            id="eligible-equipment-grid"
            className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5"
          >
            {displayedItems.map((item) => {
              const isQueued = queuedSlots.has(item.slot);

              return (
                <div
                  key={`eligible-${item.slot}-${item.template_id}`}
                  id={`equipment-card-${item.slot}`}
                  className={`group relative flex flex-col justify-between rounded-lg border p-2.5 transition-all ${
                    isQueued
                      ? "border-accent/40 bg-accent/5 ring-1 ring-accent/30"
                      : "border-border/80 bg-elevated/40 hover:border-accent/60 hover:bg-elevated/80 shadow-2xs"
                  }`}
                >
                  {/* Top: Name & Current +Level */}
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className="font-medium text-xs text-foreground truncate"
                          title={item.display_name}
                        >
                          {cleanItemName(item.base_name || item.display_name)}
                        </span>
                        {item.bind ? (
                          <span className="shrink-0 text-amber-400 text-[11px]" title="Đã khóa">
                            🔒
                          </span>
                        ) : null}
                      </div>
                      <span className={`shrink-0 rounded px-1.5 py-0.2 font-mono text-[11px] font-bold ${getItemLevelColor(item.level).badge}`}>
                        +{item.level}
                      </span>
                    </div>

                    {/* Metadata chips: Tier color tag, Durability */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                      {item.tier > 0 && getTierInfo(item.tier) ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.2 text-[9px] font-medium ${getTierInfo(item.tier)!.colorClass}`}
                          title={`Phẩm cấp: ${getTierInfo(item.tier)!.label}`}
                        >
                          <span className={`size-1.5 rounded-full ${getTierInfo(item.tier)!.dotClass}`} />
                          <span>{getTierInfo(item.tier)!.label}</span>
                        </span>
                      ) : null}
                      {item.durability !== null ? (
                        <span className="font-mono">Bền: {item.durability}</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Bottom: Add to Queue Button */}
                  <div className="mt-2.5 pt-2 border-t border-border/40">
                    {isQueued ? (
                      <button
                        type="button"
                        disabled
                        className="w-full rounded border border-accent/30 bg-accent/10 py-1 text-center font-mono text-sm font-bold text-accent opacity-80 cursor-default"
                        title="Đã có trong hàng đợi"
                      >
                        ✓
                      </button>
                    ) : (
                      <button
                        type="button"
                        id={`add-to-queue-btn-${item.slot}`}
                        onClick={() => onAddToQueue(item)}
                        className="w-full rounded border border-border bg-surface py-1 text-center font-mono text-sm font-bold text-foreground hover:border-accent hover:bg-accent hover:text-accent-contrast transition-colors"
                        title="Thêm vào hàng đợi"
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Secondary Collapsible Full Inventory Bag */}
      <div className="border-t border-border/60 bg-elevated/20 p-3 sm:px-4">
        <button
          type="button"
          id="toggle-full-inventory-btn"
          onClick={() => setShowFullBag(!showFullBag)}
          className="flex w-full items-center justify-between text-xs font-medium text-muted hover:text-foreground transition-colors"
        >
          <span>
            {showFullBag ? "▲ Thu gọn túi đồ" : "▼ Xem toàn bộ túi đồ"} ({inventory?.items?.length ?? 0} / {inventory?.bag_capacity ?? 42} ô)
          </span>
          <span className="text-[11px] text-muted">
            {showFullBag ? "Đang mở toàn bộ túi" : "Nhấp để xem đầy đủ túi đồ"}
          </span>
        </button>

        {showFullBag ? (
          <div id="full-inventory-drawer" className="mt-3 pt-3 border-t border-border/50">
            <InventoryBagGrid
              inventory={inventory}
              isAvailable={isAvailable}
              accountStatus={accountStatus}
              selectedSlots={queuedSlots}
              onSelectItem={(item) => {
                if (item.candidate_for_enhancement && !queuedSlots.has(item.slot)) {
                  onAddToQueue(item);
                }
              }}
            />
          </div>
        ) : null}
      </div>
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

function IconRefresh({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 8a5.5 5.5 0 11-1.61-3.89L14 6m0-4v4h-4" />
    </svg>
  );
}

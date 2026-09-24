/**
 * Inventory Catalog and Enhancement Queue Domain Models & Helpers
 * Task: ENHANCE-02-INVENTORY-WEB
 *
 * Implements locked contract for snapshot.inventory.version=1:
 * - Compact zero-based slot indexing (native bag model)
 * - Safe fail-closed parsing and validation
 * - Selected item reference capturing locator + fingerprint core + expected level
 * - Strict stale selection validation (no automatic slot scanning/remapping)
 */

import type {
  AccountStatus,
  PlayerSnapshot,
  InventoryItemCatalog,
  InventoryCatalogPayload,
} from "./types";

export type { InventoryItemCatalog, InventoryCatalogPayload };

export interface SelectedItemReference {
  captured_slot: number;
  template_id: number;
  category: number;
  base_name: string;
  tier: number;
  icon: number | null;
  expected_level: number;
  captured_display_name: string;
}

export type SelectionStatus = "VALID" | "STALE_SELECTION";

export interface EnhancementQueueEntry {
  id: string;
  reference: SelectedItemReference;
  target_level: number;
  status: SelectionStatus;
}

/**
 * Parses and validates an inventory payload defensively.
 * Fails closed (returns null) on version mismatch or invalid schema.
 */
export function parseInventoryPayload(raw: unknown): InventoryCatalogPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const data = raw as Record<string, unknown>;

  // Locked contract: version must equal 1
  if (data.version !== 1) {
    return null;
  }

  const bagCapacity = typeof data.bag_capacity === "number" && data.bag_capacity >= 0
    ? data.bag_capacity
    : 42; // Fallback default capacity if missing/invalid but version=1

  if (!Array.isArray(data.items)) {
    return null;
  }

  const validItems: InventoryItemCatalog[] = [];

  for (const item of data.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const it = item as Record<string, unknown>;

    // Validate required fields
    if (
      typeof it.slot !== "number" ||
      typeof it.template_id !== "number" ||
      typeof it.category !== "number" ||
      typeof it.base_name !== "string" ||
      typeof it.display_name !== "string" ||
      typeof it.level !== "number" ||
      typeof it.tier !== "number" ||
      typeof it.count !== "number" ||
      typeof it.candidate_for_enhancement !== "boolean"
    ) {
      continue;
    }

    const durability = typeof it.durability === "number" ? it.durability : null;
    const bind = typeof it.bind === "number" ? it.bind : null;
    const icon = typeof it.icon === "number" ? it.icon : null;

    validItems.push({
      slot: it.slot,
      template_id: it.template_id,
      category: it.category,
      base_name: it.base_name,
      display_name: it.display_name,
      level: it.level,
      tier: it.tier,
      count: it.count,
      durability,
      bind,
      icon,
      candidate_for_enhancement: it.candidate_for_enhancement,
    });
  }

  // Ensure ascending slot order (native compact bag order)
  validItems.sort((a, b) => a.slot - b.slot);

  return {
    version: 1,
    bag_capacity: bagCapacity,
    items: validItems,
  };
}

/**
 * Inventory availability gate:
 * - Account process_state must be 'running'
 * - snapshot.inventory must exist and version must equal 1
 */
export function isInventoryAvailable(
  status?: AccountStatus | string | null,
  snapshot?: PlayerSnapshot | null,
): boolean {
  if (status !== "running") {
    return false;
  }

  if (!snapshot || !snapshot.inventory) {
    return false;
  }

  return snapshot.inventory.version === 1;
}

/**
 * Creates a stable locator + fingerprint reference for a selected item.
 * NOTE: captured_slot is a locator at selection time, not an immutable ID.
 */
export function createSelectedItemReference(item: InventoryItemCatalog): SelectedItemReference {
  return {
    captured_slot: item.slot,
    template_id: item.template_id,
    category: item.category,
    base_name: item.base_name,
    tier: item.tier,
    icon: item.icon,
    expected_level: item.level,
    captured_display_name: item.display_name,
  };
}

/**
 * Validates a selected item entry against the live inventory.
 * Policy:
 * - Check item currently at entry.captured_slot.
 * - If current item matches fingerprint core and expected_level: VALID.
 * - If slot is empty or does not match: STALE_SELECTION.
 * - Web MUST NOT scan and silently adopt another slot.
 */
export function validateSelectedEntry(
  entry: SelectedItemReference,
  currentInventory: InventoryCatalogPayload | null,
): SelectionStatus {
  if (!currentInventory || currentInventory.version !== 1) {
    return "STALE_SELECTION";
  }

  const liveItem = currentInventory.items.find((it) => it.slot === entry.captured_slot);
  if (!liveItem) {
    return "STALE_SELECTION";
  }

  // Fingerprint core equality
  const fingerprintMatches =
    liveItem.template_id === entry.template_id &&
    liveItem.category === entry.category &&
    liveItem.base_name === entry.base_name &&
    liveItem.tier === entry.tier &&
    liveItem.icon === entry.icon;

  if (!fingerprintMatches) {
    return "STALE_SELECTION";
  }

  // Mutable execution level match
  if (liveItem.level !== entry.expected_level) {
    return "STALE_SELECTION";
  }

  return "VALID";
}

/**
 * Add an item to the enhancement queue draft.
 * Only candidate_for_enhancement equipment can be queued.
 */
export function addQueueEntry(
  queue: EnhancementQueueEntry[],
  item: InventoryItemCatalog,
): EnhancementQueueEntry[] {
  if (!item.candidate_for_enhancement) {
    return queue;
  }

  // Prevent queuing the exact same slot multiple times in current queue
  if (queue.some((e) => e.reference.captured_slot === item.slot)) {
    return queue;
  }

  const id = `eq-${item.slot}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const defaultTargetLevel = Math.min(item.level + 1, 15);

  const newEntry: EnhancementQueueEntry = {
    id,
    reference: createSelectedItemReference(item),
    target_level: defaultTargetLevel,
    status: "VALID",
  };

  return [...queue, newEntry];
}

/**
 * Remove an entry from the queue draft by ID.
 */
export function removeQueueEntry(
  queue: EnhancementQueueEntry[],
  id: string,
): EnhancementQueueEntry[] {
  return queue.filter((e) => e.id !== id);
}

/**
 * Reorder an entry in the queue draft.
 */
export function reorderQueueEntry(
  queue: EnhancementQueueEntry[],
  fromIndex: number,
  toIndex: number,
): EnhancementQueueEntry[] {
  if (
    fromIndex < 0 ||
    fromIndex >= queue.length ||
    toIndex < 0 ||
    toIndex >= queue.length ||
    fromIndex === toIndex
  ) {
    return queue;
  }

  const next = [...queue];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Update target enhancement level for a queue entry.
 * Clamped to [current_level + 1 .. 15].
 */
export function updateQueueEntryTargetLevel(
  queue: EnhancementQueueEntry[],
  id: string,
  targetLevel: number,
): EnhancementQueueEntry[] {
  return queue.map((entry) => {
    if (entry.id !== id) return entry;
    const minLevel = entry.reference.expected_level + 1;
    const maxLevel = 15;
    const clamped = Math.max(minLevel, Math.min(targetLevel, maxLevel));
    return {
      ...entry,
      target_level: clamped,
    };
  });
}

/**
 * Validates all entries in the queue against the current live inventory snapshot.
 */
export function validateQueue(
  queue: EnhancementQueueEntry[],
  currentInventory: InventoryCatalogPayload | null,
): EnhancementQueueEntry[] {
  return queue.map((entry) => ({
    ...entry,
    status: validateSelectedEntry(entry.reference, currentInventory),
  }));
}

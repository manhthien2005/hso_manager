/**
 * Enhancement Queue Domain Utilities, Error Codes & Validation
 * Task: ENHANCE-05D-WEB-QUEUE-DISPATCH
 *
 * Implements:
 * - Central error codes matching specification
 * - Fail-closed wire identity validation (live (template_id, category) uniqueness == 1)
 * - Safe snapshot locator fingerprinting (captured_slot is locator only, no silent remapping)
 * - Strict draft validation before durable persistence
 * - Ownership & schema field enforcement
 */

import type {
  EnhancementCharmMode,
  EnhancementPaymentType,
} from "./types";
import type {
  EnhancementQueueEntry,
  InventoryCatalogPayload,
  SelectedItemReference,
} from "./inventory";

export const QUEUE_ERROR_CODES = {
  QUEUE_RUNTIME_UNSUPPORTED: "QUEUE_RUNTIME_UNSUPPORTED",
  QUEUE_RUNTIME_STALE: "QUEUE_RUNTIME_STALE",
  QUEUE_ALREADY_ACTIVE: "QUEUE_ALREADY_ACTIVE",
  QUEUE_EMPTY: "QUEUE_EMPTY",
  QUEUE_ITEM_INVALID: "QUEUE_ITEM_INVALID",
  ITEM_MISSING_OR_CHANGED: "ITEM_MISSING_OR_CHANGED",
  AMBIGUOUS_WIRE_TARGET: "AMBIGUOUS_WIRE_TARGET",
  QUEUE_PUBLISH_FAILED: "QUEUE_PUBLISH_FAILED",
  QUEUE_DRAFT_WRITE_FAILED: "QUEUE_DRAFT_WRITE_FAILED",
  QUEUE_NOT_OWNED: "QUEUE_NOT_OWNED",
  QUEUE_STATE_CONFLICT: "QUEUE_STATE_CONFLICT",
} as const;

export type QueueErrorCode = typeof QUEUE_ERROR_CODES[keyof typeof QUEUE_ERROR_CODES];

export class QueueError extends Error {
  readonly code: QueueErrorCode;

  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.name = "QueueError";
    this.code = code;
  }
}

export interface WireIdentityValidationResult {
  valid: boolean;
  code?: QueueErrorCode;
  message?: string;
}

/**
 * Builds a frequency map of (template_id, category) from live inventory items.
 * Used to enforce wire safety: count must equal 1 for any queued candidate.
 */
export function buildLiveInventoryTargetMap(
  inventory: InventoryCatalogPayload | null | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!inventory || !Array.isArray(inventory.items)) {
    return map;
  }
  for (const item of inventory.items) {
    const key = `${item.template_id}:${item.category}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/**
 * Validates candidate wire identity against the live inventory snapshot.
 *
 * Policy:
 * 1. Count live items matching (template_id, category).
 * 2. If count > 1 -> AMBIGUOUS_WIRE_TARGET (unsafe duplicate wire identities).
 * 3. If count == 0 -> ITEM_MISSING_OR_CHANGED.
 * 4. Verify item currently at captured_slot matches exact fingerprint and expected level.
 * 5. captured_slot is ONLY a snapshot locator. NEVER silently remap to another slot!
 */
export function validateWireIdentity(
  reference: SelectedItemReference,
  inventory: InventoryCatalogPayload | null | undefined,
  targetCountMap?: Map<string, number>,
): WireIdentityValidationResult {
  if (!inventory || inventory.version !== 1 || !Array.isArray(inventory.items)) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED,
      message: "Túi đồ không khả dụng hoặc phiên bản snapshot không hợp lệ.",
    };
  }

  const map = targetCountMap ?? buildLiveInventoryTargetMap(inventory);
  const wireKey = `${reference.template_id}:${reference.category}`;
  const count = map.get(wireKey) ?? 0;

  if (count === 0) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED,
      message: `Vật phẩm "${reference.captured_display_name}" không còn tồn tại trong túi đồ.`,
    };
  }

  if (count > 1) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.AMBIGUOUS_WIRE_TARGET,
      message: `Vật phẩm "${reference.captured_display_name}" có ${count} bản sao cùng loại (template_id=${reference.template_id}, category=${reference.category}) trong túi đồ. Wire target không thể phân biệt an toàn.`,
    };
  }

  // Fingerprint verification at captured_slot locator
  const itemAtSlot = inventory.items.find((it) => it.slot === reference.captured_slot);
  if (!itemAtSlot) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED,
      message: `Ô ${reference.captured_slot + 1} hiện trống. Không tự động ánh xạ lại ô khác.`,
    };
  }

  const matchesFingerprint =
    itemAtSlot.template_id === reference.template_id &&
    itemAtSlot.category === reference.category &&
    itemAtSlot.base_name === reference.base_name &&
    itemAtSlot.tier === reference.tier &&
    itemAtSlot.icon === reference.icon;

  if (!matchesFingerprint) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED,
      message: `Vật phẩm tại ô ${reference.captured_slot + 1} không khớp thông số ban đầu.`,
    };
  }

  if (itemAtSlot.level !== reference.expected_level) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED,
      message: `Cấp độ vật phẩm tại ô ${reference.captured_slot + 1} đã thay đổi (+${itemAtSlot.level} thay vì +${reference.expected_level}).`,
    };
  }

  return { valid: true };
}

/**
 * Validates an entire enhancement queue draft before creation.
 * Checks emptiness, level bounds, target > initial, unique order/slot, and wire identity.
 */
export function validateQueueDraft(
  queue: EnhancementQueueEntry[],
  inventory?: InventoryCatalogPayload | null,
): { valid: boolean; code?: QueueErrorCode; message?: string } {
  if (!Array.isArray(queue) || queue.length === 0) {
    return {
      valid: false,
      code: QUEUE_ERROR_CODES.QUEUE_EMPTY,
      message: "Hàng đợi cường hóa trống. Vui lòng thêm ít nhất 1 trang bị.",
    };
  }

  const seenIds = new Set<string>();
  const seenSlots = new Set<number>();
  const targetMap = inventory ? buildLiveInventoryTargetMap(inventory) : undefined;

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (!entry || !entry.reference) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Mục thứ ${i + 1} trong hàng đợi không hợp lệ.`,
      };
    }

    if (seenIds.has(entry.id)) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Trùng lặp ID mục trong hàng đợi: ${entry.id}`,
      };
    }
    seenIds.add(entry.id);

    if (seenSlots.has(entry.reference.captured_slot)) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Trùng lặp ô ${entry.reference.captured_slot + 1} trong hàng đợi.`,
      };
    }
    seenSlots.add(entry.reference.captured_slot);

    // Initial level: 0..14
    const initialLevel = entry.reference.expected_level;
    if (typeof initialLevel !== "number" || initialLevel < 0 || initialLevel > 14) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Cấp độ ban đầu (+${initialLevel}) phải từ 0 đến 14.`,
      };
    }

    // Target level: 1..15, and target_level > initial_level
    const targetLevel = entry.target_level;
    if (typeof targetLevel !== "number" || targetLevel < 1 || targetLevel > 15) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Cấp độ mục tiêu (+${targetLevel}) phải từ 1 đến 15.`,
      };
    }
    if (targetLevel <= initialLevel) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Cấp độ mục tiêu (+${targetLevel}) phải lớn hơn cấp độ ban đầu (+${initialLevel}).`,
      };
    }

    // Payment type check
    const paymentType = entry.payment_type ?? "GOLD";
    if (paymentType !== "GOLD" && paymentType !== "GEMS") {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Loại tiền thanh toán "${paymentType}" không hợp lệ (chỉ GOLD hoặc GEMS).`,
      };
    }

    // Charm mode check
    const charmMode = entry.charm_mode ?? "NONE";
    const validCharms = ["NONE", "CO_3_LA", "CO_4_LA", "AUTO_POLICY", "THREE_LEAF", "FOUR_LEAF"];
    if (!validCharms.includes(charmMode)) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Chế độ bùa "${charmMode}" không hợp lệ.`,
      };
    }

    // Base name not empty
    if (!entry.reference.base_name || entry.reference.base_name.trim().length === 0) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Tên trang bị tại vị trí ${i + 1} không được để trống.`,
      };
    }

    // Category non-negative
    if (typeof entry.reference.category !== "number" || entry.reference.category < 0) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Category trang bị tại vị trí ${i + 1} không hợp lệ.`,
      };
    }

    // Tier non-negative
    if (typeof entry.reference.tier !== "number" || entry.reference.tier < 0) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Tier trang bị tại vị trí ${i + 1} không hợp lệ.`,
      };
    }

    // Captured slot non-negative
    if (typeof entry.reference.captured_slot !== "number" || entry.reference.captured_slot < 0) {
      return {
        valid: false,
        code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
        message: `Ô vị trí trang bị tại vị trí ${i + 1} không hợp lệ.`,
      };
    }

    // If live inventory is provided, perform live wire identity check
    if (inventory) {
      const wireCheck = validateWireIdentity(entry.reference, inventory, targetMap);
      if (!wireCheck.valid) {
        return {
          valid: false,
          code: wireCheck.code,
          message: wireCheck.message,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Payload item for creating queue items from client to server boundary.
 */
export interface QueueItemSubmissionPayload {
  queueOrder: number;
  capturedSlot: number;
  templateId: number;
  category: number;
  baseName: string;
  tier: number;
  icon: number | null;
  initialLevel: number;
  targetLevel: number;
  paymentType: EnhancementPaymentType;
  charmMode: EnhancementCharmMode;
}

/**
 * Converts local EnhancementQueueEntry list into ordered submission payload items.
 */
export function draftToSubmissionPayload(
  queue: EnhancementQueueEntry[],
): QueueItemSubmissionPayload[] {
  return queue.map((entry, index) => ({
    queueOrder: index + 1,
    capturedSlot: entry.reference.captured_slot,
    templateId: entry.reference.template_id,
    category: entry.reference.category,
    baseName: entry.reference.base_name,
    tier: entry.reference.tier,
    icon: entry.reference.icon,
    initialLevel: entry.reference.expected_level,
    targetLevel: entry.target_level,
    paymentType: entry.payment_type ?? "GOLD",
    charmMode: entry.charm_mode ?? "NONE",
  }));
}

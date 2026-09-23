/**
 * Canonical Material Drop Catalog — Storm Steel / Zeus Client.
 *
 * Grounded in:
 * - Runtime contract: control.rs:58-69 (MATERIAL_SLOTS = 6, MATERIAL_LABELS)
 * - Zeus wire contract: item.drops (6-character binary string, 1=Đóng rớt, 0=Mở rớt)
 * - Server confirmation dialog order:
 *     Index 0: Mề đay trắng
 *     Index 1: Mề đay vàng
 *     Index 2: Mề đay tím
 *     Index 3: Mề đay xanh
 *     Index 4: Nguyên liệu tinh tú
 *     Index 5: Lửa tinh tú
 */

export interface MaterialDropSlot {
  readonly index: number;
  readonly label: string;
}

export const MATERIAL_DROP_SLOTS: readonly MaterialDropSlot[] = [
  { index: 0, label: "Mề đay trắng" },
  { index: 1, label: "Mề đay vàng" },
  { index: 2, label: "Mề đay tím" },
  { index: 3, label: "Mề đay xanh" },
  { index: 4, label: "Nguyên liệu tinh tú" },
  { index: 5, label: "Lửa tinh tú" },
] as const;

export const MATERIAL_DROP_LABELS: readonly string[] = MATERIAL_DROP_SLOTS.map((s) => s.label);
export const MATERIAL_DROP_COUNT = 6;
export const DEFAULT_MATERIAL_DROPS = "000000";

export const BIT_SEMANTICS = {
  CHECKED_VALUE: "1",
  UNCHECKED_VALUE: "0",
  CHECKED_LABEL: "Đóng rớt",
  UNCHECKED_LABEL: "Mở rớt",
  CHECKED_MEANING: "Đóng rớt / không cho rơi",
  UNCHECKED_MEANING: "Mở rớt / cho phép rơi",
} as const;

/**
 * Checks if a specific material drop slot is closed ('1').
 */
export function isMaterialDropClosed(currentDrops: string | undefined | null, index: number): boolean {
  if (typeof currentDrops !== "string" || index < 0 || index >= currentDrops.length) {
    return false;
  }
  return currentDrops.charAt(index) === "1";
}

/**
 * Toggles or sets a specific bit at `index` in the 6-character binary string.
 * Preserves all other 5 positions byte-for-byte.
 */
export function setMaterialDropBit(
  currentDrops: string | undefined | null,
  index: number,
  closed: boolean
): string {
  const base = typeof currentDrops === "string" && /^[01]{6}$/.test(currentDrops)
    ? currentDrops
    : DEFAULT_MATERIAL_DROPS;
  if (index < 0 || index >= MATERIAL_DROP_COUNT) {
    return base;
  }
  const chars = base.split("");
  chars[index] = closed ? "1" : "0";
  return chars.join("");
}

/**
 * Parses the 6-character binary string into an array of 6 boolean values.
 * true = Đóng rớt ('1'), false = Mở rớt ('0').
 */
export function parseMaterialDropBits(drops: string | undefined | null): boolean[] {
  const raw = typeof drops === "string" && /^[01]{6}$/.test(drops)
    ? drops
    : DEFAULT_MATERIAL_DROPS;
  return raw.split("").map((c) => c === "1");
}

/**
 * Formats an array of 6 booleans back into an exact 6-character binary string.
 */
export function formatMaterialDropBits(bits: boolean[]): string {
  if (!bits || bits.length !== MATERIAL_DROP_COUNT) {
    return DEFAULT_MATERIAL_DROPS;
  }
  return bits.map((b) => (b ? "1" : "0")).join("");
}

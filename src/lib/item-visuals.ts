/**
 * Visual formatting utilities for equipment catalog items, tiers, and levels.
 */

/**
 * Removes duplicate [Khoá] or [Khóa] tags from item names so the lock emoji
 * is the sole indicator of bound equipment.
 */
export function cleanItemName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*\[kh[oóòỏõọôốồổỗộ][aáàảãạ]\]/gi, "").trim();
}

/**
 * Color-codes equipment levels according to HSO enhancement tiering:
 * - +0 to +3: Trắng (white / slate-100)
 * - +4 to +6: Vàng (amber / yellow)
 * - +7 to +9: Tím (purple / violet)
 * - +10 to +15: Cam (orange)
 */
export function getItemLevelColor(level: number): {
  text: string;
  bg: string;
  border: string;
  badge: string;
} {
  const lvl = Math.max(0, Math.floor(level || 0));

  if (lvl <= 3) {
    return {
      text: "text-slate-100",
      bg: "bg-slate-100/10",
      border: "border-slate-100/20",
      badge: "bg-slate-100/10 text-slate-100 border border-slate-100/20",
    };
  }

  if (lvl <= 6) {
    return {
      text: "text-amber-300",
      bg: "bg-amber-400/15",
      border: "border-amber-400/30",
      badge: "bg-amber-400/15 text-amber-300 border border-amber-400/30",
    };
  }

  if (lvl <= 9) {
    return {
      text: "text-purple-300",
      bg: "bg-purple-500/15",
      border: "border-purple-500/30",
      badge: "bg-purple-500/15 text-purple-300 border border-purple-500/30",
    };
  }

  return {
    text: "text-orange-400",
    bg: "bg-orange-500/15",
    border: "border-orange-500/30",
    badge: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  };
}

export interface TierInfo {
  label: "Xanh" | "Tím" | "Cam";
  colorClass: string;
  dotClass: string;
}

/**
 * Returns color tag information for equipment tier, removing the "Tier" label:
 * - Tier 1..2: Xanh
 * - Tier 3: Tím
 * - Tier >= 4: Cam
 */
export function getTierInfo(tier: number): TierInfo | null {
  if (tier <= 0) return null;

  if (tier === 3) {
    return {
      label: "Tím",
      colorClass: "bg-purple-500/15 border-purple-500/30 text-purple-300",
      dotClass: "bg-purple-400",
    };
  }

  if (tier >= 4) {
    return {
      label: "Cam",
      colorClass: "bg-orange-500/15 border-orange-500/30 text-orange-400",
      dotClass: "bg-orange-400",
    };
  }

  return {
    label: "Xanh",
    colorClass: "bg-sky-500/15 border-sky-500/30 text-sky-300",
    dotClass: "bg-sky-400",
  };
}

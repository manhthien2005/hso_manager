/**
 * Attack Spot Semantic Authority & Conversion Helpers.
 *
 * Wire & Runtime contract authority:
 * - Zeus.java lines 1882, 4222: attack spot is configured iff atkX >= 0 && atkY >= 0.
 * - control.rs lines 806-815: spot is Some iff pixel_x >= 0 && pixel_y >= 0. Half-spot is rejected.
 * - Wire absent spot: atk.map=0, atk.zone=-1, atk.x=-1, atk.y=-1.
 * - atk.map accepted domain: 0..255. atk.map=-1 is strictly INVALID on wire/DB/API.
 *
 * UI Presentation contract:
 * - Presentation-only sentinel: "__none__".
 * - When user selects None: write full canonical tuple (0, -1, -1, -1).
 * - Real Map 0: map=0, x>=0, y>=0 is rendered as Map 0 ("[0] ...").
 */

export interface AttackSpotTuple {
  "atk.map": number;
  "atk.zone": number;
  "atk.x": number;
  "atk.y": number;
}

/**
 * Canonical 4-tuple representing "No attack spot".
 * In the wire contract and runtime (Zeus/Rust), an absent attack spot
 * is represented as map=0, zone=-1, x=-1, y=-1.
 * Note: atk.map must NEVER be -1.
 */
export const CANONICAL_NO_SPOT_TUPLE: Readonly<AttackSpotTuple> = Object.freeze({
  "atk.map": 0,
  "atk.zone": -1,
  "atk.x": -1,
  "atk.y": -1,
});

/**
 * Presentation-only UI sentinel for the "No attack spot" dropdown option.
 * Must NEVER be persisted, parsed as a number, mapped to -1, sent over the wire,
 * or added to the game map catalog.
 */
export const ATTACK_SPOT_NONE_SENTINEL = "__none__" as const;

/**
 * Presentation label for the "No attack spot" dropdown option.
 */
export const NO_ATTACK_SPOT_LABEL = "No attack spot";

/**
 * Determines whether a real attack spot is configured.
 *
 * Runtime authority (Zeus.java line 1882/4222, control.rs line 806):
 * The attack spot exists if and only if both pixel coordinates are known (x >= 0 && y >= 0).
 * Zone is allowed to be -1 (current/any zone).
 * Map 0 is a valid game map, so `map === 0` must NEVER be used to decide spot presence.
 */
export function isAttackSpotConfigured(coords: {
  x: unknown;
  y: unknown;
}): boolean {
  if (
    coords.x === "" ||
    coords.x === null ||
    coords.x === undefined ||
    coords.y === "" ||
    coords.y === null ||
    coords.y === undefined
  ) {
    return false;
  }
  const x = typeof coords.x === "number" ? coords.x : Number(coords.x);
  const y = typeof coords.y === "number" ? coords.y : Number(coords.y);
  return (
    !Number.isNaN(x) &&
    !Number.isNaN(y) &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0
  );
}

/**
 * Helper to check if a ConfigDraft has a configured attack spot.
 */
export function isAttackSpotConfiguredInDraft(draft: {
  "atk.x"?: unknown;
  "atk.y"?: unknown;
}): boolean {
  return isAttackSpotConfigured({ x: draft["atk.x"], y: draft["atk.y"] });
}

/**
 * Checks whether a 4-tuple exactly matches the canonical no-spot tuple.
 */
export function isCanonicalNoSpotTuple(tuple: {
  "atk.map"?: unknown;
  "atk.zone"?: unknown;
  "atk.x"?: unknown;
  "atk.y"?: unknown;
}): boolean {
  return (
    Number(tuple["atk.map"]) === 0 &&
    Number(tuple["atk.zone"]) === -1 &&
    Number(tuple["atk.x"]) === -1 &&
    Number(tuple["atk.y"]) === -1
  );
}

/**
 * Resolves the presentation select value ("__none__" | string map id)
 * from the persisted or draft tuple.
 *
 * - If user explicitly selected a real map during editing (`userSelectedMap !== undefined && !== null`),
 *   return that map id as a string.
 * - Otherwise:
 *   - If a real attack spot is configured (x >= 0 && y >= 0): return String(mapId).
 *   - If mapId === 0 and spot is not configured: return ATTACK_SPOT_NONE_SENTINEL.
 *   - If mapId > 0: return String(mapId).
 */
export function getAttackMapSelectValue(
  mapId: unknown,
  coords: { x: unknown; y: unknown },
  userSelectedMap?: string | null,
): string {
  if (userSelectedMap !== undefined && userSelectedMap !== null) {
    return userSelectedMap;
  }
  if (isAttackSpotConfigured(coords)) {
    const num = typeof mapId === "number" ? mapId : Number(mapId);
    return !Number.isNaN(num) ? String(num) : "0";
  }
  const num = typeof mapId === "number" ? mapId : Number(mapId);
  if (num === 0) {
    return ATTACK_SPOT_NONE_SENTINEL;
  }
  return !Number.isNaN(num) ? String(num) : ATTACK_SPOT_NONE_SENTINEL;
}

/**
 * Produces draft updates when the user selects a value in the Attack Map dropdown.
 *
 * If the user selected ATTACK_SPOT_NONE_SENTINEL:
 * returns the full CANONICAL_NO_SPOT_TUPLE (`{ "atk.map": 0, "atk.zone": -1, "atk.x": -1, "atk.y": -1 }`).
 *
 * If the user selected a real map id (e.g. 0, 93):
 * returns `{ "atk.map": mapId }`.
 * Note: Never sets `atk.map = -1`!
 */
export function handleAttackMapSelection(selectValue: string): {
  updates: Partial<AttackSpotTuple>;
  isNone: boolean;
} {
  if (selectValue === ATTACK_SPOT_NONE_SENTINEL) {
    return {
      updates: { ...CANONICAL_NO_SPOT_TUPLE },
      isNone: true,
    };
  }
  const mapId = Number(selectValue);
  if (Number.isNaN(mapId) || !Number.isInteger(mapId) || mapId < 0 || mapId > 255) {
    // Safety fallback: canonical no-spot rather than invalid map. atk.map=-1 is NEVER produced.
    return {
      updates: { ...CANONICAL_NO_SPOT_TUPLE },
      isNone: true,
    };
  }
  return {
    updates: {
      "atk.map": mapId,
    },
    isNone: false,
  };
}

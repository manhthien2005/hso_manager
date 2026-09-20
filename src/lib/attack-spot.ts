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

export interface AttackSpotValidationResult {
  valid: boolean;
  errors: Partial<Record<"atk.map" | "atk.x" | "atk.y", string>>;
}

/**
 * Pure validation rule for saving attack spot configuration (Round 9B3 Corrective 1).
 *
 * Rules:
 * 1. Half-spot rejection: Both X and Y coordinates must be set together (both >= 0 or both < 0).
 *    Authority: Zeus.java line 633, control.rs line 814.
 * 2. Explicit real-map editing intent:
 *    - If the user explicitly selected a real map in the UI (e.g. intent is "0" or "93"),
 *      or if the draft has a non-zero attack map (atk.map > 0),
 *      then valid coordinates (x >= 0 && y >= 0) are strictly REQUIRED before Save can proceed.
 * 3. Canonical None:
 *    - If draft is canonical None (atk.map=0, atk.zone=-1, atk.x=-1, atk.y=-1) and
 *      the user did NOT explicitly select a real map (intent is null or ATTACK_SPOT_NONE_SENTINEL),
 *      it is VALID with 0 errors.
 */
export function validateAttackSpotSave(
  draft: {
    "atk.map"?: unknown;
    "atk.zone"?: unknown;
    "atk.x"?: unknown;
    "atk.y"?: unknown;
  },
  attackMapIntent?: string | null,
): AttackSpotValidationResult {
  const errors: Partial<Record<"atk.map" | "atk.x" | "atk.y", string>> = {};

  const xVal = Number(draft["atk.x"]);
  const yVal = Number(draft["atk.y"]);
  const mapVal = Number(draft["atk.map"]);

  // 1. Half-spot rejection (Zeus.java line 633, control.rs line 814)
  if (!Number.isNaN(xVal) && !Number.isNaN(yVal)) {
    if ((xVal < 0) !== (yVal < 0)) {
      if (xVal < 0) {
        errors["atk.x"] = "Cần nhập đồng thời cả tọa độ X và Y";
      }
      if (yVal < 0) {
        errors["atk.y"] = "Cần nhập đồng thời cả tọa độ X và Y";
      }
      return { valid: false, errors };
    }
  }

  // 2. Explicit real-map intent check
  // Does the user have explicit intent for a real map?
  // - attackMapIntent is a valid numeric map string (e.g. "0", "93", etc.) AND !== "__none__"
  // - OR draft["atk.map"] > 0
  const isExplicitRealMapIntent =
    attackMapIntent !== null &&
    attackMapIntent !== undefined &&
    attackMapIntent !== ATTACK_SPOT_NONE_SENTINEL &&
    !Number.isNaN(Number(attackMapIntent)) &&
    Number(attackMapIntent) >= 0 &&
    Number(attackMapIntent) <= 255;

  const requiresCoordinates = isExplicitRealMapIntent || (!Number.isNaN(mapVal) && mapVal > 0);

  if (requiresCoordinates) {
    if (Number.isNaN(xVal) || xVal < 0) {
      errors["atk.x"] = "Cần nhập tọa độ X (>= 0) khi đã chọn vị trí đánh.";
    }
    if (Number.isNaN(yVal) || yVal < 0) {
      errors["atk.y"] = "Cần nhập tọa độ Y (>= 0) khi đã chọn vị trí đánh.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Checks whether the attack spot editing state is dirty compared to persisted state,
 * taking into account transient presentation intent (e.g. selecting Real Map 0 from None).
 */
export function isAttackMapSelectionDirty(
  persistedTuple: { "atk.map"?: unknown; "atk.x"?: unknown; "atk.y"?: unknown },
  currentTuple: { "atk.map"?: unknown; "atk.x"?: unknown; "atk.y"?: unknown },
  attackMapIntent?: string | null,
): boolean {
  const persistedSelect = getAttackMapSelectValue(persistedTuple["atk.map"], {
    x: persistedTuple["atk.x"],
    y: persistedTuple["atk.y"],
  });
  const currentSelect = getAttackMapSelectValue(
    currentTuple["atk.map"],
    { x: currentTuple["atk.x"], y: currentTuple["atk.y"] },
    attackMapIntent,
  );
  return persistedSelect !== currentSelect;
}

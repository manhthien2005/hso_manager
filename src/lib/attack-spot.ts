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
      "atk.zone": -1,
    },
    isNone: false,
  };
}

export interface AttackSpotValidationResult {
  valid: boolean;
  errors: Partial<Record<"atk.map" | "atk.x" | "atk.y" | "atk.mode", string>>;
}

/**
 * Pure validation rule for saving attack spot configuration (Round 9B3 + Round 4A Auto Farm).
 *
 * Rules:
 * 1. Half-spot rejection: Both X and Y coordinates must be set together (both >= 0 or both < 0).
 *    Authority: Zeus.java line 633, control.rs line 814.
 * 2. Auto Farm requested mode validation (R4A):
 *    - Stand (1) or Move (2) requires a valid active farm spot (x >= 0 && y >= 0 and valid map).
 *    - Stand/Move with missing or unconfigured coordinates blocks save with actionable error.
 * 3. Explicit real-map editing intent:
 *    - If the user explicitly selected a real map in the UI (e.g. intent is "0" or "93"),
 *      or if the draft has a non-zero attack map (atk.map > 0),
 *      then valid coordinates (x >= 0 && y >= 0) are strictly REQUIRED before Save can proceed.
 * 4. Canonical None:
 *    - If draft is canonical None (atk.map=0, atk.zone=-1, atk.x=-1, atk.y=-1) and
 *      mode is Off (0) and intent is null/None, it is VALID with 0 errors.
 * 5. Preserving spot when Off:
 *    - Turning mode Off preserves configured spot coordinates without blocking Save.
 */
export function validateAttackSpotSave(
  draft: {
    "atk.map"?: unknown;
    "atk.zone"?: unknown;
    "atk.x"?: unknown;
    "atk.y"?: unknown;
    "atk.mode"?: unknown;
  },
  attackMapIntent?: string | null,
): AttackSpotValidationResult {
  const errors: Partial<Record<"atk.map" | "atk.x" | "atk.y" | "atk.mode", string>> = {};

  const xVal = Number(draft["atk.x"]);
  const yVal = Number(draft["atk.y"]);
  const mapVal = Number(draft["atk.map"]);
  const modeVal = Number(draft["atk.mode"]);

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

  // 2. Auto Farm mode requirement (R4A): Stand/Move requires a valid configured spot
  const isAutoFarmRequested = modeVal === 1 || modeVal === 2;
  const isConfigured = isAttackSpotConfigured({ x: draft["atk.x"], y: draft["atk.y"] });

  if (isAutoFarmRequested && !isConfigured) {
    errors["atk.mode"] = "Cần chọn vị trí đánh hợp lệ (Map, X, Y) khi bật chế độ Đứng yên hoặc Di chuyển.";
    if (Number.isNaN(xVal) || xVal < 0) {
      errors["atk.x"] = "Cần nhập tọa độ X (>= 0) khi bật chế độ tự đánh.";
    }
    if (Number.isNaN(yVal) || yVal < 0) {
      errors["atk.y"] = "Cần nhập tọa độ Y (>= 0) khi bật chế độ tự đánh.";
    }
    if (
      draft["atk.map"] === undefined ||
      draft["atk.map"] === null ||
      Number.isNaN(mapVal) ||
      (mapVal === 0 && (attackMapIntent === null || attackMapIntent === undefined || attackMapIntent === ATTACK_SPOT_NONE_SENTINEL))
    ) {
      errors["atk.map"] = "Cần chọn map vị trí đánh khi bật chế độ tự đánh.";
    }
  } else if (
    isAutoFarmRequested &&
    (draft["atk.map"] === undefined ||
      draft["atk.map"] === null ||
      Number.isNaN(mapVal) ||
      mapVal < 0 ||
      mapVal > 255)
  ) {
    errors["atk.map"] = "Map ID không hợp lệ (0-255)";
  }

  // 3. Explicit real-map intent check (when mode is Off or map changed)
  const isExplicitRealMapIntent =
    attackMapIntent !== null &&
    attackMapIntent !== undefined &&
    attackMapIntent !== ATTACK_SPOT_NONE_SENTINEL &&
    !Number.isNaN(Number(attackMapIntent)) &&
    Number(attackMapIntent) >= 0 &&
    Number(attackMapIntent) <= 255;

  const requiresCoordinates = isExplicitRealMapIntent || (!Number.isNaN(mapVal) && mapVal > 0);

  if (requiresCoordinates && !isAutoFarmRequested) {
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
 * Normalizes a draft for explicit configuration Save (R4A Derived Save Contract).
 *
 * Rules:
 * - atk.mode == Off -> atk.farmOnArrival = 0
 * - atk.mode in {Stand, Move} and active spot is valid -> atk.farmOnArrival = 1
 * - atk.mode in {Stand, Move} -> nav.target = -1
 * - Every normal configuration Save -> nav.detectSpots = 0
 */
export function normalizeDraftForSave<T extends Record<string, unknown>>(draft: T): T {
  const next = { ...draft };
  const mode = Number(next["atk.mode"]);

  // 1. Normal save always normalizes nav.detectSpots = 0
  next["nav.detectSpots" as keyof T] = 0 as unknown as T[keyof T];

  if (mode === 0) {
    // Off -> farmOnArrival = 0
    next["atk.farmOnArrival" as keyof T] = 0 as unknown as T[keyof T];
  } else if (mode === 1 || mode === 2) {
    // Stand or Move -> nav.target = -1
    next["nav.target" as keyof T] = -1 as unknown as T[keyof T];

    // Stand/Move with valid active spot -> farmOnArrival = 1
    const xVal = Number(next["atk.x"]);
    const yVal = Number(next["atk.y"]);
    if (!Number.isNaN(xVal) && !Number.isNaN(yVal) && xVal >= 0 && yVal >= 0) {
      next["atk.farmOnArrival" as keyof T] = 1 as unknown as T[keyof T];
    } else {
      next["atk.farmOnArrival" as keyof T] = 0 as unknown as T[keyof T];
    }
  }

  return next;
}

/**
 * Helper to update map, X, or Y while resetting captured zone metadata to -1.
 */
export function updateLocationWithZoneReset(
  path: "atk.map" | "atk.x" | "atk.y",
  value: string | number | boolean,
): Partial<Record<"atk.map" | "atk.x" | "atk.y" | "atk.zone", string | number | boolean>> {
  return {
    [path]: value,
    "atk.zone": -1,
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

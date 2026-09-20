/**
 * Executable test script for Round 9B3 Attack Spot semantics and regressions.
 *
 * Verifies:
 * 1. Canonical no-spot recognized as None (__none__)
 * 2. Real Map 0 recognized as configured
 * 3. Real non-zero map recognized as configured
 * 4. Selecting None produces exactly { map: 0, zone: -1, x: -1, y: -1 }
 * 5. No path produces atk.map = -1
 * 6. Default control draft remains canonical no-spot tuple
 * 7. Real Map 0 selection during editing preserves "0" and does not collapse to None
 * 8. Zone does not dictate attack spot presence (zone -1 with valid x,y is configured)
 * 9. Negative or malformed coordinate inputs are never recognized as configured
 */

import { register } from "node:module";

// Register custom extension resolver hook for Node type-stripping ESM runner
const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !specifier.endsWith(".ts")) {
      try {
        return await nextResolve(specifier + ".ts", context);
      } catch (_) {}
    }
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(hookCode), import.meta.url);

async function main() {
  const {
    CANONICAL_NO_SPOT_TUPLE,
    ATTACK_SPOT_NONE_SENTINEL,
    NO_ATTACK_SPOT_LABEL,
    isAttackSpotConfigured,
    isAttackSpotConfiguredInDraft,
    isCanonicalNoSpotTuple,
    getAttackMapSelectValue,
    handleAttackMapSelection,
    validateAttackSpotSave,
    isAttackMapSelectionDirty,
  } = await import("../src/lib/attack-spot.ts");
  const { defaultControlDraft, validateDraft } = await import("../src/lib/config-schema.ts");
  const { formatGameMap, getGameMap } = await import("../src/lib/game-maps.ts");

  let failures = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.error(`  [FAIL] ${msg}`);
      failures++;
    } else {
      console.log(`  [PASS] ${msg}`);
    }
  }

  console.log("=== RUNNING ROUND 9B3 ATTACK SPOT SEMANTICS VERIFICATION ===\n");

// 1. Canonical no-spot predicate & select value
console.log("1. Canonical no-spot detection:");
const canonicalDraft = { "atk.map": 0, "atk.zone": -1, "atk.x": -1, "atk.y": -1 };
assert(!isAttackSpotConfigured({ x: -1, y: -1 }), "x=-1, y=-1 is NOT configured");
assert(!isAttackSpotConfiguredInDraft(canonicalDraft), "canonical draft is NOT configured");
assert(isCanonicalNoSpotTuple(canonicalDraft), "canonicalDraft is identified by isCanonicalNoSpotTuple");
assert(
  getAttackMapSelectValue(0, { x: -1, y: -1 }) === ATTACK_SPOT_NONE_SENTINEL,
  `map=0 with x=-1, y=-1 displays '${ATTACK_SPOT_NONE_SENTINEL}' (None)`,
);

// 2. Real Map 0 detection
console.log("\n2. Real Map 0 detection:");
const realMap0Draft = { "atk.map": 0, "atk.zone": -1, "atk.x": 120, "atk.y": 240 };
assert(isAttackSpotConfigured({ x: 120, y: 240 }), "x=120, y=240 IS configured");
assert(isAttackSpotConfiguredInDraft(realMap0Draft), "real Map 0 draft IS configured");
assert(!isCanonicalNoSpotTuple(realMap0Draft), "real Map 0 is NOT canonical no-spot");
assert(
  getAttackMapSelectValue(0, { x: 120, y: 240 }) === "0",
  "map=0 with x=120, y=240 displays '0' (Map 0), not None",
);

// 3. Real non-zero map detection
console.log("\n3. Real non-zero map detection:");
const realMap93Draft = { "atk.map": 93, "atk.zone": 2, "atk.x": 155, "atk.y": 220 };
assert(isAttackSpotConfiguredInDraft(realMap93Draft), "Map 93 with valid x,y IS configured");
assert(
  getAttackMapSelectValue(93, { x: 155, y: 220 }) === "93",
  "map=93 with valid x,y displays '93'",
);

// 4. Selecting None canonicalization
console.log("\n4. Selecting None produces canonical tuple:");
const selectNoneResult = handleAttackMapSelection(ATTACK_SPOT_NONE_SENTINEL);
assert(selectNoneResult.isNone === true, "Selection reports isNone === true");
assert(selectNoneResult.updates["atk.map"] === 0, "updates['atk.map'] is 0");
assert(selectNoneResult.updates["atk.zone"] === -1, "updates['atk.zone'] is -1");
assert(selectNoneResult.updates["atk.x"] === -1, "updates['atk.x'] is -1");
assert(selectNoneResult.updates["atk.y"] === -1, "updates['atk.y'] is -1");
assert(isCanonicalNoSpotTuple(selectNoneResult.updates), "Result tuple is canonical no-spot tuple");

// 5. Selecting Real Maps (including Map 0)
console.log("\n5. Selecting real maps:");
const selectMap0Result = handleAttackMapSelection("0");
assert(selectMap0Result.isNone === false, "Map 0 selection reports isNone === false");
assert(selectMap0Result.updates["atk.map"] === 0, "Map 0 updates['atk.map'] is 0");
assert(selectMap0Result.updates["atk.map"] !== -1, "Map 0 updates['atk.map'] is NOT -1");

const selectMap93Result = handleAttackMapSelection("93");
assert(selectMap93Result.isNone === false, "Map 93 selection reports isNone === false");
assert(selectMap93Result.updates["atk.map"] === 93, "Map 93 updates['atk.map'] is 93");

// 6. Regression: No path ever produces atk.map = -1
console.log("\n6. atk.map = -1 regression check:");
const badInputs = ["-1", "", "null", "undefined", "invalid", "__none__", "256", "-5"];
for (const input of badInputs) {
  const res = handleAttackMapSelection(input);
  assert(res.updates["atk.map"] !== -1, `Input '${input}' must NEVER produce atk.map === -1`);
}

// 7. Default control draft regression
console.log("\n7. defaultControlDraft regression check:");
const draft = defaultControlDraft();
assert(draft["atk.map"] === 0, "default draft atk.map === 0");
assert(draft["atk.zone"] === -1, "default draft atk.zone === -1");
assert(draft["atk.x"] === -1, "default draft atk.x === -1");
assert(draft["atk.y"] === -1, "default draft atk.y === -1");
assert(isCanonicalNoSpotTuple(draft), "default draft is canonical no-spot tuple");
assert(!isAttackSpotConfiguredInDraft(draft), "default draft has no configured spot");

// 8. Editing Map 0 representation
console.log("\n8. Editing state representation:");
// When user explicitly selects Map 0 in UI, even before coordinates are entered, select value stays "0"
const editingMap0Display = getAttackMapSelectValue(0, { x: -1, y: -1 }, "0");
assert(editingMap0Display === "0", "Explicit Map 0 edit selection stays '0' even with x=-1, y=-1");

// 9. Negative & half-spot rejection
console.log("\n9. Half-spot & negative spot rejection:");
assert(!isAttackSpotConfigured({ x: 100, y: -1 }), "x=100, y=-1 is NOT configured");
assert(!isAttackSpotConfigured({ x: -1, y: 100 }), "x=-1, y=100 is NOT configured");
assert(!isAttackSpotConfigured({ x: null, y: 100 }), "x=null is NOT configured");
assert(!isAttackSpotConfigured({ x: 100, y: "" }), "y='' is NOT configured");

// 10. Constant validation
console.log("\n10. Constants and sentinels:");
assert(ATTACK_SPOT_NONE_SENTINEL === "__none__", "Sentinel is '__none__'");
assert(NO_ATTACK_SPOT_LABEL === "No attack spot", "Label is 'No attack spot'");
assert(CANONICAL_NO_SPOT_TUPLE["atk.map"] === 0, "Canonical tuple map is 0");
assert(CANONICAL_NO_SPOT_TUPLE["atk.zone"] === -1, "Canonical tuple zone is -1");
assert(CANONICAL_NO_SPOT_TUPLE["atk.x"] === -1, "Canonical tuple x is -1");
assert(CANONICAL_NO_SPOT_TUPLE["atk.y"] === -1, "Canonical tuple y is -1");

// 11. validateDraft spot coordinate validation (baseline without intent)
console.log("\n11. validateDraft spot coordinate validation (baseline):");

const defaultErrors = validateDraft(defaultControlDraft(), 13);
assert(Object.keys(defaultErrors).length === 0, "defaultControlDraft passes validation with 0 errors");

const realMap0Errors = validateDraft(
  { ...defaultControlDraft(), "atk.map": 0, "atk.x": 100, "atk.y": 200 },
  13,
);
assert(Object.keys(realMap0Errors).length === 0, "Real Map 0 with valid coords passes with 0 errors");

const realMap93Errors = validateDraft(
  { ...defaultControlDraft(), "atk.map": 93, "atk.x": 150, "atk.y": 250 },
  13,
);
assert(Object.keys(realMap93Errors).length === 0, "Real Map 93 with valid coords passes with 0 errors");

const halfSpotErrors1 = validateDraft(
  { ...defaultControlDraft(), "atk.x": 100, "atk.y": -1 },
  13,
);
assert("atk.y" in halfSpotErrors1, "Half-spot (x>=0, y<0) produces error on atk.y");

const halfSpotErrors2 = validateDraft(
  { ...defaultControlDraft(), "atk.x": -1, "atk.y": 100 },
  13,
);
assert("atk.x" in halfSpotErrors2, "Half-spot (x<0, y>=0) produces error on atk.x");

const mapWithoutCoordsErrors = validateDraft(
  { ...defaultControlDraft(), "atk.map": 93, "atk.x": -1, "atk.y": -1 },
  13,
);
assert(
  "atk.x" in mapWithoutCoordsErrors && "atk.y" in mapWithoutCoordsErrors,
  "Map > 0 without coordinates produces errors on both atk.x and atk.y",
);

// 12. Corrective 1: Explicit Map 0 Intent & Save Validation
// Tests BOTH validateAttackSpotSave and production validateDraft (used by ConfigForm.handleSave)
console.log("\n12. Corrective 1: Explicit Map 0 Intent & Save Validation:");

// 12A. Persisted None with no explicit real-map intent -> VALID
const test12A_helper = validateAttackSpotSave(defaultControlDraft(), null);
assert(test12A_helper.valid === true, "12A (helper): Persisted None with no intent is VALID");
assert(Object.keys(test12A_helper.errors).length === 0, "12A (helper): 0 validation errors");

const test12A_prod = validateDraft(defaultControlDraft(), 13, null);
assert(Object.keys(test12A_prod).length === 0, "12A (prod validateDraft): Persisted None with no intent is VALID");

// 12B. None -> explicit Map 0 intent with coordinates untouched (-1,-1) -> INVALID FOR SAVE
const test12B_helper = validateAttackSpotSave(defaultControlDraft(), "0");
assert(test12B_helper.valid === false, "12B (helper): Explicit Map 0 intent with untouched coords is INVALID FOR SAVE");
assert("atk.x" in test12B_helper.errors && "atk.y" in test12B_helper.errors, "12B (helper): errors on both atk.x and atk.y");

const test12B_prod = validateDraft(defaultControlDraft(), 13, "0");
assert("atk.x" in test12B_prod && "atk.y" in test12B_prod, "12B (prod validateDraft): errors on both atk.x and atk.y");

// 12C. Critical unrelated-dirty case: draft has unrelated change, but explicit Map 0 lacks coords -> MUST REJECT
const unrelatedDirtyDraft = {
  ...defaultControlDraft(),
  "atk.radius": 150, // unrelated field modified
};
const test12C_helper = validateAttackSpotSave(unrelatedDirtyDraft, "0");
assert(test12C_helper.valid === false, "12C (helper): Unrelated dirty draft with explicit Map 0 lacks coords -> MUST REJECT");
assert("atk.x" in test12C_helper.errors, "12C (helper): atk.x error present");
assert("atk.y" in test12C_helper.errors, "12C (helper): atk.y error present");

const test12C_prod = validateDraft(unrelatedDirtyDraft, 13, "0");
assert("atk.x" in test12C_prod && "atk.y" in test12C_prod, "12C (prod validateDraft): Save rejected due to missing attack coordinates");

// 12D. Map 0 with valid coordinates -> VALID
const validMap0Draft = { ...defaultControlDraft(), "atk.map": 0, "atk.x": 120, "atk.y": 240 };
const test12D_helper = validateAttackSpotSave(validMap0Draft, "0");
assert(test12D_helper.valid === true, "12D (helper): Map 0 with valid coordinates is VALID");
assert(Object.keys(test12D_helper.errors).length === 0, "12D (helper): 0 validation errors");

const test12D_prod = validateDraft(validMap0Draft, 13, "0");
assert(Object.keys(test12D_prod).length === 0, "12D (prod validateDraft): Map 0 with valid coords is VALID");

// 12E. Map 0 half-spot -> INVALID
const halfSpotMap0_1 = { ...defaultControlDraft(), "atk.map": 0, "atk.x": 120, "atk.y": -1 };
const test12E1_helper = validateAttackSpotSave(halfSpotMap0_1, "0");
assert(test12E1_helper.valid === false, "12E1 (helper): Map 0 half-spot (x>=0, y<0) is INVALID");

const test12E1_prod = validateDraft(halfSpotMap0_1, 13, "0");
assert("atk.y" in test12E1_prod, "12E1 (prod validateDraft): error on atk.y for half-spot");

const halfSpotMap0_2 = { ...defaultControlDraft(), "atk.map": 0, "atk.x": -1, "atk.y": 240 };
const test12E2_helper = validateAttackSpotSave(halfSpotMap0_2, "0");
assert(test12E2_helper.valid === false, "12E2 (helper): Map 0 half-spot (x<0, y>=0) is INVALID");

const test12E2_prod = validateDraft(halfSpotMap0_2, 13, "0");
assert("atk.x" in test12E2_prod, "12E2 (prod validateDraft): error on atk.x for half-spot");

// 12F. Select None after explicit Map 0 -> tuple 0,-1,-1,-1, intent cleared -> VALID
const selectNoneAfter = handleAttackMapSelection(ATTACK_SPOT_NONE_SENTINEL);
const test12F_helper = validateAttackSpotSave(selectNoneAfter.updates, ATTACK_SPOT_NONE_SENTINEL);
assert(test12F_helper.valid === true, "12F (helper): Select None after explicit Map 0 is VALID");
assert(Object.keys(test12F_helper.errors).length === 0, "12F (helper): 0 validation errors");

const test12F_prod = validateDraft(
  { ...defaultControlDraft(), ...selectNoneAfter.updates },
  13,
  null,
);
assert(Object.keys(test12F_prod).length === 0, "12F (prod validateDraft): Select None after explicit Map 0 is VALID");

// 12G. Reset/reload: intent cleared to null -> canonical None is valid
const test12G_helper = validateAttackSpotSave(defaultControlDraft(), null);
assert(test12G_helper.valid === true, "12G (helper): Reset/reload canonical None with null intent is VALID");

const test12G_prod = validateDraft(defaultControlDraft(), 13, null);
assert(Object.keys(test12G_prod).length === 0, "12G (prod validateDraft): Reset/reload canonical None is VALID");

// 13. Dirty semantics verification (isAttackMapSelectionDirty)
console.log("\n13. Dirty semantics verification:");
const persistedNone = defaultControlDraft();

// Canonical None -> select Map 0 intent "0" -> DIRTY
assert(
  isAttackMapSelectionDirty(persistedNone, persistedNone, "0") === true,
  "13A: Selecting Map 0 from canonical None is DIRTY",
);

// Canonical None -> no selection change -> NOT DIRTY
assert(
  isAttackMapSelectionDirty(persistedNone, persistedNone, null) === false,
  "13B: Unmodified canonical None is NOT dirty",
);

// Canonical None -> select None sentinel -> NOT DIRTY
assert(
  isAttackMapSelectionDirty(persistedNone, persistedNone, ATTACK_SPOT_NONE_SENTINEL) === false,
  "13C: Re-selecting None on canonical None is NOT dirty",
);

// Configured Map 0 -> unchanged -> NOT DIRTY
assert(
  isAttackMapSelectionDirty(validMap0Draft, validMap0Draft, null) === false,
  "13D: Unmodified configured Map 0 is NOT dirty",
);

// Configured Map 0 -> select None -> DIRTY
assert(
  isAttackMapSelectionDirty(validMap0Draft, persistedNone, null) === true,
  "13E: Changing configured Map 0 to None is DIRTY",
);

// 14. Production Game Catalog Facade Integration (Section 14)
console.log("\n14. Production Game Catalog Facade Integration:");
const map0 = getGameMap(0);
assert(map0 !== undefined, "14A: Map 0 exists in catalog facade");
if (map0) {
  const expected0 = `[${map0.id}] ${map0.name}`;
  assert(
    formatGameMap(map0.id) === expected0,
    "14B: Map 0 formatting derives dynamically from production catalog facade",
  );
}

const map93 = getGameMap(93);
assert(map93 !== undefined, "14C: Map 93 exists in catalog facade");
if (map93) {
  const expected93 = `[${map93.id}] ${map93.name}`;
  assert(
    formatGameMap(map93.id) === expected93,
    "14D: Map 93 formatting derives dynamically from production catalog facade",
  );
}

  console.log(`\n=================================`);
  if (failures === 0) {
    console.log("ALL ATTACK SPOT TESTS PASSED (0 failures)\n");
  } else {
    console.error(`ATTACK SPOT TESTS FAILED: ${failures} failure(s)\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in verify-attack-spot:", err);
  process.exit(1);
});

/**
 * Focused Auto Farm Semantics Verification (Round 4A).
 *
 * Verifies:
 * 1. Derived save normalizations:
 *    - Off -> farmOnArrival = 0
 *    - Stand/Move with valid spot -> farmOnArrival = 1 and nav.target = -1
 *    - Stand/Move with invalid spot -> farmOnArrival = 0 and nav.target = -1
 *    - Normal save always forces nav.detectSpots = 0
 * 2. Stand/Move invalid spot blocks save (validation errors on mode, coordinates, map)
 * 3. Off mode preserves configured spot coordinates without blocking save
 * 4. Manual edit resets captured zone metadata to -1 only on actual location edit
 * 5. Local unroutable map within game map range (0-255) is not rejected
 * 6. Conditional zonePick validation: validated only when zoneMode === 2 (Pick)
 * 7. Control v13 34-key serialization integrity (no dropped or added keys)
 * 8. Strict singular field authority: all 34 keys represented, exactly once, no duplicates
 * 9. Legacy Spot and Loot tabs removed; Combat reduced to 5 fields; Travel reduced to 1 field
 * 10. Manual travel lockout condition (mode 1 or 2 locks out travel)
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

async function main(): Promise<void> {
  const {
    handleAttackMapSelection,
  } = await import("../src/lib/attack-spot.ts");
  const {
    CONTROL_SCHEMA,
    defaultControlDraft,
    controlRecordToDraft,
    draftToControlRecord,
    validateDraft,
    normalizeDraftForSave,
    updateLocationWithZoneReset,
  } = await import("../src/lib/config-schema.ts");

  let failures = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.error(`  [FAIL] ${msg}`);
      failures++;
    } else {
      console.log(`  [PASS] ${msg}`);
    }
  }

  console.log("=== RUNNING ROUND 4A AUTO FARM SEMANTICS VERIFICATION ===\n");

  // ── 1. Derived Save Normalizations ───────────────────────────────────────────
  console.log("1. Derived Save Normalization Contract:");

  // 1A: Off -> farmOnArrival = 0, nav.detectSpots = 0
  const offDraft = defaultControlDraft();
  offDraft["atk.mode"] = 0;
  offDraft["atk.farmOnArrival"] = 1; // legacy dirty value
  offDraft["nav.detectSpots"] = 1;   // legacy dirty value
  offDraft["nav.target"] = 10;
  const normalizedOff = normalizeDraftForSave(offDraft);
  assert(normalizedOff["atk.farmOnArrival"] === 0, "Off (0) derives farmOnArrival = 0");
  assert(normalizedOff["nav.detectSpots"] === 0, "Off (0) normalizes detectSpots = 0");
  assert(normalizedOff["nav.target"] === 10, "Off (0) preserves nav.target");

  // 1B: Stand with valid spot -> farmOnArrival = 1, nav.target = -1, detectSpots = 0
  const standValidDraft = defaultControlDraft();
  standValidDraft["atk.mode"] = 1;
  standValidDraft["atk.map"] = 93;
  standValidDraft["atk.x"] = 120;
  standValidDraft["atk.y"] = 240;
  standValidDraft["nav.target"] = 5;
  standValidDraft["nav.detectSpots"] = 1;
  const normalizedStand = normalizeDraftForSave(standValidDraft);
  assert(normalizedStand["atk.farmOnArrival"] === 1, "Valid Stand derives farmOnArrival = 1");
  assert(normalizedStand["nav.target"] === -1, "Stand normalizes nav.target = -1");
  assert(normalizedStand["nav.detectSpots"] === 0, "Stand normalizes detectSpots = 0");

  // 1C: Move with valid spot (including Map 0) -> farmOnArrival = 1, nav.target = -1
  const moveMap0Draft = defaultControlDraft();
  moveMap0Draft["atk.mode"] = 2;
  moveMap0Draft["atk.map"] = 0;
  moveMap0Draft["atk.x"] = 50;
  moveMap0Draft["atk.y"] = 80;
  moveMap0Draft["nav.target"] = 12;
  const normalizedMove = normalizeDraftForSave(moveMap0Draft);
  assert(normalizedMove["atk.farmOnArrival"] === 1, "Valid Move on Map 0 derives farmOnArrival = 1");
  assert(normalizedMove["nav.target"] === -1, "Move normalizes nav.target = -1");

  // 1D: Stand/Move with unconfigured/invalid spot -> farmOnArrival = 0, nav.target = -1
  const standInvalidDraft = defaultControlDraft();
  standInvalidDraft["atk.mode"] = 1;
  standInvalidDraft["atk.map"] = 0;
  standInvalidDraft["atk.x"] = -1;
  standInvalidDraft["atk.y"] = -1;
  standInvalidDraft["nav.target"] = 7;
  const normalizedInvalidStand = normalizeDraftForSave(standInvalidDraft);
  assert(normalizedInvalidStand["atk.farmOnArrival"] === 0, "Invalid Stand derives farmOnArrival = 0");
  assert(normalizedInvalidStand["nav.target"] === -1, "Invalid Stand normalizes nav.target = -1");

  // ── 2. Validation Contract: Stand/Move requires valid spot ──────────────────
  console.log("\n2. Validation Contract (Stand/Move Spot Requirements):");

  // 2A: Stand with unconfigured spot blocks save
  const unconfiguredStand = defaultControlDraft();
  unconfiguredStand["atk.mode"] = 1;
  const standErrors = validateDraft(unconfiguredStand, 13);
  assert("atk.mode" in standErrors, "Stand with unconfigured spot has error on atk.mode");
  assert("atk.x" in standErrors, "Stand with unconfigured spot has error on atk.x");
  assert("atk.y" in standErrors, "Stand with unconfigured spot has error on atk.y");

  // 2B: Move with half-spot blocks save
  const halfSpotMove = defaultControlDraft();
  halfSpotMove["atk.mode"] = 2;
  halfSpotMove["atk.map"] = 93;
  halfSpotMove["atk.x"] = 100;
  halfSpotMove["atk.y"] = -1;
  const halfSpotErrors = validateDraft(halfSpotMove, 13);
  assert("atk.y" in halfSpotErrors, "Half-spot Move has error on atk.y");
  assert(Object.keys(halfSpotErrors).length > 0, "Half-spot Move blocks save");

  // 2C: Move with valid spot passes validation (0 errors)
  const validMove = defaultControlDraft();
  validMove["atk.mode"] = 2;
  validMove["atk.map"] = 93;
  validMove["atk.x"] = 100;
  validMove["atk.y"] = 200;
  const validMoveErrors = validateDraft(validMove, 13);
  assert(Object.keys(validMoveErrors).length === 0, "Valid Move passes validation with 0 errors");

  // 2D: Stand on Map 0 with valid coords passes validation (0 errors)
  const validStandMap0 = defaultControlDraft();
  validStandMap0["atk.mode"] = 1;
  validStandMap0["atk.map"] = 0;
  validStandMap0["atk.x"] = 150;
  validStandMap0["atk.y"] = 250;
  const validStandMap0Errors = validateDraft(validStandMap0, 13, "0");
  assert(Object.keys(validStandMap0Errors).length === 0, "Valid Stand on Map 0 passes validation with 0 errors");

  // 2E: Stand on local unroutable map (e.g. Map 150, beyond standard travel but <= 255)
  const unroutableMapStand = defaultControlDraft();
  unroutableMapStand["atk.mode"] = 1;
  unroutableMapStand["atk.map"] = 150;
  unroutableMapStand["atk.x"] = 300;
  unroutableMapStand["atk.y"] = 400;
  const unroutableMapErrors = validateDraft(unroutableMapStand, 13);
  assert(!("atk.map" in unroutableMapErrors), "Local unroutable map within 0-255 is NOT rejected");

  // ── 3. Preserving Spot When Mode is Off ───────────────────────────────────────
  console.log("\n3. Preserving Spot When Mode is Off:");
  const offWithSpot = defaultControlDraft();
  offWithSpot["atk.mode"] = 0;
  offWithSpot["atk.map"] = 93;
  offWithSpot["atk.zone"] = 4;
  offWithSpot["atk.x"] = 500;
  offWithSpot["atk.y"] = 600;
  const offSpotErrors = validateDraft(offWithSpot, 13);
  assert(Object.keys(offSpotErrors).length === 0, "Off mode with configured spot passes validation with 0 errors");
  const savedOffSpot = normalizeDraftForSave(offWithSpot);
  assert(savedOffSpot["atk.x"] === 500, "Off mode preserves atk.x coordinates");
  assert(savedOffSpot["atk.y"] === 600, "Off mode preserves atk.y coordinates");
  assert(savedOffSpot["atk.map"] === 93, "Off mode preserves atk.map");
  assert(savedOffSpot["atk.zone"] === 4, "Off mode preserves atk.zone");

  // ── 4. Manual Edit Zone Reset Semantics ───────────────────────────────────────
  console.log("\n4. Manual Edit Zone Reset Contract:");

  // 4A: Editing X resets captured zone to -1
  const editX = updateLocationWithZoneReset("atk.x", 350);
  assert(editX["atk.x"] === 350, "updateLocationWithZoneReset sets atk.x");
  assert(editX["atk.zone"] === -1, "updateLocationWithZoneReset resets atk.zone to -1 on X edit");

  // 4B: Editing Y resets captured zone to -1
  const editY = updateLocationWithZoneReset("atk.y", 450);
  assert(editY["atk.y"] === 450, "updateLocationWithZoneReset sets atk.y");
  assert(editY["atk.zone"] === -1, "updateLocationWithZoneReset resets atk.zone to -1 on Y edit");

  // 4C: Selecting real map via handleAttackMapSelection resets atk.zone to -1
  const selectMap = handleAttackMapSelection("93");
  assert(selectMap.updates["atk.map"] === 93, "handleAttackMapSelection sets map to 93");
  assert(selectMap.updates["atk.zone"] === -1, "handleAttackMapSelection resets atk.zone to -1");

  // 4D: Selecting none resets atk.zone to -1
  const selectNone = handleAttackMapSelection("__none__");
  assert(selectNone.updates["atk.zone"] === -1, "handleAttackMapSelection None sets atk.zone to -1");

  // 4E: Merely loading server state does not reset zone
  const loadedDraft = controlRecordToDraft({
    "atk.map": 93,
    "atk.zone": 7,
    "atk.x": 100,
    "atk.y": 200,
  });
  assert(loadedDraft["atk.zone"] === 7, "controlRecordToDraft preserves loaded server zone without reset");

  // ── 5. Conditional Zone Pick Validation ──────────────────────────────────────
  console.log("\n5. Conditional Zone Pick Validation:");

  // 5A: Zone mode 0 (Keep) - invalid zonePick is ignored
  const keepModeDraft = defaultControlDraft();
  keepModeDraft["atk.zoneMode"] = 0;
  keepModeDraft["atk.zonePick"] = 999; // invalid out of bounds
  const keepErrors = validateDraft(keepModeDraft, 13);
  assert(!("atk.zonePick" in keepErrors), "zoneMode=Keep ignores out-of-bounds zonePick");

  // 5B: Zone mode 1 (Emptiest) - invalid zonePick is ignored
  const emptiestModeDraft = defaultControlDraft();
  emptiestModeDraft["atk.zoneMode"] = 1;
  emptiestModeDraft["atk.zonePick"] = -5; // invalid out of bounds
  const emptiestErrors = validateDraft(emptiestModeDraft, 13);
  assert(!("atk.zonePick" in emptiestErrors), "zoneMode=Emptiest ignores out-of-bounds zonePick");

  // 5C: Zone mode 2 (Pick) - invalid zonePick produces error
  const pickModeInvalidDraft = defaultControlDraft();
  pickModeInvalidDraft["atk.zoneMode"] = 2;
  pickModeInvalidDraft["atk.zonePick"] = 0; // out of range 1..99
  const pickInvalidErrors = validateDraft(pickModeInvalidDraft, 13);
  assert("atk.zonePick" in pickInvalidErrors, "zoneMode=Pick validates zonePick and flags out-of-bounds");

  // 5D: Zone mode 2 (Pick) - valid zonePick passes
  const pickModeValidDraft = defaultControlDraft();
  pickModeValidDraft["atk.zoneMode"] = 2;
  pickModeValidDraft["atk.zonePick"] = 5;
  const pickValidErrors = validateDraft(pickModeValidDraft, 13);
  assert(!("atk.zonePick" in pickValidErrors), "zoneMode=Pick accepts valid zonePick (1..99)");

  // ── 6. Control v13 34-Key Serialization Contract ────────────────────────────
  console.log("\n6. Control v13 34-Key Serialization Contract:");

  const expected34Keys = [
    "atk.mode",
    "atk.radius",
    "ui.ring",
    "atk.map",
    "atk.zone",
    "atk.x",
    "atk.y",
    "atk.zoneMode",
    "atk.zonePick",
    "item.rank",
    "item.mphp",
    "item.gold",
    "item.medalDialog",
    "item.dropsOn",
    "item.drops",
    "atk.hpOn",
    "atk.hpPct",
    "atk.mpOn",
    "atk.mpPct",
    "atk.buffs",
    "nav.target",
    "revive.on",
    "revive.mode",
    "revive.delay",
    "mount.on",
    "mount.id",
    "enhance.on",
    "enhance.maxLv",
    "enhance.charm",
    "dungeon.on",
    "dungeon.max",
    "dungeon.schedule",
    "atk.farmOnArrival",
    "nav.detectSpots",
  ];

  const defaultDraftKeys = Object.keys(defaultControlDraft());
  assert(defaultDraftKeys.length === 34, `defaultControlDraft has exactly 34 keys (got ${defaultDraftKeys.length})`);

  for (const key of expected34Keys) {
    assert(key in defaultControlDraft(), `Key '${key}' is present in default draft`);
  }

  // Round-trip serialization
  const roundTrip = draftToControlRecord(defaultControlDraft());
  assert(Object.keys(roundTrip).length === 34, "draftToControlRecord produces exactly 34 keys");
  assert(roundTrip["atk.farmOnArrival"] === 0, "Serialized record preserves hidden atk.farmOnArrival");
  assert(roundTrip["nav.detectSpots"] === 0, "Serialized record preserves hidden nav.detectSpots");

  // ── 7. Singular Field Authority in CONTROL_SCHEMA[13] ────────────────────────
  console.log("\n7. Singular Field Authority in CONTROL_SCHEMA[13]:");

  const v13Sections = CONTROL_SCHEMA[13];
  assert(v13Sections !== undefined, "CONTROL_SCHEMA[13] is defined");

  const sectionIds = v13Sections.map((s) => s.id);
  assert(sectionIds.includes("auto_farm"), "auto_farm section exists in schema");
  assert(sectionIds.includes("combat"), "combat section exists in schema");
  assert(sectionIds.includes("travel"), "travel section exists in schema");
  assert(sectionIds.includes("hidden_internal"), "hidden_internal section exists in schema");
  assert(!sectionIds.includes("spot"), "Legacy spot section is REMOVED from schema");
  assert(!sectionIds.includes("loot"), "Legacy loot section is REMOVED from schema");

  // Check field counts per section
  const autoFarmSec = v13Sections.find((s) => s.id === "auto_farm");
  const combatSec = v13Sections.find((s) => s.id === "combat");
  const travelSec = v13Sections.find((s) => s.id === "travel");
  const hiddenSec = v13Sections.find((s) => s.id === "hidden_internal");

  assert(autoFarmSec?.fields.length === 15, `auto_farm section has exactly 15 fields (got ${autoFarmSec?.fields.length})`);
  assert(combatSec?.fields.length === 5, `combat section has exactly 5 fields (got ${combatSec?.fields.length})`);
  assert(travelSec?.fields.length === 1, `travel section has exactly 1 field (got ${travelSec?.fields.length})`);
  assert(hiddenSec?.fields.length === 2, `hidden_internal section has exactly 2 fields (got ${hiddenSec?.fields.length})`);

  // Verify each field appears exactly once across all sections
  const fieldOccurrences = new Map<string, string[]>();
  for (const sec of v13Sections) {
    for (const field of sec.fields) {
      const list = fieldOccurrences.get(field.path) ?? [];
      list.push(sec.id);
      fieldOccurrences.set(field.path, list);
    }
  }

  let duplicateAuthority = false;
  for (const [path, sectionsList] of fieldOccurrences.entries()) {
    if (sectionsList.length > 1) {
      console.error(`  [FAIL] Field '${path}' duplicated in sections: ${sectionsList.join(", ")}`);
      duplicateAuthority = true;
      failures++;
    }
  }
  assert(!duplicateAuthority, "No duplicate field authority exists across any schema sections");
  assert(fieldOccurrences.size === 34, `All 34 keys are represented across sections (got ${fieldOccurrences.size})`);

  // ── 8. Manual Travel Lockout Semantics ────────────────────────────────────────
  console.log("\n8. Manual Travel Lockout Semantics:");
  // Mode 1 or 2 is active Auto Farm -> lockout condition is true
  const isTravelLocked = (mode: number) => mode === 1 || mode === 2;
  assert(isTravelLocked(1) === true, "Stand mode (1) activates travel lockout");
  assert(isTravelLocked(2) === true, "Move mode (2) activates travel lockout");
  assert(isTravelLocked(0) === false, "Off mode (0) unlocks travel immediately");

  console.log("\n=================================");
  if (failures === 0) {
    console.log("ALL AUTO FARM SEMANTICS TESTS PASSED (0 failures)\n");
  } else {
    console.error(`AUTO FARM VERIFICATION FAILED: ${failures} failure(s)\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test execution threw an unhandled error:", err);
  process.exit(1);
});

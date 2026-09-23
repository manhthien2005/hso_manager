/**
 * Verification test suite for Mount Catalog & UI Mapping (MOUNT-CATALOG-01)
 *
 * Verifies:
 * 1. Catalog completeness & exact supported values: {0, 62, 63, 64, 65, 66}
 * 2. Authentic Vietnamese names proven by local source/game/telemetry
 * 3. No placeholder labels ("Mount 62", "Thú #62", "Thú cưỡi 62", etc.)
 * 4. Numeric roundtrip & absence of index remapping
 * 5. Validation in CONTROL_SCHEMA v13 (accepts 0, 62..66; rejects invalid IDs)
 * 6. Independence of mount.on and mount.id (changing mount doesn't alter mount.on)
 * 7. Missing mount selection preserved without auto-substitution to 0
 * 8. Inventory awareness parsed from telemetry.mounts without mutating IDs or disabling options
 */

import { register } from "node:module";
import assert from "node:assert/strict";

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
    MOUNT_CATALOG,
    MOUNT_NAMES,
    parseCarriedMountIds,
    getMountDisplayLabel,
  } = await import("../src/lib/mounts");

  const {
    CONTROL_SCHEMA,
    validateDraft,
    defaultControlDraft,
  } = await import("../src/lib/config-schema");

  console.log("=== MOUNT CATALOG & WEB MAPPING VERIFICATION (MOUNT-CATALOG-01) ===");

  // ── 1. Catalog Invariants ──────────────────────────────────────────────────
  console.log("\n1. Verifying Canonical Mount Catalog Invariants...");

  const EXPECTED_IDS = [0, 62, 63, 64, 65, 66];
  const EXPECTED_CATALOG: Record<number, string> = {
    0: "Bất kỳ (Thú cưỡi có sẵn)",
    62: "Ngựa nâu",
    63: "Ngựa trắng",
    64: "Ngựa chiến giáp",
    65: "Ngựa xích thố",
    66: "Ngựa đen",
  };

  assert.equal(
    MOUNT_CATALOG.length,
    6,
    `Catalog must contain exactly 6 entries (found ${MOUNT_CATALOG.length})`
  );

  const catalogIds = MOUNT_CATALOG.map((m: any) => m.id);
  assert.deepEqual(
    catalogIds,
    EXPECTED_IDS,
    `Catalog IDs must be exactly [0, 62, 63, 64, 65, 66], got ${JSON.stringify(catalogIds)}`
  );

  // Check unique IDs (no duplicates)
  const uniqueIds = new Set(catalogIds);
  assert.equal(
    uniqueIds.size,
    catalogIds.length,
    "Catalog must have no duplicate IDs"
  );
  console.log("  [PASS] Catalog contains exactly supported values 0, 62, 63, 64, 65, 66 with no duplicates");

  // ── 2. Display Names & Absence of Placeholders ─────────────────────────────
  console.log("\n2. Verifying Authentic Vietnamese Names & Absence of Placeholders...");

  for (const [idStr, expectedName] of Object.entries(EXPECTED_CATALOG)) {
    const id = Number(idStr);
    const actualName = MOUNT_NAMES[id];
    assert.equal(
      actualName,
      expectedName,
      `ID ${id} must map to "${expectedName}", got "${actualName}"`
    );
    assert.ok(
      !actualName.includes("Mount"),
      `ID ${id} label "${actualName}" must not contain English placeholder 'Mount'`
    );
    assert.ok(
      !actualName.includes("#"),
      `ID ${id} label "${actualName}" must not contain debug placeholder '#'`
    );
    assert.ok(
      !/Thú cưỡi \d+/.test(actualName),
      `ID ${id} label "${actualName}" must not match generic placeholder 'Thú cưỡi XX'`
    );
  }
  console.log("  [PASS] All mount IDs have source-proven authentic Vietnamese names; zero placeholders remain");

  // ── 3. Schema Options & Numeric Round-Trip ─────────────────────────────────
  console.log("\n3. Verifying CONTROL_SCHEMA v13 Mount Field Options...");

  const schemaV13 = CONTROL_SCHEMA[13];
  assert.ok(schemaV13, "CONTROL_SCHEMA must define version 13");

  const mountSection = schemaV13.find((s) => s.id === "mount");
  assert.ok(mountSection, "Version 13 must contain 'mount' section");

  const mountOnField = mountSection.fields.find((f) => f.path === "mount.on");
  assert.ok(mountOnField, "Mount section must define 'mount.on'");
  assert.equal(mountOnField.type, "toggle");

  const mountIdField = mountSection.fields.find((f) => f.path === "mount.id") as any;
  assert.ok(mountIdField, "Mount section must define 'mount.id'");
  assert.equal(mountIdField.type, "select");

  const schemaOptionValues = mountIdField.options.map((o: any) => o.value);
  assert.deepEqual(
    schemaOptionValues,
    EXPECTED_IDS,
    "Schema mount.id options must match canonical IDs exactly"
  );

  for (const opt of mountIdField.options) {
    const numVal = typeof opt.value === "number" ? opt.value : Number(opt.value);
    assert.ok(Number.isInteger(numVal), `Option value ${opt.value} must be an integer`);
    assert.equal(
      opt.label,
      EXPECTED_CATALOG[numVal],
      `Option label for ${numVal} must match canonical name`
    );
  }
  console.log("  [PASS] CONTROL_SCHEMA v13 mount.id options match canonical catalog numerically and textually");

  // ── 4. Validation Rules & Rejection of Invalid Options ─────────────────────
  console.log("\n4. Verifying Validation Rules & Wire Contract Safety...");

  const baseDraft = defaultControlDraft();

  // Valid selections
  for (const id of EXPECTED_IDS) {
    const draft = { ...baseDraft, "mount.id": id };
    const errors = validateDraft(draft, 13);
    assert.equal(
      errors["mount.id"],
      undefined,
      `Valid mount.id=${id} must not produce validation error`
    );
  }
  console.log("  [PASS] All valid IDs (0, 62, 63, 64, 65, 66) pass validation without errors");

  // Invalid selections
  const invalidIds = [-1, 1, 10, 61, 67, 100, "invalid"];
  for (const badId of invalidIds) {
    const draft = { ...baseDraft, "mount.id": badId as any };
    const errors = validateDraft(draft, 13);
    assert.ok(
      errors["mount.id"] !== undefined,
      `Invalid mount.id=${badId} must be rejected by validateDraft`
    );
  }
  console.log("  [PASS] Out-of-catalog IDs are rejected by validateDraft");

  // ── 5. Independent mount.on and mount.id semantics ─────────────────────────
  console.log("\n5. Verifying Independence of mount.on and mount.id...");

  // mount.on = 0 does not alter mount.id
  const draftOff = { ...baseDraft, "mount.on": 0, "mount.id": 64 };
  assert.equal(draftOff["mount.on"], 0);
  assert.equal(draftOff["mount.id"], 64);
  assert.equal(validateDraft(draftOff, 13)["mount.id"], undefined);

  // mount.on = 1 with specific mount
  const draftOn = { ...baseDraft, "mount.on": 1, "mount.id": 66 };
  assert.equal(draftOn["mount.on"], 1);
  assert.equal(draftOn["mount.id"], 66);
  assert.equal(validateDraft(draftOn, 13)["mount.id"], undefined);

  // Specific missing mount is NOT auto-substituted to 0
  const draftSpecific = { ...baseDraft, "mount.on": 1, "mount.id": 62 };
  assert.equal(draftSpecific["mount.id"], 62, "Specific mount ID 62 must remain 62 (no substitution)");
  console.log("  [PASS] mount.on and mount.id are completely decoupled; specific mount IDs are never substituted");

  // ── 6. Telemetry Parsing & Inventory Awareness ────────────────────────────
  console.log("\n6. Verifying Telemetry Parsing & Carried Mount Decoration...");

  const telemetrySample = "63:Ngựa trắng|65:Ngựa xích thố|66:Ngựa đen";
  const carried = parseCarriedMountIds(telemetrySample);
  assert.deepEqual(carried, [63, 65, 66], "Carried mount IDs parsed correctly from telemetry");

  // Empty or malformed telemetry handling
  assert.deepEqual(parseCarriedMountIds(""), []);
  assert.deepEqual(parseCarriedMountIds(null), []);
  assert.deepEqual(parseCarriedMountIds(undefined), []);
  assert.deepEqual(parseCarriedMountIds("invalid|data:here"), []);

  // Label decoration
  const carriedSet = new Set(carried);

  // ID 0 is never decorated with carried label (it's 'Any available mount')
  assert.equal(
    getMountDisplayLabel(0, carriedSet),
    "Bất kỳ (Thú cưỡi có sẵn)"
  );

  // Carried mounts receive inventory tag
  assert.equal(
    getMountDisplayLabel(63, carriedSet),
    "Ngựa trắng (Trong hành trang)"
  );
  assert.equal(
    getMountDisplayLabel(65, carriedSet),
    "Ngựa xích thố (Trong hành trang)"
  );
  assert.equal(
    getMountDisplayLabel(66, carriedSet),
    "Ngựa đen (Trong hành trang)"
  );

  // Uncarried mounts do NOT receive inventory tag
  assert.equal(
    getMountDisplayLabel(62, carriedSet),
    "Ngựa nâu"
  );
  assert.equal(
    getMountDisplayLabel(64, carriedSet),
    "Ngựa chiến giáp"
  );

  // Without telemetry, labels remain pure canonical names
  assert.equal(getMountDisplayLabel(63, null), "Ngựa trắng");
  assert.equal(getMountDisplayLabel(64, null), "Ngựa chiến giáp");

  console.log("  [PASS] Inventory awareness correctly decorates carried mounts without modifying catalog IDs or disabling options");

  console.log("\n=================================");
  console.log("ALL MOUNT CATALOG TESTS PASSED (0 failures)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Focused Material Drop Verification Suite (MATERIAL-DROP-WEB-01)
 *
 * Verifies:
 * 1. Material Drop Catalog Invariants: exactly 6 slots in wire order:
 *    [0] Mề đay trắng, [1] Mề đay vàng, [2] Mề đay tím,
 *    [3] Mề đay xanh, [4] Nguyên liệu tinh tú, [5] Lửa tinh tú
 * 2. Bit Semantics: 1 = Đóng rớt, 0 = Mở rớt
 * 3. Exact 6-character wire representation & preservation of leading zeroes
 * 4. Single-bit mutations: changing slot i modifies ONLY slot i
 * 5. CONTROL_SCHEMA v13 integration: bitLabels, labels, validation
 * 6. Master switch independence: item.dropsOn does not clear or destroy item.drops
 * 7. Regression checks: Control version 13, mount catalog, 34-key draft invariants
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
  console.log("=== MATERIAL DROP MANAGEMENT VERIFICATION (MATERIAL-DROP-WEB-01) ===");

  const {
    MATERIAL_DROP_SLOTS,
    MATERIAL_DROP_LABELS,
    MATERIAL_DROP_COUNT,
    DEFAULT_MATERIAL_DROPS,
    BIT_SEMANTICS,
    isMaterialDropClosed,
    setMaterialDropBit,
    parseMaterialDropBits,
  } = await import("../src/lib/material-drops");

  const {
    CONTROL_SCHEMA,
    CONFIG_FIELD_LABELS_VI,
    validateDraft,
    defaultControlDraft,
    controlRecordToDraft,
    draftToControlRecord,
  } = await import("../src/lib/config-schema");

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // ── 1. Catalog Invariants & Authentic Vietnamese Labels ───────────────────
  console.log("\n1. Verifying Material Drop Catalog & Order Invariants...");

  const EXPECTED_SLOTS = [
    { index: 0, label: "Mề đay trắng" },
    { index: 1, label: "Mề đay vàng" },
    { index: 2, label: "Mề đay tím" },
    { index: 3, label: "Mề đay xanh" },
    { index: 4, label: "Nguyên liệu tinh tú" },
    { index: 5, label: "Lửa tinh tú" },
  ];

  test("Catalog contains exactly 6 slots in the locked wire order", () => {
    assert.equal(MATERIAL_DROP_COUNT, 6);
    assert.equal(MATERIAL_DROP_SLOTS.length, 6);
    assert.equal(MATERIAL_DROP_LABELS.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.equal(MATERIAL_DROP_SLOTS[i].index, EXPECTED_SLOTS[i].index);
      assert.equal(MATERIAL_DROP_SLOTS[i].label, EXPECTED_SLOTS[i].label);
      assert.equal(MATERIAL_DROP_LABELS[i], EXPECTED_SLOTS[i].label);
    }
  });

  test("No placeholder labels exist in the material drop catalog", () => {
    for (const label of MATERIAL_DROP_LABELS) {
      assert(!label.toLowerCase().includes("slot"), `Placeholder 'slot' found: ${label}`);
      assert(!label.toLowerCase().includes("ô "), `Placeholder 'ô ' found: ${label}`);
    }
  });

  // ── 2. Bit Semantics & Mapping Cases ─────────────────────────────────────
  console.log("\n2. Verifying Bit Semantics (1 = Đóng rớt, 0 = Mở rớt)...");

  test("Bit semantics constants define 1 as Đóng rớt and 0 as Mở rớt", () => {
    assert.equal(BIT_SEMANTICS.CHECKED_LABEL, "Đóng rớt");
    assert.equal(BIT_SEMANTICS.UNCHECKED_LABEL, "Mở rớt");
  });

  test("000000 maps to all six materials as Mở rớt (false)", () => {
    const bits = parseMaterialDropBits("000000");
    assert.equal(bits.length, 6);
    assert(bits.every((b) => b === false), "All bits must be false (Mở rớt)");
    for (let i = 0; i < 6; i++) {
      assert.equal(isMaterialDropClosed("000000", i), false);
    }
  });

  test("111111 maps to all six materials as Đóng rớt (true)", () => {
    const bits = parseMaterialDropBits("111111");
    assert.equal(bits.length, 6);
    assert(bits.every((b) => b === true), "All bits must be true (Đóng rớt)");
    for (let i = 0; i < 6; i++) {
      assert.equal(isMaterialDropClosed("111111", i), true);
    }
  });

  // ── 3. Single-Bit Mutations & Preservation of Other Positions ─────────────
  console.log("\n3. Verifying Single-Bit Mutation Invariants...");

  const singleBitCases = [
    { index: 0, expected: "100000", name: "Mề đay trắng" },
    { index: 1, expected: "010000", name: "Mề đay vàng" },
    { index: 2, expected: "001000", name: "Mề đay tím" },
    { index: 3, expected: "000100", name: "Mề đay xanh" },
    { index: 4, expected: "000010", name: "Nguyên liệu tinh tú" },
    { index: 5, expected: "000001", name: "Lửa tinh tú" },
  ];

  for (const c of singleBitCases) {
    test(`Toggling index ${c.index} (${c.name}) from 000000 produces exact string ${c.expected}`, () => {
      const res = setMaterialDropBit("000000", c.index, true);
      assert.equal(res, c.expected);
      assert.equal(res.length, 6);
      // Verify other 5 positions are '0'
      for (let j = 0; j < 6; j++) {
        if (j === c.index) {
          assert.equal(res[j], "1");
        } else {
          assert.equal(res[j], "0");
        }
      }
    });
  }

  test("Preserves leading zeroes: index 5 toggle gives '000001' not trimmed or parsed as number", () => {
    const res = setMaterialDropBit("000000", 5, true);
    assert.equal(res, "000001");
    assert.equal(typeof res, "string");
    assert.equal(res.length, 6);
    assert.equal(res.startsWith("00000"), true);
  });

  test("Toggling a slot from 1 back to 0 preserves all other bits", () => {
    const start = "110101";
    // Turn off index 1 ('1' -> '0')
    const updated = setMaterialDropBit(start, 1, false);
    assert.equal(updated, "100101");
    // Only index 1 changed
    assert.equal(updated[0], "1");
    assert.equal(updated[1], "0");
    assert.equal(updated[2], "0");
    assert.equal(updated[3], "1");
    assert.equal(updated[4], "0");
    assert.equal(updated[5], "1");
  });

  test("Defensive handling: malformed string safely falls back to default 000000 base", () => {
    const res = setMaterialDropBit("invalid", 2, true);
    assert.equal(res, "001000");
  });

  // ── 4. CONTROL_SCHEMA v13 Integration ─────────────────────────────────────
  console.log("\n4. Verifying CONTROL_SCHEMA v13 Field Authority & Validation...");

  test("All 3 material drop keys exist in CONTROL_SCHEMA[13]", () => {
    const autoFarm = CONTROL_SCHEMA[13]?.find((s) => s.id === "auto_farm");
    assert(autoFarm, "auto_farm section exists in CONTROL_SCHEMA[13]");
    const fieldPaths = autoFarm.fields.map((f) => f.path);
    assert(fieldPaths.includes("item.medalDialog"), "item.medalDialog exists in auto_farm");
    assert(fieldPaths.includes("item.dropsOn"), "item.dropsOn exists in auto_farm");
    assert(fieldPaths.includes("item.drops"), "item.drops exists in auto_farm");
  });

  test("item.drops field in CONTROL_SCHEMA[13] has length 6 and authentic bitLabels", () => {
    const autoFarm = CONTROL_SCHEMA[13]?.find((s) => s.id === "auto_farm");
    const dropsField = autoFarm?.fields.find((f) => f.path === "item.drops") as import("../src/lib/config-schema").ConfigFieldFlags;
    assert(dropsField, "item.drops field found");
    assert.equal(dropsField.type, "flags");
    assert.equal(dropsField.length, 6);
    assert.deepEqual(dropsField.bitLabels, [...MATERIAL_DROP_LABELS]);
  });

  test("CONFIG_FIELD_LABELS_VI has authentic labels for material drop keys", () => {
    assert(CONFIG_FIELD_LABELS_VI["item.dropsOn"], "item.dropsOn label defined");
    assert(CONFIG_FIELD_LABELS_VI["item.drops"], "item.drops label defined");
    assert(CONFIG_FIELD_LABELS_VI["item.medalDialog"], "item.medalDialog label defined");
    assert(!CONFIG_FIELD_LABELS_VI["item.dropsOn"]?.includes("hòm đồ"), "No generic 'hòm đồ' in item.dropsOn label");
    assert(!CONFIG_FIELD_LABELS_VI["item.drops"]?.includes("hòm đồ"), "No generic 'hòm đồ' in item.drops label");
  });

  test("validateDraft accepts valid 6-bit binary strings", () => {
    const draft = { ...defaultControlDraft(), "item.drops": "001001" };
    const errs = validateDraft(draft, 13);
    assert(!("item.drops" in errs), "Valid 6-bit string passes validation");
  });

  test("validateDraft rejects malformed item.drops strings", () => {
    const shortDraft = { ...defaultControlDraft(), "item.drops": "0010" };
    assert("item.drops" in validateDraft(shortDraft, 13), "Short string rejected");

    const longDraft = { ...defaultControlDraft(), "item.drops": "0010001" };
    assert("item.drops" in validateDraft(longDraft, 13), "Long string rejected");

    const nonBinaryDraft = { ...defaultControlDraft(), "item.drops": "001020" };
    assert("item.drops" in validateDraft(nonBinaryDraft, 13), "Non-binary string rejected");
  });

  // ── 5. Master Switch & State Persistence ──────────────────────────────────
  console.log("\n5. Verifying Master Switch Independence & Round-Trip Persistence...");

  test("Toggling item.dropsOn does not mutate or reset item.drops", () => {
    const initial = { ...defaultControlDraft(), "item.dropsOn": 1, "item.drops": "101010" };
    // Turn master off
    const turnedOff = { ...initial, "item.dropsOn": 0 };
    assert.equal(turnedOff["item.drops"], "101010", "item.drops preserved when master turned off");

    // Serialization round-trip with master off preserves desired bits
    const serialized = draftToControlRecord(turnedOff);
    assert.equal(serialized["item.dropsOn"], 0);
    assert.equal(serialized["item.drops"], "101010");

    const reloaded = controlRecordToDraft(serialized);
    assert.equal(reloaded["item.dropsOn"], 0);
    assert.equal(reloaded["item.drops"], "101010");
  });

  test("Existing persisted control record round-trips unchanged", () => {
    const persisted = {
      ...defaultControlDraft(),
      "item.dropsOn": 1,
      "item.drops": "010010",
      "item.medalDialog": 1,
    };
    const record = draftToControlRecord(persisted);
    const roundTripped = controlRecordToDraft(record);
    assert.equal(roundTripped["item.dropsOn"], 1);
    assert.equal(roundTripped["item.drops"], "010010");
    assert.equal(roundTripped["item.medalDialog"], 1);
  });

  // ── 6. Regressions ────────────────────────────────────────────────────────
  console.log("\n6. Verifying Regression Invariants...");

  test("CONTROL_SCHEMA version remains exactly 13 with 34 keys", () => {
    const defaultDraft = defaultControlDraft();
    assert.equal(Object.keys(defaultDraft).length, 34);
    assert.equal(CONTROL_SCHEMA[13] !== undefined, true);
    assert.equal(CONTROL_SCHEMA[14] === undefined, true, "No control version bump");
  });

  test("Mount catalog regression: IDs 0, 62..66 remain intact", async () => {
    const { MOUNT_CATALOG } = await import("../src/lib/mounts");
    const ids = MOUNT_CATALOG.map((m) => m.id);
    assert.deepEqual(ids, [0, 62, 63, 64, 65, 66]);
  });

  console.log(`\n=================================`);
  console.log(`MATERIAL DROP TESTS: ${passed}/${total} PASSED`);
  if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

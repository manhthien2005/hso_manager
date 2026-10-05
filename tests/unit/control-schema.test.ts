/**
 * Unit tests for Dual Control Schema (v13 & v14) and Version Selection Policy
 */

import { register } from "node:module";
import { test, describe } from "node:test";
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

const {
  CONTROL_SCHEMA,
  defaultControlDraft,
  controlRecordToDraft,
  draftToControlRecord,
  validateDraft,
  determineControlVersionForSave,
  resolveAccountControlVersion,
  migrateLegacyControlToV15Draft,
  convertLegacyControlToV15Draft,
  resolveEffectiveSchemaVersion,
  getEffectiveInitialDraft,
  VISUAL_QOL_KEYS,
  VISUAL_QOL_DEFAULTS,
} = await import("../../src/lib/config-schema");

const {
  isCharacterSlotSupported,
  isCharacterSlotAvailableOnDevice,
} = await import("../../src/lib/capabilities");

const { MOUNT_CATALOG } = await import("../../src/lib/mounts");
const { MATERIAL_DROP_LABELS, MATERIAL_DROP_SLOTS } = await import("../../src/lib/material-drops");

describe("Control Schema v13 and v14 Dual Architecture", () => {
  describe("Schema key counts and wire invariants", () => {
    test("v13 contains exactly 35 wire keys (34 control keys + v)", () => {
      const v13Sections = CONTROL_SCHEMA[13];
      assert.ok(v13Sections, "CONTROL_SCHEMA[13] must exist");
      const v13Keys = v13Sections.flatMap((s) => s.fields.map((f) => f.path));
      // 34 keys in control record + 1 for v in accounts.control_version / wire
      assert.equal(v13Keys.length, 34);
      assert.equal(v13Keys.includes("ui.effects"), false, "ui.effects must be absent from v13");
      assert.equal(v13Keys.includes("ui.hidePlayers"), false, "ui.hidePlayers must be absent from v13");
    });

    test("v14 contains exactly 37 wire keys (36 control keys + v)", () => {
      const v14Sections = CONTROL_SCHEMA[14];
      assert.ok(v14Sections, "CONTROL_SCHEMA[14] must exist");
      const v14Keys = v14Sections.flatMap((s) => s.fields.map((f) => f.path));
      // 36 keys in control record + 1 for v in accounts.control_version / wire
      assert.equal(v14Keys.length, 36);
      assert.equal(v14Keys.includes("ui.effects"), true, "ui.effects must be present in v14");
      assert.equal(v14Keys.includes("ui.hidePlayers"), true, "ui.hidePlayers must be present in v14");
    });

    test("v14 preserves the original 34 control keys with identical semantics", () => {
      const v13Keys = CONTROL_SCHEMA[13].flatMap((s) => s.fields.map((f) => f.path));
      const v14Keys = CONTROL_SCHEMA[14].flatMap((s) => s.fields.map((f) => f.path));
      for (const key of v13Keys) {
        assert.ok(v14Keys.includes(key), `v14 must contain original key ${key}`);
      }
    });

    test("QoL keys constants exist and have correct defaults", () => {
      assert.deepEqual(VISUAL_QOL_KEYS, ["ui.effects", "ui.hidePlayers"]);
      assert.equal(VISUAL_QOL_DEFAULTS["ui.effects"], 1);
      assert.equal(VISUAL_QOL_DEFAULTS["ui.hidePlayers"], 0);
    });
  });

  describe("Validation against v13 and v14", () => {
    test("v14 accepts valid effects (0, 1) and hidePlayers (0, 1, 2)", () => {
      const draft = defaultControlDraft(14);
      draft["ui.effects"] = 1;
      draft["ui.hidePlayers"] = 0;
      let errs = validateDraft(draft, 14);
      assert.equal(errs["ui.effects"], undefined);
      assert.equal(errs["ui.hidePlayers"], undefined);

      draft["ui.effects"] = 0;
      draft["ui.hidePlayers"] = 2;
      errs = validateDraft(draft, 14);
      assert.equal(errs["ui.effects"], undefined);
      assert.equal(errs["ui.hidePlayers"], undefined);
    });

    test("v14 rejects invalid effects (> 1, negative, non-number)", () => {
      const draft = defaultControlDraft(14);
      draft["ui.effects"] = 2 as unknown as number;
      const errs = validateDraft(draft, 14);
      assert.ok(errs["ui.effects"], "ui.effects=2 must be rejected");
    });

    test("v14 rejects invalid hidePlayers (> 2, negative, non-number)", () => {
      const draft = defaultControlDraft(14);
      draft["ui.hidePlayers"] = 3 as unknown as number;
      const errs = validateDraft(draft, 14);
      assert.ok(errs["ui.hidePlayers"], "ui.hidePlayers=3 must be rejected");
    });

    test("v13 validation does not error on QoL fields even if present in draft", () => {
      const draft = defaultControlDraft(13);
      draft["ui.effects"] = 999;
      const errs = validateDraft(draft, 13);
      assert.equal(errs["ui.effects"], undefined);
    });
  });

  describe("Draft serialization and version strip/preserve behavior", () => {
    test("draftToControlRecord for v13 omits ui.effects and ui.hidePlayers", () => {
      const draft = defaultControlDraft(14);
      draft["ui.effects"] = 0;
      draft["ui.hidePlayers"] = 1;
      const rec = draftToControlRecord(draft, 13);
      assert.equal(rec["ui.effects"], undefined);
      assert.equal(rec["ui.hidePlayers"], undefined);
      assert.equal(Object.keys(rec).length, 34);
    });

    test("draftToControlRecord for v14 includes both QoL fields", () => {
      const draft = defaultControlDraft(14);
      draft["ui.effects"] = 0;
      draft["ui.hidePlayers"] = 2;
      const rec = draftToControlRecord(draft, 14);
      assert.equal(rec["ui.effects"], 0);
      assert.equal(rec["ui.hidePlayers"], 2);
      assert.equal(Object.keys(rec).length, 36);
    });

    test("existing v14 control record preserved through controlRecordToDraft and draftToControlRecord", () => {
      const original = {
        ...draftToControlRecord(defaultControlDraft(13), 13),
        "ui.effects": 0,
        "ui.hidePlayers": 1,
      };
      const draft = controlRecordToDraft(original);
      assert.equal(draft["ui.effects"], 0);
      assert.equal(draft["ui.hidePlayers"], 1);

      const saved = draftToControlRecord(draft, 14);
      assert.equal(saved["ui.effects"], 0);
      assert.equal(saved["ui.hidePlayers"], 1);
    });
  });

  describe("Version selection policy", () => {
    test("v13 account + unsupported device + unrelated save => remains v13", () => {
      const result = determineControlVersionForSave({
        accountControlVersion: 13,
        isDeviceQoLCapable: false,
        qolSettingsEdited: false,
      });
      assert.equal(result, 13);
    });

    test("v13 account + capable device + unrelated save => remains v13", () => {
      const result = determineControlVersionForSave({
        accountControlVersion: 13,
        isDeviceQoLCapable: true,
        qolSettingsEdited: false,
      });
      assert.equal(result, 13);
    });

    test("v13 account + capable device + effects change => promotes to v14", () => {
      const result = determineControlVersionForSave({
        accountControlVersion: 13,
        isDeviceQoLCapable: true,
        qolSettingsEdited: true,
      });
      assert.equal(result, 14);
    });

    test("v13 account + capable device + hidePlayers change => promotes to v14", () => {
      const result = determineControlVersionForSave({
        accountControlVersion: 13,
        isDeviceQoLCapable: true,
        qolSettingsEdited: true,
      });
      assert.equal(result, 14);
    });

    test("v14 account + capable device => remains v14", () => {
      const result = determineControlVersionForSave({
        accountControlVersion: 14,
        isDeviceQoLCapable: true,
        qolSettingsEdited: false,
      });
      assert.equal(result, 14);
    });

    test("v14 account + unsupported device => remains v14 (never downgrades)", () => {
      const result = determineControlVersionForSave({
        accountControlVersion: 14,
        isDeviceQoLCapable: false,
        qolSettingsEdited: false,
      });
      assert.equal(result, 14);
    });
  });

  describe("Regressions check", () => {
    test("Character slot multi-capability agent_version unlocks Slot 2/3", () => {
      const dev = {
        id: "d1",
        deviceId: "d1",
        userId: "u1",
        name: "dev",
        region: "Railway",
        status: "online" as const,
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1",
        runtimeVersion: "14",
        lastSeen: Date.now() - 1000,
        viewerAvailable: true,
        metrics: { cpu: 1, ramUsedMb: 1, ramTotalMb: 1, uptimeSeconds: 1 },
        jar_ctl_version: 14,
        viewer_url: null,
      };
      assert.equal(isCharacterSlotAvailableOnDevice(dev), true);
      assert.equal(isCharacterSlotSupported(2, dev), true);
      assert.equal(isCharacterSlotSupported(3, dev), true);
    });

    test("Material drop labels and bit count remain 6", () => {
      assert.equal(MATERIAL_DROP_SLOTS.length, 6);
      assert.equal(MATERIAL_DROP_LABELS.length, 6);
    });

    test("Mount catalog preserves canonical IDs", () => {
      const ids = MOUNT_CATALOG.map((m) => m.id);
      assert.ok(ids.includes(0));
      assert.ok(ids.includes(62));
      assert.ok(ids.includes(63));
      assert.ok(ids.includes(64));
      assert.ok(ids.includes(65));
      assert.ok(ids.includes(66));
    });

    test("Existing v13 config round-trips unchanged", () => {
      const draft = defaultControlDraft(13);
      const rec = draftToControlRecord(draft, 13);
      const roundTrip = controlRecordToDraft(rec);
      const roundTripRec = draftToControlRecord(roundTrip, 13);
      assert.deepEqual(rec, roundTripRec);
    });
  });

  describe("CTL15 Exact Schema, Wire Invariants, and Schedule Validation", () => {
    const AUTHORITATIVE_CTL15_KEYS = [
      "atk.mode",
      "atk.map",
      "atk.zone",
      "atk.x",
      "atk.y",
      "atk.radius",
      "atk.hpOn",
      "atk.hpPct",
      "atk.mpOn",
      "atk.mpPct",
      "revive.mode",
      "atk.buffs",
      "atk.zoneMode",
      "atk.zonePick",
      "item.rank",
      "item.mphp",
      "item.gold",
      "mount.on",
      "mount.id",
      "item.medalDialog",
      "item.dropsOn",
      "item.drops",
      "nav.target",
      "ui.ring",
      "atk.farmOnArrival",
      "nav.detectSpots",
      "revive.delay",
      "revive.on",
      "enhance.on",
      "enhance.maxLv",
      "enhance.charm",
      "dungeon.on",
      "dungeon.max",
      "dungeon.startMin",
      "dungeon.endMin",
      "ui.effects",
      "ui.hidePlayers",
    ];

    test("CTL15 default control has exactly 37 stored keys", () => {
      const draft15 = defaultControlDraft(15);
      const keys = Object.keys(draft15);
      assert.equal(keys.length, 37);
      const record = draftToControlRecord(draft15, 15);
      assert.equal(Object.keys(record).length, 37);
    });

    test("CTL15 contains dungeon.startMin and dungeon.endMin and defaults to -1", () => {
      const draft15 = defaultControlDraft(15);
      assert.equal(draft15["dungeon.startMin"], -1);
      assert.equal(draft15["dungeon.endMin"], -1);
      const record = draftToControlRecord(draft15, 15);
      assert.equal(record["dungeon.startMin"], -1);
      assert.equal(record["dungeon.endMin"], -1);
    });

    test("CTL15 does not contain dungeon.schedule", () => {
      const draft15 = defaultControlDraft(15);
      assert.equal("dungeon.schedule" in draft15, false);
      const record = draftToControlRecord(draft15, 15);
      assert.equal("dungeon.schedule" in record, false);
      const schemaKeys = CONTROL_SCHEMA[15].flatMap((s) => s.fields.map((f) => f.path));
      assert.equal(schemaKeys.includes("dungeon.schedule"), false);
    });

    test("CTL14 still contains dungeon.schedule and not startMin/endMin", () => {
      const draft14 = defaultControlDraft(14);
      assert.equal(draft14["dungeon.schedule"], -1);
      assert.equal("dungeon.startMin" in draft14, false);
      assert.equal("dungeon.endMin" in draft14, false);
      const record = draftToControlRecord(draft14, 14);
      assert.equal(record["dungeon.schedule"], -1);
      assert.equal("dungeon.startMin" in record, false);
      assert.equal("dungeon.endMin" in record, false);
    });

    test("CTL15 exact key set matches knight_build CTL_KEYS excluding v", () => {
      const v15Sections = CONTROL_SCHEMA[15];
      assert.ok(v15Sections, "CONTROL_SCHEMA[15] must exist");
      const v15Keys = v15Sections.flatMap((s) => s.fields.map((f) => f.path));
      assert.equal(v15Keys.length, 37);
      assert.deepEqual([...v15Keys].sort(), [...AUTHORITATIVE_CTL15_KEYS].sort());
      const recordKeys = Object.keys(draftToControlRecord(defaultControlDraft(15), 15));
      assert.deepEqual([...recordKeys].sort(), [...AUTHORITATIVE_CTL15_KEYS].sort());
    });

    test("valid -1/-1 passes", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.startMin"] = -1;
      draft["dungeon.endMin"] = -1;
      const errs = validateDraft(draft, 15);
      assert.equal(errs["dungeon.startMin"], undefined);
      assert.equal(errs["dungeon.endMin"], undefined);
    });

    test("valid 1200/1230 passes", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.startMin"] = 1200;
      draft["dungeon.endMin"] = 1230;
      const errs = validateDraft(draft, 15);
      assert.equal(errs["dungeon.startMin"], undefined);
      assert.equal(errs["dungeon.endMin"], undefined);
    });

    test("partial sentinel fails", () => {
      // (-1, 1200)
      const draft1 = defaultControlDraft(15);
      draft1["dungeon.startMin"] = -1;
      draft1["dungeon.endMin"] = 1200;
      const errs1 = validateDraft(draft1, 15);
      assert.ok(errs1["dungeon.startMin"] || errs1["dungeon.endMin"], "(-1, 1200) must fail");

      // (1200, -1)
      const draft2 = defaultControlDraft(15);
      draft2["dungeon.startMin"] = 1200;
      draft2["dungeon.endMin"] = -1;
      const errs2 = validateDraft(draft2, 15);
      assert.ok(errs2["dungeon.startMin"] || errs2["dungeon.endMin"], "(1200, -1) must fail");
    });

    test("equal start/end fails", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.startMin"] = 1200;
      draft["dungeon.endMin"] = 1200;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.startMin"] || errs["dungeon.endMin"], "1200/1200 must fail");
    });

    test("reverse window fails", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.startMin"] = 1230;
      draft["dungeon.endMin"] = 1200;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.startMin"] || errs["dungeon.endMin"], "1230/1200 must fail");
    });

    test("default CTL15 dungeon.max=-1 passes", () => {
      const draft = defaultControlDraft(15);
      assert.equal(draft["dungeon.max"], -1);
      const errs = validateDraft(draft, 15);
      assert.equal(errs["dungeon.max"], undefined);
    });

    test("dungeon.max=-1 passes", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = -1;
      const errs = validateDraft(draft, 15);
      assert.equal(errs["dungeon.max"], undefined);
    });

    test("dungeon.max=1 passes", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = 1;
      const errs = validateDraft(draft, 15);
      assert.equal(errs["dungeon.max"], undefined);
    });

    test("dungeon.max=10 passes", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = 10;
      const errs = validateDraft(draft, 15);
      assert.equal(errs["dungeon.max"], undefined);
    });

    test("dungeon.max=0 fails", () => {
      // Authoritative runtime proof:
      // Java Zeus.java line 810: if (value[K_DUNGEON_MAX] != -1 && (value[K_DUNGEON_MAX] < 1 || value[K_DUNGEON_MAX] > 10)) return false;
      // Rust control.rs line 974: if dungeon_max == 0 || !(-1..=DUNGEON_RUNS_MAX).contains(&dungeon_max) return Err(...);
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = 0;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.max"], "dungeon.max=0 must fail validation");
    });

    test("dungeon.max=-2 fails", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = -2;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.max"], "dungeon.max=-2 must fail validation");
    });

    test("dungeon.max=11 fails", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = 11;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.max"], "dungeon.max=11 must fail validation");
    });

    test("non-integer dungeon.max fails", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = 2.5;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.max"], "non-integer dungeon.max must fail validation");
    });

    test("cross-contract assertion: Java and Rust both define -1 or 1..10 as the v15 dungeon.max domain", () => {
      // Java: Zeus.acceptControl rejects K_DUNGEON_MAX unless value == -1 or value is within 1..10.
      // Rust: zeus-core control parser explicitly rejects dungeon_max == 0 and values outside -1..10.
      const v15DungeonField = CONTROL_SCHEMA[15]
        .flatMap((s) => s.fields)
        .find((f) => f.path === "dungeon.max");
      assert.ok(v15DungeonField, "v15 dungeon.max field must exist");
      assert.equal(v15DungeonField.type, "number");
      assert.ok(v15DungeonField.help?.includes("0 is invalid"), "v15 dungeon.max help must document 0 is invalid");
      if (v15DungeonField.type === "number") {
        assert.equal(v15DungeonField.min, -1);
        assert.equal(v15DungeonField.max, 10);
      }
    });
  });

  describe("Phase 5: CTL15 Promotion, Legacy Migration, and Version Mismatch Recovery", () => {
    // 1. account v15 + device CTL15 resolves effective version 15
    test("account v15 + device CTL15 resolves effective version 15", () => {
      const version = determineControlVersionForSave({
        accountControlVersion: 15,
        deviceJarCtlVersion: 15,
        isDeviceQoLCapable: true,
      });
      assert.equal(version, 15);
      assert.equal(resolveAccountControlVersion(15), 15);
      assert.equal(resolveEffectiveSchemaVersion(15, 15), 15);
    });

    // 2. account v14 + device CTL15 resolves save target 15
    test("account v14 + device CTL15 resolves save target 15", () => {
      const version = determineControlVersionForSave({
        accountControlVersion: 14,
        deviceJarCtlVersion: 15,
        isDeviceQoLCapable: true,
      });
      assert.equal(version, 15);
    });

    // 3. account v13 + device CTL15 resolves save target 15
    test("account v13 + device CTL15 resolves save target 15", () => {
      const version = determineControlVersionForSave({
        accountControlVersion: 13,
        deviceJarCtlVersion: 15,
        isDeviceQoLCapable: false,
      });
      assert.equal(version, 15);
    });

    // 4. account v14 + device CTL14 remains 14
    test("account v14 + device CTL14 remains 14", () => {
      const version = determineControlVersionForSave({
        accountControlVersion: 14,
        deviceJarCtlVersion: 14,
        isDeviceQoLCapable: true,
      });
      assert.equal(version, 14);
    });

    // 5. account v13 + device CTL13 remains 13
    test("account v13 + device CTL13 remains 13", () => {
      const version = determineControlVersionForSave({
        accountControlVersion: 13,
        deviceJarCtlVersion: 13,
        isDeviceQoLCapable: false,
        qolSettingsEdited: true, // Should NOT promote to 14 because device is CTL13
      });
      assert.equal(version, 13);
    });

    // 6. v15 page uses CONTROL_SCHEMA[15]
    test("v15 page uses CONTROL_SCHEMA[15]", () => {
      const effectiveSchemaVer = resolveEffectiveSchemaVersion(15, 15);
      assert.equal(effectiveSchemaVer, 15);
      const schema = CONTROL_SCHEMA[effectiveSchemaVer];
      assert.ok(schema, "Schema must exist for v15");
      const paths = schema.flatMap((s) => s.fields.map((f) => f.path));
      assert.equal(paths.includes("dungeon.startMin"), true);
      assert.equal(paths.includes("dungeon.endMin"), true);
      assert.equal(paths.includes("dungeon.schedule"), false);
      assert.equal(paths.includes("ui.effects"), true);
      assert.equal(paths.includes("ui.hidePlayers"), true);
    });

    // 7. v15 outgoing record has exactly 37 keys
    test("v15 outgoing record has exactly 37 keys", () => {
      const legacyControl = defaultControlDraft(13) as Record<string, unknown>;
      const draft = migrateLegacyControlToV15Draft(legacyControl, 13);
      const record = draftToControlRecord(draft, 15);
      assert.equal(Object.keys(record).length, 37);
    });

    // 8. v15 outgoing record contains startMin/endMin and not dungeon.schedule
    test("v15 outgoing record contains startMin/endMin and not dungeon.schedule", () => {
      const legacyControl = {
        ...defaultControlDraft(14),
        "dungeon.schedule": 20,
      } as Record<string, unknown>;
      const draft = migrateLegacyControlToV15Draft(legacyControl, 14);
      const record = draftToControlRecord(draft, 15);
      assert.equal("dungeon.startMin" in record, true);
      assert.equal("dungeon.endMin" in record, true);
      assert.equal("dungeon.schedule" in record, false);
      assert.equal("dungeon.schedule" in draft, false);
    });

    // 9. legacy dungeon.schedule=-1 promotes to startMin=-1/endMin=-1
    test("legacy dungeon.schedule=-1 promotes to startMin=-1/endMin=-1", () => {
      const legacyControl = {
        ...defaultControlDraft(13),
        "dungeon.schedule": -1,
      } as Record<string, unknown>;
      const draft = migrateLegacyControlToV15Draft(legacyControl, 13);
      assert.equal(draft["dungeon.startMin"], -1);
      assert.equal(draft["dungeon.endMin"], -1);
      const record = draftToControlRecord(draft, 15);
      assert.equal(record["dungeon.startMin"], -1);
      assert.equal(record["dungeon.endMin"], -1);
      assert.equal("dungeon.schedule" in record, false);
    });

    // 10. legacy dungeon.schedule=nonnegative also promotes safely to -1/-1 rather than silently changing semantics
    test("legacy dungeon.schedule=nonnegative also promotes safely to -1/-1 rather than silently changing semantics", () => {
      const legacyControl = {
        ...defaultControlDraft(14),
        "dungeon.schedule": 42,
      } as Record<string, unknown>;
      const draft = migrateLegacyControlToV15Draft(legacyControl, 14);
      assert.equal(draft["dungeon.startMin"], -1);
      assert.equal(draft["dungeon.endMin"], -1);
      const record = draftToControlRecord(draft, 15);
      assert.equal(record["dungeon.startMin"], -1);
      assert.equal(record["dungeon.endMin"], -1);
      assert.equal("dungeon.schedule" in record, false);
    });

    // 11. v14 visual QoL values are preserved into v15
    test("v14 visual QoL values are preserved into v15", () => {
      const legacyControl = {
        ...defaultControlDraft(14),
        "ui.effects": 0,
        "ui.hidePlayers": 2,
      } as Record<string, unknown>;
      const draft = migrateLegacyControlToV15Draft(legacyControl, 14);
      assert.equal(draft["ui.effects"], 0);
      assert.equal(draft["ui.hidePlayers"], 2);
      const record = draftToControlRecord(draft, 15);
      assert.equal(record["ui.effects"], 0);
      assert.equal(record["ui.hidePlayers"], 2);
    });

    // 12. v13 gets canonical v15 visual QoL defaults
    test("v13 gets canonical v15 visual QoL defaults", () => {
      const legacyControl = {
        ...defaultControlDraft(13),
      } as Record<string, unknown>;
      delete legacyControl["ui.effects"];
      delete legacyControl["ui.hidePlayers"];
      const draft = migrateLegacyControlToV15Draft(legacyControl, 13);
      assert.equal(draft["ui.effects"], 1);
      assert.equal(draft["ui.hidePlayers"], 0);
      const record = draftToControlRecord(draft, 15);
      assert.equal(record["ui.effects"], 1);
      assert.equal(record["ui.hidePlayers"], 0);
    });

    // 13. v15 dungeon.max=0 remains rejected
    test("v15 dungeon.max=0 remains rejected", () => {
      const draft = defaultControlDraft(15);
      draft["dungeon.max"] = 0;
      const errs = validateDraft(draft, 15);
      assert.ok(errs["dungeon.max"], "v15 dungeon.max=0 must be rejected");
    });

    // 14. version_mismatch account can produce a valid v15 Save payload
    test("version_mismatch account can produce a valid v15 Save payload", () => {
      // Production scenario: Account with control_version=13, config_status=version_mismatch running on CTL15 device
      const legacyAccount = {
        id: "acc-mismatch-1",
        control_version: 13,
        config_status: "version_mismatch",
        control: {
          ...defaultControlDraft(13),
          "dungeon.schedule": 10,
          "atk.radius": 150,
        },
      };
      const device = {
        jar_ctl_version: 15,
        status: "online" as const,
      };

      // 1. Version resolution
      const targetVersion = determineControlVersionForSave({
        accountControlVersion: legacyAccount.control_version,
        deviceJarCtlVersion: device.jar_ctl_version,
        isDeviceQoLCapable: true,
      });
      assert.equal(targetVersion, 15, "Target version must resolve to 15");

      // 2. Draft migration
      const draft = getEffectiveInitialDraft(
        legacyAccount.control,
        legacyAccount.control_version,
        targetVersion,
      );
      assert.equal(draft["atk.radius"], 150, "Common settings must be preserved");
      assert.equal(draft["dungeon.startMin"], -1, "Schedule must safely promote to -1");
      assert.equal(draft["dungeon.endMin"], -1, "Schedule must safely promote to -1");
      assert.equal("dungeon.schedule" in draft, false, "Legacy schedule must be dropped");
      assert.equal(draft["ui.effects"], 1, "Visual QoL default applied");
      assert.equal(draft["ui.hidePlayers"], 0, "Visual QoL default applied");

      // 3. Validation
      const errors = validateDraft(draft, targetVersion);
      assert.equal(Object.keys(errors).length, 0, "Migrated draft must be completely valid for v15");

      // 4. Save payload generation
      const controlRecord = draftToControlRecord(draft, targetVersion);
      assert.equal(Object.keys(controlRecord).length, 37, "Payload must contain exactly 37 keys");
      assert.equal(controlRecord["dungeon.startMin"], -1);
      assert.equal(controlRecord["dungeon.endMin"], -1);
      assert.equal("dungeon.schedule" in controlRecord, false);
      assert.equal(targetVersion, 15);
    });
  });
});

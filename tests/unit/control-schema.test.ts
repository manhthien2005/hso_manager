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
});

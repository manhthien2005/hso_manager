/**
 * Unit tests for Inventory Contract & Local Enhancement Queue Logic
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
  parseInventoryPayload,
  isInventoryAvailable,
  createSelectedItemReference,
  validateSelectedEntry,
  addQueueEntry,
  removeQueueEntry,
  reorderQueueEntry,
  updateQueueEntryTargetLevel,
  validateQueue,
} = await import("../../src/lib/inventory");

describe("Inventory Contract & Parser", () => {
  const validItem1 = {
    slot: 0,
    template_id: 101,
    category: 3,
    base_name: "Kiếm Sắt",
    display_name: "Kiếm Sắt +3",
    level: 3,
    tier: 1,
    count: 1,
    durability: 100,
    bind: 0,
    icon: 1001,
    candidate_for_enhancement: true,
  };

  const validItem2 = {
    slot: 1,
    template_id: 202,
    category: 1,
    base_name: "Bình Máu Nhỏ",
    display_name: "Bình Máu Nhỏ x50",
    level: 0,
    tier: 0,
    count: 50,
    durability: null,
    bind: null,
    icon: 2001,
    candidate_for_enhancement: false,
  };

  test("Valid version=1 payload parses successfully", () => {
    const raw = {
      version: 1,
      bag_capacity: 42,
      items: [validItem1, validItem2],
    };
    const parsed = parseInventoryPayload(raw);
    assert.ok(parsed !== null, "Parsed payload must not be null");
    assert.equal(parsed?.version, 1);
    assert.equal(parsed?.bag_capacity, 42);
    assert.equal(parsed?.items.length, 2);
    assert.equal(parsed?.items[0].display_name, "Kiếm Sắt +3");
    assert.equal(parsed?.items[0].candidate_for_enhancement, true);
    assert.equal(parsed?.items[1].candidate_for_enhancement, false);
  });

  test("Missing inventory is handled safely", () => {
    assert.equal(parseInventoryPayload(null), null);
    assert.equal(parseInventoryPayload(undefined), null);
    assert.equal(parseInventoryPayload({}), null);
    assert.equal(parseInventoryPayload("inventory"), null);
  });

  test("Wrong version is rejected / fails closed", () => {
    assert.equal(parseInventoryPayload({ version: 2, bag_capacity: 42, items: [] }), null);
    assert.equal(parseInventoryPayload({ version: 0, bag_capacity: 42, items: [] }), null);
    assert.equal(parseInventoryPayload({ version: "1", bag_capacity: 42, items: [] }), null);
  });

  test("Malformed item entry is isolated or causes safe inventory rejection without crashing", () => {
    const malformed = {
      version: 1,
      bag_capacity: 42,
      items: [
        validItem1,
        { slot: "not-a-number", template_id: 999 }, // corrupted item
      ],
    };
    const parsed = parseInventoryPayload(malformed);
    // Either isolates and preserves validItem1, or fails closed safely without throwing
    if (parsed !== null) {
      assert.equal(parsed.items.length, 1);
      assert.equal(parsed.items[0].slot, 0);
    }
  });

  test("Slots remain ordered in ascending slot order", () => {
    const raw = {
      version: 1,
      bag_capacity: 42,
      items: [
        { ...validItem2, slot: 5 },
        { ...validItem1, slot: 2 },
      ],
    };
    const parsed = parseInventoryPayload(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed.items[0].slot, 2);
    assert.equal(parsed.items[1].slot, 5);
  });

  test("Capacity greater than 42 (up to audited 126) parses safely", () => {
    const raw = {
      version: 1,
      bag_capacity: 126,
      items: [validItem1],
    };
    const parsed = parseInventoryPayload(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed.bag_capacity, 126);
  });

  test("isInventoryAvailable gate enforces process_state == 'running' and version == 1", () => {
    const validSnap = {
      v: 6,
      t: Date.now(),
      name: "Hero",
      lv: 50,
      inventory: {
        version: 1,
        bag_capacity: 42,
        items: [],
      },
    };

    assert.equal(isInventoryAvailable("running", validSnap as any), true);
    assert.equal(isInventoryAvailable("stopped", validSnap as any), false, "stopped account fails gate");
    assert.equal(isInventoryAvailable("starting", validSnap as any), false, "starting account fails gate");
    assert.equal(isInventoryAvailable("error", validSnap as any), false, "error account fails gate");
    assert.equal(isInventoryAvailable("offline", validSnap as any), false, "offline account fails gate");
    assert.equal(isInventoryAvailable("running", null), false, "null snapshot fails gate");
    assert.equal(isInventoryAvailable("running", { ...validSnap, inventory: undefined } as any), false, "missing inventory fails gate");
    assert.equal(
      isInventoryAvailable("running", { ...validSnap, inventory: { version: 2, bag_capacity: 42, items: [] } } as any),
      false,
      "wrong inventory version fails gate",
    );
  });
});

describe("Selection & Fingerprint Validation", () => {
  const swordSlot0 = {
    slot: 0,
    template_id: 101,
    category: 3,
    base_name: "Kiếm Sắt",
    display_name: "Kiếm Sắt +3",
    level: 3,
    tier: 1,
    count: 1,
    durability: 100,
    bind: 0,
    icon: 1001,
    candidate_for_enhancement: true,
  };

  const swordSlot1Duplicate = {
    ...swordSlot0,
    slot: 1, // Same template and name, different slot
  };

  const potionSlot2 = {
    slot: 2,
    template_id: 202,
    category: 1,
    base_name: "Bình Máu Nhỏ",
    display_name: "Bình Máu Nhỏ x50",
    level: 0,
    tier: 0,
    count: 50,
    durability: null,
    bind: null,
    icon: 2001,
    candidate_for_enhancement: false,
  };

  test("Candidate equipment creates valid SelectedItemReference", () => {
    const ref = createSelectedItemReference(swordSlot0);
    assert.equal(ref.captured_slot, 0);
    assert.equal(ref.template_id, 101);
    assert.equal(ref.category, 3);
    assert.equal(ref.base_name, "Kiếm Sắt");
    assert.equal(ref.tier, 1);
    assert.equal(ref.icon, 1001);
    assert.equal(ref.expected_level, 3);
    assert.equal(ref.captured_display_name, "Kiếm Sắt +3");
  });

  test("Exact same-slot fingerprint+level update remains valid", () => {
    const ref = createSelectedItemReference(swordSlot0);
    const inventory = {
      version: 1 as const,
      bag_capacity: 42,
      items: [swordSlot0],
    };
    const status = validateSelectedEntry(ref, inventory);
    assert.equal(status, "VALID");
  });

  test("Two duplicate-looking items at different slots can both be selected and tracked", () => {
    const ref0 = createSelectedItemReference(swordSlot0);
    const ref1 = createSelectedItemReference(swordSlot1Duplicate);
    const inventory = {
      version: 1 as const,
      bag_capacity: 42,
      items: [swordSlot0, swordSlot1Duplicate],
    };
    assert.equal(validateSelectedEntry(ref0, inventory), "VALID");
    assert.equal(validateSelectedEntry(ref1, inventory), "VALID");
    assert.notEqual(ref0.captured_slot, ref1.captured_slot);
  });

  test("Slot mismatch marks entry STALE_SELECTION", () => {
    const ref = createSelectedItemReference(swordSlot0);
    // Item at slot 0 was removed or moved to slot 1
    const inventory = {
      version: 1 as const,
      bag_capacity: 42,
      items: [
        { ...swordSlot0, slot: 1 }, // shifted!
      ],
    };
    const status = validateSelectedEntry(ref, inventory);
    assert.equal(status, "STALE_SELECTION", "Shifted slot must be marked STALE");
  });

  test("Level mismatch marks entry STALE_SELECTION", () => {
    const ref = createSelectedItemReference(swordSlot0);
    // Item at slot 0 changed level (e.g. enhanced or swapped)
    const inventory = {
      version: 1 as const,
      bag_capacity: 42,
      items: [
        { ...swordSlot0, level: 4, display_name: "Kiếm Sắt +4" },
      ],
    };
    const status = validateSelectedEntry(ref, inventory);
    assert.equal(status, "STALE_SELECTION", "Changed level must be marked STALE");
  });

  test("Web never auto-remaps a stale selection to another slot", () => {
    const ref = createSelectedItemReference(swordSlot0);
    // swordSlot0 is moved to slot 5; slot 0 now has potionSlot2
    const inventory = {
      version: 1 as const,
      bag_capacity: 42,
      items: [
        { ...potionSlot2, slot: 0 },
        { ...swordSlot0, slot: 5 },
      ],
    };
    const status = validateSelectedEntry(ref, inventory);
    assert.equal(status, "STALE_SELECTION");
    // captured_slot must remain 0, never silently mutated to 5
    assert.equal(ref.captured_slot, 0);
  });
});

describe("Queue Draft Local UI Operations", () => {
  const swordSlot0 = {
    slot: 0,
    template_id: 101,
    category: 3,
    base_name: "Kiếm Sắt",
    display_name: "Kiếm Sắt +3",
    level: 3,
    tier: 1,
    count: 1,
    durability: 100,
    bind: 0,
    icon: 1001,
    candidate_for_enhancement: true,
  };

  const swordSlot1 = {
    slot: 1,
    template_id: 102,
    category: 3,
    base_name: "Đao Gỗ",
    display_name: "Đao Gỗ +1",
    level: 1,
    tier: 1,
    count: 1,
    durability: 80,
    bind: null,
    icon: 1002,
    candidate_for_enhancement: true,
  };

  const nonCandidate = {
    slot: 2,
    template_id: 202,
    category: 1,
    base_name: "Bình Máu",
    display_name: "Bình Máu",
    level: 0,
    tier: 0,
    count: 10,
    durability: null,
    bind: null,
    icon: 2001,
    candidate_for_enhancement: false,
  };

  test("Candidate equipment can be added to queue draft with default target level", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, swordSlot0);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].reference.captured_slot, 0);
    assert.equal(queue[0].reference.expected_level, 3);
    assert.equal(queue[0].target_level, 4); // level + 1
    assert.equal(queue[0].status, "VALID");
  });

  test("Non-candidate item cannot be queued", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, nonCandidate);
    assert.equal(queue.length, 0, "Non-candidate item must not be added to queue");
  });

  test("Multiple items can be queued and maintain order", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, swordSlot0);
    queue = addQueueEntry(queue, swordSlot1);
    assert.equal(queue.length, 2);
    assert.equal(queue[0].reference.captured_slot, 0);
    assert.equal(queue[1].reference.captured_slot, 1);
  });

  test("Entry can be removed from queue draft", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, swordSlot0);
    queue = addQueueEntry(queue, swordSlot1);
    const idToRemove = queue[0].id;
    queue = removeQueueEntry(queue, idToRemove);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].reference.captured_slot, 1);
  });

  test("Queue order can be changed (move up/down)", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, swordSlot0);
    queue = addQueueEntry(queue, swordSlot1);
    assert.equal(queue[0].reference.captured_slot, 0);
    // Swap index 0 and 1
    queue = reorderQueueEntry(queue, 0, 1);
    assert.equal(queue[0].reference.captured_slot, 1);
    assert.equal(queue[1].reference.captured_slot, 0);
  });

  test("Target level can be updated within bounds (current_level + 1 .. 15)", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, swordSlot0); // level 3
    const entryId = queue[0].id;
    queue = updateQueueEntryTargetLevel(queue, entryId, 7);
    assert.equal(queue[0].target_level, 7);

    // Below level + 1 clamped or rejected
    queue = updateQueueEntryTargetLevel(queue, entryId, 2);
    assert.equal(queue[0].target_level, 4, "Target level below current_level + 1 must clamp to level + 1");

    // Above 15 clamped or rejected
    queue = updateQueueEntryTargetLevel(queue, entryId, 20);
    assert.equal(queue[0].target_level, 15, "Target level above 15 must clamp to 15");
  });

  test("validateQueue updates stale status when inventory changes", () => {
    let queue: any[] = [];
    queue = addQueueEntry(queue, swordSlot0); // slot 0
    queue = addQueueEntry(queue, swordSlot1); // slot 1

    // Inventory where slot 0 is unchanged, but slot 1 is removed
    const inventory = {
      version: 1 as const,
      bag_capacity: 42,
      items: [swordSlot0],
    };

    const validated = validateQueue(queue, inventory);
    assert.equal(validated[0].status, "VALID");
    assert.equal(validated[1].status, "STALE_SELECTION");
  });
});

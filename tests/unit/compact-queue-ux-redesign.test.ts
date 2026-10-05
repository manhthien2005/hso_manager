/**
 * Unit & Integration Tests for Compact Queue UX Redesign (ENHANCE-06C)
 */

import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith("@/")) {
    target = new URL("../../src/" + target.slice(2), "${import.meta.url}").href;
  }
  try {
    return await nextResolve(target, context);
  } catch (err) {
    if ((target.startsWith(".") || target.startsWith("file:")) && !target.endsWith(".ts")) {
      try {
        return await nextResolve(target + ".ts", context);
      } catch (_) {}
    }
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(hookCode), import.meta.url);

const {
  PIPELINE_STAGES,
  determineCurrentPipelineStage,
  translateEnhancementError,
  getCharmDisplayName,
} = await import("../../src/lib/enhancement-status");

const {
  CONTROL_SCHEMA,
} = await import("../../src/lib/config-schema");

const {
  UNRESOLVED_QUEUE_STATUSES,
  TERMINAL_QUEUE_STATUSES,
} = await import("../../src/lib/queue-progress");

const {
  addQueueEntry,
  getInventoryFreshness,
  parseInventoryPayload,
  updateQueueEntryTargetLevel,
  updateQueueEntryPaymentType,
  updateQueueEntryCharmMode,
  removeQueueEntry,
  reorderQueueEntry,
} = await import("../../src/lib/inventory");

describe("ENHANCE-06C: Compact Queue UX Redesign Verification", () => {
  describe("1. Legacy Global Automatic-Enhancement UI Removal & Schema Preservation", () => {
    it("verifies global automatic-enhancement card is removed from enhancement-panel.tsx", () => {
      const panelPath = path.resolve(process.cwd(), "src/components/accounts/enhancement-panel.tsx");
      const panelContent = fs.readFileSync(panelPath, "utf-8");

      // Verify legacy global auto-enhance card is removed from UI
      assert.equal(
        panelContent.includes("Cấu hình cường hóa tự động (Toàn cục)"),
        false,
        "Legacy global card title must not be present in enhancement-panel.tsx",
      );
      assert.equal(
        panelContent.includes("Tự động cường hóa"),
        false,
        "Tự động cường hóa toggle must not be present in enhancement-panel.tsx",
      );
      assert.equal(
        panelContent.includes("ConfigFieldInput"),
        false,
        "ConfigFieldInput must not be rendered in enhancement-panel.tsx",
      );
    });

    it("preserves CTL v14 config schema keys (enhance.on, enhance.maxLv, enhance.charm)", () => {
      const v14Sections = CONTROL_SCHEMA[14];
      assert.ok(v14Sections, "CTL v14 schema must exist");

      const enhanceSection = v14Sections.find((s) => s.id === "enhance");
      assert.ok(enhanceSection, "enhance section must exist in CTL v14 schema");

      const paths = enhanceSection.fields.map((f) => f.path);
      assert.ok(paths.includes("enhance.on"), "enhance.on must be preserved in schema");
      assert.ok(paths.includes("enhance.maxLv"), "enhance.maxLv must be preserved in schema");
      assert.ok(paths.includes("enhance.charm"), "enhance.charm must be preserved in schema");
    });

    it("preserves UNRESOLVED_QUEUE_STATUSES invariant", () => {
      assert.deepEqual(
        [...UNRESOLVED_QUEUE_STATUSES].sort(),
        ["MANUAL_REVIEW_REQUIRED", "PAUSED", "PAUSING", "QUEUED", "RUNNING"].sort(),
      );
    });
  });

  describe("2. Primary Equipment View & Eligibility Gate", () => {
    const samplePayload = {
      version: 1,
      bag_capacity: 42,
      items: [
        {
          slot: 0,
          template_id: 101,
          category: 3,
          base_name: "Kiếm Thần",
          display_name: "Kiếm Thần +3",
          level: 3,
          tier: 1,
          count: 1,
          durability: 100,
          bind: 0,
          icon: 10,
          candidate_for_enhancement: true,
        },
        {
          slot: 1,
          template_id: 201,
          category: 1,
          base_name: "Bình Máu",
          display_name: "Bình Máu x50",
          level: 0,
          tier: 0,
          count: 50,
          durability: null,
          bind: 0,
          icon: 20,
          candidate_for_enhancement: false,
        },
        {
          slot: 2,
          template_id: 301,
          category: 4,
          base_name: "Giáp Sắt",
          display_name: "Giáp Sắt +5",
          level: 5,
          tier: 2,
          count: 1,
          durability: 90,
          bind: 1,
          icon: 30,
          candidate_for_enhancement: true,
        },
      ],
    };

    it("filters only candidate_for_enhancement items for primary view", () => {
      const parsed = parseInventoryPayload(samplePayload);
      assert.ok(parsed);

      const eligible = parsed.items.filter((item) => item.candidate_for_enhancement);
      assert.equal(eligible.length, 2);
      assert.equal(eligible[0].display_name, "Kiếm Thần +3");
      assert.equal(eligible[1].display_name, "Giáp Sắt +5");
      assert.ok(!eligible.some((item) => item.base_name === "Bình Máu"));
    });

    it("blocks duplicate addition of the same equipment to queue", () => {
      const parsed = parseInventoryPayload(samplePayload);
      assert.ok(parsed);
      const sword = parsed.items[0];

      let queue: any[] = [];
      queue = addQueueEntry(queue, sword);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].reference.captured_slot, 0);

      // Attempt second addition of exact same slot
      const queueAfterDup = addQueueEntry(queue, sword);
      assert.equal(queueAfterDup.length, 1, "Duplicate add must be blocked");
    });

    it("eligible-equipment-view component source renders compact cards and collapsible full bag", () => {
      const equipViewPath = path.resolve(process.cwd(), "src/components/accounts/eligible-equipment-view.tsx");
      const content = fs.readFileSync(equipViewPath, "utf-8");

      assert.ok(content.includes("candidate_for_enhancement"), "Must filter by candidate_for_enhancement");
      assert.ok(content.includes("showFullBag"), "Must have collapsible full bag state");
      assert.ok(content.includes("Xem toàn bộ túi đồ"), "Must provide secondary collapsed full bag link");
      assert.ok(content.includes("Làm mới túi đồ"), "Must provide manual refresh action");
      assert.ok(content.includes("Đã có trong hàng đợi"), "Must indicate queued equipment cannot be added twice");
    });
  });

  describe("3. Inventory Freshness UI & Relative Age", () => {
    it("renders fresh age correctly", () => {
      const now = new Date().toISOString();
      const freshness = getInventoryFreshness(null, now);
      assert.equal(freshness.isStale, false);
      assert.match(freshness.text, /Vừa cập nhật|giây trước/);
    });

    it("renders stale age correctly when timestamp is old", () => {
      const oldTime = new Date(Date.now() - 45_000).toISOString(); // 45s ago
      const freshness = getInventoryFreshness(null, oldTime);
      assert.equal(freshness.isStale, true);
      assert.equal(freshness.ageSeconds, 45);
      assert.equal(freshness.text, "Cập nhật 45 giây trước");
    });

    it("handles missing snapshot timestamp gracefully", () => {
      const freshness = getInventoryFreshness(null, null);
      assert.equal(freshness.isStale, true);
      assert.equal(freshness.ageSeconds, null);
      assert.equal(freshness.text, "Không rõ thời gian cập nhật");
    });
  });

  describe("4. Queue Draft Controls & Start Guard", () => {
    it("updates target level within valid bounds [current+1 .. 15]", () => {
      const item = {
        slot: 3,
        template_id: 105,
        category: 3,
        base_name: "Đao Thần",
        display_name: "Đao Thần +2",
        level: 2,
        tier: 1,
        count: 1,
        durability: 100,
        bind: 0,
        icon: 12,
        candidate_for_enhancement: true,
      };

      let queue = addQueueEntry([], item);
      assert.equal(queue[0].target_level, 3); // Default level + 1

      queue = updateQueueEntryTargetLevel(queue, queue[0].id, 7);
      assert.equal(queue[0].target_level, 7);

      // Clamp below minimum
      queue = updateQueueEntryTargetLevel(queue, queue[0].id, 1);
      assert.equal(queue[0].target_level, 3, "Cannot set target below current + 1");

      // Clamp above maximum 15
      queue = updateQueueEntryTargetLevel(queue, queue[0].id, 20);
      assert.equal(queue[0].target_level, 15, "Cannot set target above 15");
    });

    it("configures payment and charm policy at queue item level", () => {
      const item = {
        slot: 4,
        template_id: 106,
        category: 3,
        base_name: "Cung Thần",
        display_name: "Cung Thần +0",
        level: 0,
        tier: 1,
        count: 1,
        durability: 100,
        bind: 0,
        icon: 15,
        candidate_for_enhancement: true,
      };

      let queue = addQueueEntry([], item);
      assert.equal(queue[0].payment_type, "GOLD");
      assert.equal(queue[0].charm_mode, "NONE");

      queue = updateQueueEntryPaymentType(queue, queue[0].id, "GEMS");
      assert.equal(queue[0].payment_type, "GEMS");

      queue = updateQueueEntryCharmMode(queue, queue[0].id, "CO_4_LA");
      assert.equal(queue[0].charm_mode, "CO_4_LA");
    });

    it("supports reordering and removal from draft", () => {
      const itemA = { slot: 0, template_id: 1, category: 1, base_name: "A", display_name: "A", level: 1, tier: 1, count: 1, durability: null, bind: 0, icon: 1, candidate_for_enhancement: true };
      const itemB = { slot: 1, template_id: 2, category: 1, base_name: "B", display_name: "B", level: 1, tier: 1, count: 1, durability: null, bind: 0, icon: 2, candidate_for_enhancement: true };

      let queue = addQueueEntry([], itemA);
      queue = addQueueEntry(queue, itemB);
      assert.equal(queue[0].reference.base_name, "A");
      assert.equal(queue[1].reference.base_name, "B");

      queue = reorderQueueEntry(queue, 0, 1);
      assert.equal(queue[0].reference.base_name, "B");
      assert.equal(queue[1].reference.base_name, "A");

      queue = removeQueueEntry(queue, queue[0].id);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].reference.base_name, "A");
    });

    it("enhancement-queue-draft source renders single primary Start button with double-click guard", () => {
      const draftPath = path.resolve(process.cwd(), "src/components/accounts/enhancement-queue-draft.tsx");
      const content = fs.readFileSync(draftPath, "utf-8");

      assert.ok(content.includes("start-enhancement-queue-btn"), "Must have start button");
      assert.ok(content.includes("Bắt đầu cường hóa"), "Must display Bắt đầu cường hóa");
      assert.ok(content.includes("isStarting"), "Must guard with isStarting");
      assert.ok(content.includes("disabled={isStartDisabled}"), "Must be disabled when invalid or starting");
    });
  });

  describe("5. Progress Pipeline & Human-Readable Stages", () => {
    it("maps travel status to traveling_to_forge without post-send ambiguity warning", () => {
      const stage = determineCurrentPipelineStage(
        "RUNNING",
        { attemptPhase: "PREPARING", charmMode: "NONE", settlementSource: null, status: "RUNNING" },
        { enhancephase: 1, travelstate: 1, travel: 1 },
      );

      assert.equal(stage, "traveling_to_forge");
      const info = PIPELINE_STAGES[stage];
      assert.equal(info.label, "Di chuyển tới lò rèn");
      assert.equal(info.isSensitive, false, "Travel must NOT be marked sensitive or display post-send warning");
    });

    it("maps NPC location and forge opening correctly", () => {
      const npcStage = determineCurrentPipelineStage(
        "RUNNING",
        { attemptPhase: "PREPARING", charmMode: "NONE", settlementSource: null, status: "RUNNING" },
        { enhancephase: 2, travelstate: 0, travel: 0 },
      );
      assert.equal(npcStage, "locating_npc");
      assert.equal(PIPELINE_STAGES[npcStage].label, "Tìm thợ rèn");
      assert.equal(PIPELINE_STAGES[npcStage].isSensitive, false);

      const forgeStage = determineCurrentPipelineStage(
        "RUNNING",
        { attemptPhase: "PREPARING", charmMode: "NONE", settlementSource: null, status: "RUNNING" },
        { enhancephase: 3, travelstate: 0, travel: 0 },
      );
      assert.equal(forgeStage, "opening_forge");
      assert.equal(PIPELINE_STAGES[forgeStage].label, "Mở lò rèn");
      assert.equal(PIPELINE_STAGES[forgeStage].isSensitive, false);
    });

    it("maps charm preparation status correctly", () => {
      const charmStage = determineCurrentPipelineStage(
        "RUNNING",
        { attemptPhase: "PREPARING", charmMode: "CO_3_LA", settlementSource: null, status: "RUNNING" },
        { enhancephase: 5, travelstate: 0, travel: 0 },
      );
      assert.equal(charmStage, "preparing_charm");
      assert.equal(PIPELINE_STAGES[charmStage].label, "Chuẩn bị bùa");
      assert.equal(PIPELINE_STAGES[charmStage].isSensitive, false);
    });

    it("maps WAITING_RESULT to server-result wording and sensitive in-flight state", () => {
      const waitingStage = determineCurrentPipelineStage(
        "RUNNING",
        { attemptPhase: "WAITING_RESULT", charmMode: "NONE", settlementSource: null, status: "RUNNING" },
        null,
      );
      assert.equal(waitingStage, "waiting_result");
      const info = PIPELINE_STAGES[waitingStage];
      assert.equal(info.label, "Chờ kết quả từ máy chủ");
      assert.equal(info.isSensitive, true, "WAITING_RESULT must be marked sensitive");
    });

    it("maps reconciling_result, completed, failed, and manual_review accurately", () => {
      assert.equal(
        determineCurrentPipelineStage("COMPLETED", null, null),
        "completed",
      );
      assert.equal(
        determineCurrentPipelineStage("FAILED", null, null),
        "failed",
      );
      assert.equal(
        determineCurrentPipelineStage("MANUAL_REVIEW_REQUIRED", null, null),
        "manual_review",
      );
      assert.equal(
        determineCurrentPipelineStage(
          "RUNNING",
          { attemptPhase: "WAITING_SETTLEMENT", charmMode: "NONE", settlementSource: null, status: "RUNNING" },
          null,
        ),
        "reconciling_result",
      );
    });
  });

  describe("6. Terminal Failure UX & Error Translations", () => {
    it("translates CHARM_MISSING with specific requested charm name", () => {
      const trans3 = translateEnhancementError("CHARM_MISSING", null, "CO_3_LA");
      assert.match(trans3.title, /Bùa Cỏ 3 lá/);
      assert.match(trans3.detail, /Bùa Cỏ 3 lá/);
      assert.equal(trans3.isPreFenceMismatch, true);
      assert.equal(trans3.isPostFenceAmbiguity, false);

      const trans4 = translateEnhancementError("CHARM_MISSING", null, "CO_4_LA");
      assert.match(trans4.title, /Bùa Cỏ 4 lá/);
      assert.match(trans4.detail, /Bùa Cỏ 4 lá/);

      assert.equal(getCharmDisplayName("CO_3_LA"), "Bùa Cỏ 3 lá");
      assert.equal(getCharmDisplayName("CO_4_LA"), "Bùa Cỏ 4 lá");
      assert.equal(getCharmDisplayName("AUTO_POLICY"), "Bùa Cỏ 3 lá hoặc 4 lá");
    });

    it("translates safe pre-fence inventory mismatch with refresh recommendation", () => {
      const trans = translateEnhancementError("ITEM_MISSING_OR_CHANGED", null, "NONE");
      assert.equal(trans.isPreFenceMismatch, true);
      assert.equal(trans.isPostFenceAmbiguity, false);
      assert.match(trans.recommendedAction, /Làm mới túi đồ/);
    });

    it("translates true post-fence ambiguity with fail-closed no-retry warning", () => {
      const trans = translateEnhancementError("MANUAL_REVIEW_REQUIRED", null, "NONE");
      assert.equal(trans.isPreFenceMismatch, false);
      assert.equal(trans.isPostFenceAmbiguity, true);
      assert.match(trans.detail, /Không retry|tự động thử lại/);
    });

    it("enhancement-queue-progress keeps terminal job visible with dismiss action", () => {
      const progressPath = path.resolve(process.cwd(), "src/components/accounts/enhancement-queue-progress.tsx");
      const content = fs.readFileSync(progressPath, "utf-8");

      assert.ok(content.includes("dismiss-terminal-queue-btn"), "Must have dismiss button for terminal job");
      assert.ok(content.includes("queue-failed-banner"), "Must have failed banner");
      assert.ok(content.includes("translateEnhancementError"), "Must use translateEnhancementError");
    });
  });
});

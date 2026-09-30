/**
 * Unit & Contract Tests for Degradation Retry & Attempt Cap (ENHANCE-06H5)
 * Task: ENHANCE-06H5-DEGRADE-RETRY-AND-ATTEMPT-CAP-CORRECTIVE
 */

import { register } from "node:module";
import { describe, it } from "node:test";
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
  ENHANCEMENT_DEGRADE_RETRY_CAPABILITY_TOKEN,
  hasEnhancementDegradeRetryCapability,
  isEnhancementDegradeRetryAvailableOnDevice,
} = await import("../../src/lib/capabilities");

const {
  addQueueEntry,
  updateQueueEntryMaxAttempts,
} = await import("../../src/lib/inventory");

const {
  draftToSubmissionPayload,
} = await import("../../src/lib/queue");

const {
  mapQueueItemRow,
  formatDurableAttemptCount,
} = await import("../../src/lib/queue-progress");

const {
  translateEnhancementError,
} = await import("../../src/lib/enhancement-status");

import type {
  Device,
  DeviceStatus,
  InventoryItemCatalog,
} from "../../src/lib/types";
import type { EnhancementQueueEntry } from "../../src/lib/inventory";
import type { Database } from "../../src/lib/database.types";

function createMockDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-01",
    deviceId: "dev-01",
    userId: "user-01",
    name: "VPS-01",
    region: "Railway",
    status: "online" as DeviceStatus,
    agentVersion: "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v2.enhancement-multilevel-v1.enhancement-degrade-retry-v1",
    runtimeVersion: "1.0.0",
    lastSeen: Date.now() - 10_000,
    viewerAvailable: true,
    viewer_url: null,
    jar_ctl_version: 14,
    metrics: {
      cpu: 10,
      ramUsedMb: 512,
      ramTotalMb: 2048,
      uptimeSeconds: 3600,
    },
    ...overrides,
  };
}

function createMockCatalogItem(overrides: Partial<InventoryItemCatalog> = {}): InventoryItemCatalog {
  return {
    slot: 3,
    template_id: 500,
    category: 1,
    base_name: "Kiếm báo thù",
    display_name: "Kiếm báo thù [Khoá] +5",
    level: 5,
    tier: 1,
    count: 1,
    durability: 100,
    bind: 1,
    icon: 10,
    candidate_for_enhancement: true,
    ...overrides,
  };
}

describe("ENHANCE-06H5: Degradation Retry & Attempt Cap Web Contracts", () => {
  describe("1. Capability Token & Agent Detection", () => {
    it("defines exact canonical token enhancement-degrade-retry-v1", () => {
      assert.equal(ENHANCEMENT_DEGRADE_RETRY_CAPABILITY_TOKEN, "enhancement-degrade-retry-v1");
    });

    it("detects token in new agent build metadata", () => {
      const version = "0.1.0+enhancement-queue-v2.enhancement-multilevel-v1.enhancement-degrade-retry-v1";
      assert.equal(hasEnhancementDegradeRetryCapability(version), true);
    });

    it("rejects baseline agent f205947 lacking degrade-retry capability", () => {
      const oldBaseline = "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v2.enhancement-multilevel-v1";
      assert.equal(hasEnhancementDegradeRetryCapability(oldBaseline), false);
    });

    it("rejects legacy version without metadata or with invalid delimiters", () => {
      assert.equal(hasEnhancementDegradeRetryCapability("0.1.0"), false);
      assert.equal(hasEnhancementDegradeRetryCapability("0.1.0+foo+bar"), false);
      assert.equal(hasEnhancementDegradeRetryCapability(null), false);
      assert.equal(hasEnhancementDegradeRetryCapability(undefined), false);
    });

    it("verifies device availability fails closed when offline or stale", () => {
      const freshDevice = createMockDevice();
      assert.equal(isEnhancementDegradeRetryAvailableOnDevice(freshDevice), true);

      const offlineDevice = createMockDevice({ status: "offline" });
      assert.equal(isEnhancementDegradeRetryAvailableOnDevice(offlineDevice), false);

      const staleDevice = createMockDevice({ lastSeen: Date.now() - 400_000 }); // > 5 min
      assert.equal(isEnhancementDegradeRetryAvailableOnDevice(staleDevice), false);

      const oldAgentDevice = createMockDevice({
        agentVersion: "0.1.0+enhancement-queue-v2.enhancement-multilevel-v1",
      });
      assert.equal(isEnhancementDegradeRetryAvailableOnDevice(oldAgentDevice), false);
    });
  });

  describe("2. Queue Draft & State Management", () => {
    it("addQueueEntry defaults max_attempts to 10", () => {
      const item = createMockCatalogItem();
      const entries = addQueueEntry([], item);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].max_attempts, 10);
      assert.equal(entries[0].target_level, 6);
    });

    it("updateQueueEntryMaxAttempts updates and bounds values between 1 and 100", () => {
      const item = createMockCatalogItem();
      let entries = addQueueEntry([], item);
      const entryId = entries[0].id;

      // Update to valid custom cap 25
      entries = updateQueueEntryMaxAttempts(entries, entryId, 25);
      assert.equal(entries[0].max_attempts, 25);

      // Clamp upper bound: 150 -> 100
      entries = updateQueueEntryMaxAttempts(entries, entryId, 150);
      assert.equal(entries[0].max_attempts, 100);

      // Clamp lower bound: 0 -> 1, negative -> 1
      entries = updateQueueEntryMaxAttempts(entries, entryId, 0);
      assert.equal(entries[0].max_attempts, 1);
      entries = updateQueueEntryMaxAttempts(entries, entryId, -5);
      assert.equal(entries[0].max_attempts, 1);

      // Round floating point
      entries = updateQueueEntryMaxAttempts(entries, entryId, 12.7);
      assert.equal(entries[0].max_attempts, 12);
    });

    it("draftToSubmissionPayload maps maxAttempts defaulting to 10", () => {
      const item = createMockCatalogItem();
      const entries = addQueueEntry([], item);
      entries[0].max_attempts = 15;
      entries[0].target_level = 7;

      const payload = draftToSubmissionPayload(entries);
      assert.equal(payload.length, 1);
      assert.equal(payload[0].maxAttempts, 15);
      assert.equal(payload[0].targetLevel, 7);

      const entryNoCap: EnhancementQueueEntry = { ...entries[0], max_attempts: undefined };
      const payloadDefault = draftToSubmissionPayload([entryNoCap]);
      assert.equal(payloadDefault[0].maxAttempts, 10);
    });
  });

  describe("3. Queue Progress Mapping & UI Formatting", () => {
    it("mapQueueItemRow extracts max_attempts with fallback to 10", () => {
      type ItemRow = Database["public"]["Tables"]["enhancement_queue_items"]["Row"];
      const row: ItemRow = {
        id: "item-row-1",
        job_id: "job-1",
        account_id: "acc-1",
        user_id: "user-1",
        queue_order: 1,
        captured_slot: 3,
        template_id: 500,
        category: 1,
        base_name: "Kiếm báo thù [Khoá]",
        tier: 1,
        icon: null,
        initial_level: 5,
        current_level: 4, // Observed degraded level!
        target_level: 7,
        payment_type: "GOLD",
        charm_mode: "NONE",
        status: "RUNNING",
        attempt_count: 2,
        max_attempts: 10,
        active_attempt_uuid: null,
        attempt_phase: "NONE",
        attempt_expected_level: null,
        attempt_target_level: null,
        attempt_started_at: null,
        execute_may_have_been_sent_at: null,
        attempt_settled_at: null,
        last_result_code: null,
        settlement_source: null,
        reconciled_at: null,
        reconciliation_reason: null,
        actual_gold_spent: 400000,
        actual_gem_spent: 0,
        actual_material_1_spent: 0,
        actual_material_2_spent: 0,
        actual_material_3_spent: 0,
        actual_material_4_spent: 0,
        actual_charm_spent: 0,
        error_code: null,
        error_message: null,
        started_at: new Date().toISOString(),
        finished_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mapped = mapQueueItemRow(row);
      assert.equal(mapped.currentLevel, 4);
      assert.equal(mapped.attemptCount, 2);
      assert.equal(mapped.maxAttempts, 10);
      assert.equal(mapped.status, "RUNNING");
    });

    it("formatDurableAttemptCount displays 'Đã dùng X / Y lượt'", () => {
      assert.equal(formatDurableAttemptCount(0, 10), "Đã dùng 0 / 10 lượt");
      assert.equal(formatDurableAttemptCount(1, 10), "Đã dùng 1 / 10 lượt");
      assert.equal(formatDurableAttemptCount(4, 15), "Đã dùng 4 / 15 lượt");
      assert.equal(formatDurableAttemptCount(10, 10), "Đã dùng 10 / 10 lượt");
      assert.equal(formatDurableAttemptCount(3), "3 lượt");
    });
  });

  describe("4. Error Code & Terminal Translation", () => {
    it("translates ATTEMPT_CAP_REACHED canonical error code to Vietnamese UI warning", () => {
      const translated = translateEnhancementError("ATTEMPT_CAP_REACHED", null);
      assert.ok(translated.title.includes("Đạt giới hạn số lượt cường hóa an toàn"));
      assert.ok(translated.detail.includes("Đã sử dụng hết số lượt cường hóa tối đa"));
      assert.equal(translated.isPreFenceMismatch, false);
      assert.equal(translated.isPostFenceAmbiguity, false);
    });
  });
});

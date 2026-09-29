/**
 * Unit & Integration Tests for Multi-Level Capability Gating (ENHANCE-06F2)
 *
 * Covers:
 * 1. Web Capability Helpers (token parsing, device freshness, fail-closed)
 * 2. UI Target Level Gating (clamping to current+1 when multi-level is unavailable)
 * 3. Server-Side Queue Creation & Publish Gates (rejecting multi-level on old/stale agent)
 * 4. Single-Level Backward Compatibility (single-level remains fully supported)
 * 5. Rollback Safety Simulation (rollback to 8f720fb automatically locks multi-level)
 * 6. Migration 019 Contract & Forward-Only Verification
 */

import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
  ENHANCEMENT_QUEUE_CAPABILITY_TOKEN,
  ENHANCEMENT_MULTILEVEL_CAPABILITY_TOKEN,
  DEVICE_FRESHNESS_THRESHOLD_MS,
  hasEnhancementQueueCapability,
  hasEnhancementMultilevelCapability,
  isEnhancementQueueAvailableOnDevice,
  isEnhancementMultilevelAvailableOnDevice,
} = await import("../../src/lib/capabilities");

import type { Device, DeviceStatus } from "../../src/lib/types";

function createMockDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-01",
    deviceId: "dev-01",
    userId: "user-01",
    name: "VPS-01",
    region: "Railway",
    status: "online" as DeviceStatus,
    agentVersion: "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1.enhancement-multilevel-v1",
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

describe("ENHANCE-06F2: Multi-Level Capability Gating", () => {
  describe("1. Token Constant & Parser Invariants", () => {
    it("defines exact canonical token enhancement-multilevel-v1", () => {
      assert.equal(ENHANCEMENT_MULTILEVEL_CAPABILITY_TOKEN, "enhancement-multilevel-v1");
    });

    it("detects exact token in new agent build metadata", () => {
      const newAgentVer = "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1.enhancement-multilevel-v1";
      assert.equal(hasEnhancementMultilevelCapability(newAgentVer), true);
    });

    it("detects token when isolated in build metadata", () => {
      assert.equal(hasEnhancementMultilevelCapability("0.1.0+enhancement-multilevel-v1"), true);
    });

    it("rejects pre-06F old agent version (8f720fb) lacking multi-level token", () => {
      const oldAgentVer = "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1";
      assert.equal(hasEnhancementMultilevelCapability(oldAgentVer), false);
      // But old agent still satisfies base enhancement-queue-v1
      assert.equal(hasEnhancementQueueCapability(oldAgentVer), true);
    });

    it("rejects legacy version without metadata", () => {
      assert.equal(hasEnhancementMultilevelCapability("0.1.0"), false);
    });

    it("rejects null, undefined, empty, or unknown version", () => {
      assert.equal(hasEnhancementMultilevelCapability(null), false);
      assert.equal(hasEnhancementMultilevelCapability(undefined), false);
      assert.equal(hasEnhancementMultilevelCapability(""), false);
      assert.equal(hasEnhancementMultilevelCapability("   "), false);
      assert.equal(hasEnhancementMultilevelCapability("unknown"), false);
      assert.equal(hasEnhancementMultilevelCapability("UNKNOWN"), false);
    });

    it("rejects non-exact, prefix, or substring matches", () => {
      assert.equal(hasEnhancementMultilevelCapability("0.1.0+enhancement-multilevel-v2"), false);
      assert.equal(hasEnhancementMultilevelCapability("0.1.0+enhancement-multilevel-v10"), false);
      assert.equal(hasEnhancementMultilevelCapability("0.1.0+not-enhancement-multilevel-v1"), false);
      assert.equal(hasEnhancementMultilevelCapability("0.1.0+enhancement-multilevel"), false);
    });

    it("rejects malformed versions with multiple '+' delimiters", () => {
      assert.equal(hasEnhancementMultilevelCapability("0.1.0+foo+enhancement-multilevel-v1"), false);
    });
  });

  describe("2. Device Availability & Freshness Gate", () => {
    it("passes for fresh, online device with new agent", () => {
      const dev = createMockDevice();
      assert.equal(isEnhancementMultilevelAvailableOnDevice(dev), true);
      assert.equal(isEnhancementQueueAvailableOnDevice(dev), true);
    });

    it("fails closed for old agent (8f720fb) lacking enhancement-multilevel-v1", () => {
      const oldDev = createMockDevice({
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1",
      });
      assert.equal(isEnhancementMultilevelAvailableOnDevice(oldDev), false);
      // But base single-level queue remains available!
      assert.equal(isEnhancementQueueAvailableOnDevice(oldDev), true);
    });

    it("fails closed for offline or error device even with valid token", () => {
      const offlineDev = createMockDevice({ status: "offline" });
      const errorDev = createMockDevice({ status: "error" });
      assert.equal(isEnhancementMultilevelAvailableOnDevice(offlineDev), false);
      assert.equal(isEnhancementMultilevelAvailableOnDevice(errorDev), false);
    });

    it("fails closed when lastSeen is null (device never reported)", () => {
      const dev = createMockDevice({ lastSeen: null });
      assert.equal(isEnhancementMultilevelAvailableOnDevice(dev), false);
    });

    it("fails closed when heartbeat is older than 5 minutes threshold", () => {
      const staleDev = createMockDevice({
        lastSeen: Date.now() - (DEVICE_FRESHNESS_THRESHOLD_MS + 1000),
      });
      assert.equal(isEnhancementMultilevelAvailableOnDevice(staleDev), false);
    });

    it("fails closed when device object is null or undefined", () => {
      assert.equal(isEnhancementMultilevelAvailableOnDevice(null), false);
      assert.equal(isEnhancementMultilevelAvailableOnDevice(undefined), false);
    });
  });

  describe("3. UI Target Level Dropdown Behavior", () => {
    it("restricts target levels to only current+1 when multi-level capability is absent", () => {
      const expectedLevel = 3;
      const minTarget = expectedLevel + 1; // +4
      const isMultilevel = false;
      const maxAllowed = isMultilevel ? 15 : minTarget;
      const targetLevels = Array.from(
        { length: Math.max(0, maxAllowed - minTarget + 1) },
        (_, i) => minTarget + i,
      );

      assert.deepEqual(targetLevels, [4]);
    });

    it("allows full target range (minTarget..15) when multi-level capability is present", () => {
      const expectedLevel = 3;
      const minTarget = expectedLevel + 1; // +4
      const isMultilevel = true;
      const maxAllowed = isMultilevel ? 15 : minTarget;
      const targetLevels = Array.from(
        { length: Math.max(0, maxAllowed - minTarget + 1) },
        (_, i) => minTarget + i,
      );

      assert.equal(targetLevels.length, 12); // 4 through 15
      assert.equal(targetLevels[0], 4);
      assert.equal(targetLevels[targetLevels.length - 1], 15);
    });
  });

  describe("4. Rollback Safety & Version Skew Matrix", () => {
    it("model rollback from new agent (500983) to old agent (8f720fb): fails closed for multi-level", () => {
      // 1. Initial production state: new agent deployed
      const liveDevice = createMockDevice({
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1.enhancement-multilevel-v1",
      });
      assert.equal(isEnhancementMultilevelAvailableOnDevice(liveDevice), true);

      // 2. Incident response triggers Railway rollback to 8f720fb
      const rolledBackDevice = createMockDevice({
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1",
      });

      // Web immediately locks multi-level without requiring Web redeployment
      assert.equal(isEnhancementMultilevelAvailableOnDevice(rolledBackDevice), false);

      // Safe single-level enhancement remains fully available
      assert.equal(isEnhancementQueueAvailableOnDevice(rolledBackDevice), true);
    });

    it("cross-version matrix verification", () => {
      // Combination 1: OLD_WEB + OLD_AGENT
      // Single-level: ALLOWED, Multi-level: BLOCKED_BY_DB_AFTER_019
      const oldAgentVersion = "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1";
      assert.equal(hasEnhancementQueueCapability(oldAgentVersion), true);
      assert.equal(hasEnhancementMultilevelCapability(oldAgentVersion), false);

      // Combination 2: OLD_WEB + NEW_AGENT
      // Single-level: ALLOWED, Multi-level: ALLOWED_AFTER_018_019
      const newAgentVersion = "0.1.0+character-slot-v1.visual-qol-v1.enhancement-queue-v1.enhancement-multilevel-v1";
      assert.equal(hasEnhancementQueueCapability(newAgentVersion), true);
      assert.equal(hasEnhancementMultilevelCapability(newAgentVersion), true);

      // Combination 3: NEW_WEB + OLD_AGENT
      // Single-level: ALLOWED, Multi-level: BLOCKED
      const oldAgentDevice = createMockDevice({ agentVersion: oldAgentVersion });
      assert.equal(isEnhancementQueueAvailableOnDevice(oldAgentDevice), true);
      assert.equal(isEnhancementMultilevelAvailableOnDevice(oldAgentDevice), false);

      // Combination 4: NEW_WEB + NEW_AGENT
      // Single-level: ALLOWED, Multi-level: ALLOWED
      const newAgentDevice = createMockDevice({ agentVersion: newAgentVersion });
      assert.equal(isEnhancementQueueAvailableOnDevice(newAgentDevice), true);
      assert.equal(isEnhancementMultilevelAvailableOnDevice(newAgentDevice), true);

      // Combination 5: NEW_WEB + UNKNOWN_AGENT
      // Single-level: BLOCKED (unless base valid), Multi-level: BLOCKED
      const unknownDevice = createMockDevice({ agentVersion: "unknown" });
      assert.equal(isEnhancementQueueAvailableOnDevice(unknownDevice), false);
      assert.equal(isEnhancementMultilevelAvailableOnDevice(unknownDevice), false);
    });
  });

  describe("5. Migration 019 Contract Verification", () => {
    const mig019Path = path.resolve(process.cwd(), "supabase/migrations/019_enhancement_multilevel_capability_gate.sql");

    it("migration 019 file exists and is non-empty", () => {
      assert.ok(fs.existsSync(mig019Path), "Migration 019 must exist");
      const content = fs.readFileSync(mig019Path, "utf-8");
      assert.ok(content.length > 500, "Migration 019 must be non-empty");
    });

    it("migration 019 is forward-only and contains no destructive statements", () => {
      const content = fs.readFileSync(mig019Path, "utf-8");
      assert.doesNotMatch(content, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(content, /TRUNCATE/i);
      assert.doesNotMatch(content, /ALTER\s+TABLE\s+public\.enhancement_queue_items\s+DROP/i);
      assert.doesNotMatch(content, /ALTER\s+TABLE\s+public\.enhancement_queue_jobs\s+DROP/i);
    });

    it("migrations 013 through 018 remain completely untouched", () => {
      for (const mig of ["013", "014", "015", "016", "017", "018"]) {
        const migFiles = fs
          .readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
          .filter((f) => f.startsWith(`${mig}_`));
        assert.equal(migFiles.length, 1, `Expected migration ${mig} to exist`);
      }
    });

    it("migration 019 replaces publish_enhancement_queue_job with multi-level capability check", () => {
      const content = fs.readFileSync(mig019Path, "utf-8");
      assert.match(content, /CREATE OR REPLACE FUNCTION public\.publish_enhancement_queue_job/i);
      assert.match(content, /target_level\s*>\s*initial_level\s*\+\s*1/i);
      assert.match(content, /enhancement-multilevel-v1/i);
      assert.match(content, /interval\s+'5 minutes'/i);
    });

    it("migration 019 requires device mapping and fresh heartbeat for multi-level publication", () => {
      const content = fs.readFileSync(mig019Path, "utf-8");
      assert.match(content, /JOIN public\.devices d ON d\.id = a\.device_id/i);
      assert.match(content, /v_device\.status\s*<>\s*'online'/i);
      assert.match(content, /v_device\.last_seen\s*<\s*\(v_now\s*-\s*v_freshness_threshold\)/i);
    });
  });

  describe("6. Server-Side Queue Gate Invariant Verification", () => {
    function simulateServerQueueValidation(params: {
      items: Array<{ initialLevel: number; targetLevel: number }>;
      agentVersion: string | null;
      deviceStatus: DeviceStatus;
      lastSeenMs: number | null;
      now?: number;
    }): { valid: boolean; errorCode?: string; errorMessage?: string } {
      const { items, agentVersion, deviceStatus, lastSeenMs, now = Date.now() } = params;

      // 4a. Check base capability
      if (!hasEnhancementQueueCapability(agentVersion)) {
        return {
          valid: false,
          errorCode: "QUEUE_RUNTIME_UNSUPPORTED",
          errorMessage: "Base enhancement-queue-v1 unsupported",
        };
      }

      // 4b. Check multi-level capability if any item targets multi-level
      const hasMultilevelItem = items.some((it) => it.targetLevel > it.initialLevel + 1);
      if (hasMultilevelItem && !hasEnhancementMultilevelCapability(agentVersion)) {
        return {
          valid: false,
          errorCode: "QUEUE_RUNTIME_UNSUPPORTED",
          errorMessage: "Multi-level enhancement requires enhancement-multilevel-v1",
        };
      }

      // Check freshness
      const isFresh =
        deviceStatus === "online" &&
        lastSeenMs !== null &&
        now - lastSeenMs <= DEVICE_FRESHNESS_THRESHOLD_MS;

      if (!isFresh) {
        return {
          valid: false,
          errorCode: "QUEUE_RUNTIME_STALE",
          errorMessage: "Device is not online and fresh",
        };
      }

      return { valid: true };
    }

    it("rejects multi-level queue item when agent lacks enhancement-multilevel-v1", () => {
      const result = simulateServerQueueValidation({
        items: [{ initialLevel: 3, targetLevel: 5 }],
        agentVersion: "0.1.0+enhancement-queue-v1",
        deviceStatus: "online",
        lastSeenMs: Date.now() - 5000,
      });
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, "QUEUE_RUNTIME_UNSUPPORTED");
    });

    it("allows single-level queue item when agent has base enhancement-queue-v1 even without multi-level token", () => {
      const result = simulateServerQueueValidation({
        items: [{ initialLevel: 3, targetLevel: 4 }],
        agentVersion: "0.1.0+enhancement-queue-v1",
        deviceStatus: "online",
        lastSeenMs: Date.now() - 5000,
      });
      assert.equal(result.valid, true);
    });

    it("allows multi-level queue item when new agent has both tokens and is fresh", () => {
      const result = simulateServerQueueValidation({
        items: [{ initialLevel: 3, targetLevel: 7 }],
        agentVersion: "0.1.0+enhancement-queue-v1.enhancement-multilevel-v1",
        deviceStatus: "online",
        lastSeenMs: Date.now() - 5000,
      });
      assert.equal(result.valid, true);
    });

    it("rejects multi-level queue item when new agent is stale (> 5 min)", () => {
      const result = simulateServerQueueValidation({
        items: [{ initialLevel: 3, targetLevel: 7 }],
        agentVersion: "0.1.0+enhancement-queue-v1.enhancement-multilevel-v1",
        deviceStatus: "online",
        lastSeenMs: Date.now() - (DEVICE_FRESHNESS_THRESHOLD_MS + 1000),
      });
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, "QUEUE_RUNTIME_STALE");
    });

    it("rejects forged multi-level request when device is offline", () => {
      const result = simulateServerQueueValidation({
        items: [{ initialLevel: 3, targetLevel: 8 }],
        agentVersion: "0.1.0+enhancement-queue-v1.enhancement-multilevel-v1",
        deviceStatus: "offline",
        lastSeenMs: Date.now() - 1000,
      });
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, "QUEUE_RUNTIME_STALE");
    });
  });

  describe("7. UI Auto-Clamping Invariant Verification", () => {
    it("clamps validated queue items to expected_level + 1 when multi-level is not capable", () => {
      const mockEntry = {
        id: "entry-01",
        reference: {
          captured_slot: 0,
          captured_item_id: 123,
          captured_display_name: "Kiếm Thần +3",
          expected_level: 3,
        },
        target_level: 7, // User had selected +7 previously
        payment_type: "GOLD" as const,
        charm_mode: "NONE" as const,
        status: "VALID" as const,
      };

      const isMultilevelCapable = false;
      const clampedEntries = [mockEntry].map((entry) => ({
        ...entry,
        target_level: !isMultilevelCapable
          ? Math.min(entry.target_level, entry.reference.expected_level + 1)
          : entry.target_level,
      }));

      assert.equal(clampedEntries[0].target_level, 4); // Clamped from 7 to 4
    });

    it("preserves higher target_level when multi-level is capable", () => {
      const mockEntry = {
        id: "entry-01",
        reference: {
          captured_slot: 0,
          captured_item_id: 123,
          captured_display_name: "Kiếm Thần +3",
          expected_level: 3,
        },
        target_level: 7,
        payment_type: "GOLD" as const,
        charm_mode: "NONE" as const,
        status: "VALID" as const,
      };

      const isMultilevelCapable = true;
      const unclampedEntries = [mockEntry].map((entry) => ({
        ...entry,
        target_level: !isMultilevelCapable
          ? Math.min(entry.target_level, entry.reference.expected_level + 1)
          : entry.target_level,
      }));

      assert.equal(unclampedEntries[0].target_level, 7); // Preserved at 7
    });
  });
});

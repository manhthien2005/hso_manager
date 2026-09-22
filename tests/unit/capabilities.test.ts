/**
 * Unit tests for Character Slot Capability & Device Availability Helper
 *
 * Verifies:
 * 1. Exact capability token is detected from 0.1.0+character-slot-v1
 * 2. 0.1.0 without build metadata is unsupported
 * 3. unknown/null/empty/undefined is unsupported
 * 4. A similar but non-equal token does not match (exact token equality)
 * 5. Future multiple dot-separated SemVer build metadata identifiers are supported
 * 6. Malformed agent versions return unsupported
 * 7. Offline/stale device fails closed:
 *    - Explicitly offline device fails closed
 *    - Degraded/error device fails closed
 *    - Device without lastSeen fails closed
 *    - Device older than 5 minute freshness threshold fails closed
 * 8. Fresh capable device passes
 * 9. Stored Slot 2/3 preservation helper behavior does not downgrade
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
  CHARACTER_SLOT_CAPABILITY_TOKEN,
  DEVICE_FRESHNESS_THRESHOLD_MS,
  CHARACTER_SLOT_LABELS,
  CHARACTER_SLOT_OPTIONS,
  hasCharacterSlotCapability,
  isCharacterSlotAvailableOnDevice,
  isCharacterSlotSupported,
  isValidCharacterSlot,
  validateCharacterSlotSelection,
} = await import("../../src/lib/capabilities");
import type { Device } from "../../src/lib/types";

function createMockDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-01",
    deviceId: "dev-01",
    userId: "user-01",
    name: "VPS-01",
    region: "Railway",
    status: "online",
    agentVersion: "0.1.0+character-slot-v1",
    runtimeVersion: "13",
    lastSeen: Date.now() - 30_000, // 30s ago (fresh)
    viewerAvailable: true,
    metrics: {
      cpu: 10,
      ramUsedMb: 512,
      ramTotalMb: 2048,
      uptimeSeconds: 3600,
    },
    jar_ctl_version: 13,
    viewer_url: null,
    ...overrides,
  };
}

describe("Character Slot Capability Helper", () => {
  describe("Token and constants", () => {
    test("token is character-slot-v1", () => {
      assert.equal(CHARACTER_SLOT_CAPABILITY_TOKEN, "character-slot-v1");
    });

    test("freshness threshold is 5 minutes (300,000 ms)", () => {
      assert.equal(DEVICE_FRESHNESS_THRESHOLD_MS, 300_000);
    });

    test("slot labels match locked semantics", () => {
      assert.equal(CHARACTER_SLOT_LABELS[1], "Slot 1 (Trái)");
      assert.equal(CHARACTER_SLOT_LABELS[2], "Slot 2 (Giữa)");
      assert.equal(CHARACTER_SLOT_LABELS[3], "Slot 3 (Phải)");
    });

    test("slot options provide 1, 2, 3 in order", () => {
      assert.deepEqual(
        CHARACTER_SLOT_OPTIONS.map((o) => o.value),
        [1, 2, 3],
      );
    });
  });

  describe("hasCharacterSlotCapability - token parsing", () => {
    test("detects exact token from canonical 0.1.0+character-slot-v1", () => {
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v1"), true);
    });

    test("detects exact token within multi-token dot-separated build metadata", () => {
      assert.equal(hasCharacterSlotCapability("0.1.0+build.42.character-slot-v1"), true);
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v1.sha.abcd123"), true);
      assert.equal(hasCharacterSlotCapability("1.2.3+linux.character-slot-v1.release"), true);
    });

    test("rejects standard version without build metadata", () => {
      assert.equal(hasCharacterSlotCapability("0.1.0"), false);
      assert.equal(hasCharacterSlotCapability("1.0.0"), false);
    });

    test("rejects null, undefined, empty, or unknown version", () => {
      assert.equal(hasCharacterSlotCapability(null), false);
      assert.equal(hasCharacterSlotCapability(undefined), false);
      assert.equal(hasCharacterSlotCapability(""), false);
      assert.equal(hasCharacterSlotCapability("   "), false);
      assert.equal(hasCharacterSlotCapability("unknown"), false);
      assert.equal(hasCharacterSlotCapability("UNKNOWN"), false);
    });

    test("rejects non-exact or substring token matches", () => {
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v1-beta"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v10"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0+pre-character-slot-v1"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0+not-character-slot-v1"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v2"), false);
      assert.equal(hasCharacterSlotCapability("character-slot-v1"), false);
    });

    test("rejects malformed versions safely", () => {
      assert.equal(hasCharacterSlotCapability("+character-slot-v1"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0+"), false);
      assert.equal(hasCharacterSlotCapability("invalid+"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0++character-slot-v1"), false);
    });
  });

  describe("isCharacterSlotAvailableOnDevice - availability and freshness gate", () => {
    test("passes for fresh, online device with capable runtime", () => {
      const dev = createMockDevice({
        status: "online",
        lastSeen: Date.now() - 10_000,
        agentVersion: "0.1.0+character-slot-v1",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(dev), true);
    });

    test("fails closed for null or undefined device", () => {
      assert.equal(isCharacterSlotAvailableOnDevice(null), false);
      assert.equal(isCharacterSlotAvailableOnDevice(undefined), false);
    });

    test("fails closed for device with old/incompatible agent version", () => {
      const dev = createMockDevice({
        status: "online",
        lastSeen: Date.now() - 10_000,
        agentVersion: "0.1.0",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(dev), false);
    });

    test("fails closed for offline or error device even if token was advertised", () => {
      const offlineDev = createMockDevice({
        status: "offline",
        lastSeen: Date.now() - 10_000,
        agentVersion: "0.1.0+character-slot-v1",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(offlineDev), false);

      const errorDev = createMockDevice({
        status: "error",
        lastSeen: Date.now() - 10_000,
        agentVersion: "0.1.0+character-slot-v1",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(errorDev), false);
    });

    test("fails closed when lastSeen is null", () => {
      const dev = createMockDevice({
        status: "online",
        lastSeen: null,
        agentVersion: "0.1.0+character-slot-v1",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(dev), false);
    });

    test("fails closed when heartbeat is older than 5 minutes", () => {
      const now = 1_000_000_000;
      // 5 minutes and 1 second ago -> stale
      const staleDev = createMockDevice({
        status: "online",
        lastSeen: now - 301_000,
        agentVersion: "0.1.0+character-slot-v1",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(staleDev, now), false);

      // Exactly 4 minutes ago -> fresh
      const freshDev = createMockDevice({
        status: "online",
        lastSeen: now - 240_000,
        agentVersion: "0.1.0+character-slot-v1",
      });
      assert.equal(isCharacterSlotAvailableOnDevice(freshDev, now), true);
    });
  });

  describe("Stored unsupported value policy & validators", () => {
    test("isValidCharacterSlot accepts 1, 2, 3 only", () => {
      assert.equal(isValidCharacterSlot(1), true);
      assert.equal(isValidCharacterSlot(2), true);
      assert.equal(isValidCharacterSlot(3), true);
      assert.equal(isValidCharacterSlot(0), false);
      assert.equal(isValidCharacterSlot(4), false);
      assert.equal(isValidCharacterSlot(null), false);
      assert.equal(isValidCharacterSlot("1"), false);
    });

    test("isCharacterSlotSupported always allows Slot 1 regardless of device", () => {
      const oldDev = createMockDevice({ agentVersion: "0.1.0" });
      const offlineDev = createMockDevice({ status: "offline" });
      assert.equal(isCharacterSlotSupported(1, oldDev), true);
      assert.equal(isCharacterSlotSupported(1, offlineDev), true);
      assert.equal(isCharacterSlotSupported(1, null), true);
      assert.equal(isCharacterSlotSupported(undefined, oldDev), true);
    });

    test("isCharacterSlotSupported requires device capability for Slot 2 and 3", () => {
      const capableDev = createMockDevice({
        status: "online",
        lastSeen: Date.now() - 10_000,
        agentVersion: "0.1.0+character-slot-v1",
      });
      const oldDev = createMockDevice({
        status: "online",
        lastSeen: Date.now() - 10_000,
        agentVersion: "0.1.0",
      });

      assert.equal(isCharacterSlotSupported(2, capableDev), true);
      assert.equal(isCharacterSlotSupported(3, capableDev), true);
      assert.equal(isCharacterSlotSupported(2, oldDev), false);
      assert.equal(isCharacterSlotSupported(3, oldDev), false);
    });

    test("validateCharacterSlotSelection allows Slot 1 under all conditions", () => {
      // In create flow (no storedSlot):
      assert.equal(validateCharacterSlotSelection(1, false), null);
      assert.equal(validateCharacterSlotSelection(1, true), null);
      // In edit flow with storedSlot=2:
      assert.equal(validateCharacterSlotSelection(1, false, 2), null);
    });

    test("validateCharacterSlotSelection allows Slot 2/3 when capable", () => {
      assert.equal(validateCharacterSlotSelection(2, true), null);
      assert.equal(validateCharacterSlotSelection(3, true), null);
      assert.equal(validateCharacterSlotSelection(2, true, 1), null);
      assert.equal(validateCharacterSlotSelection(3, true, 2), null);
    });

    test("validateCharacterSlotSelection rejects new Slot 2/3 when not capable", () => {
      // Create flow without capability
      assert.notEqual(validateCharacterSlotSelection(2, false), null);
      assert.notEqual(validateCharacterSlotSelection(3, false), null);

      // Edit flow trying to switch from 1 to 2 or 3
      assert.notEqual(validateCharacterSlotSelection(2, false, 1), null);
      assert.notEqual(validateCharacterSlotSelection(3, false, 1), null);

      // Edit flow trying to switch from stored 2 to 3 without capability
      assert.notEqual(validateCharacterSlotSelection(3, false, 2), null);
    });

    test("validateCharacterSlotSelection preserves stored Slot 2/3 without downgrade", () => {
      // Stored 2 remains 2 on incapable device
      assert.equal(validateCharacterSlotSelection(2, false, 2), null);
      // Stored 3 remains 3 on incapable device
      assert.equal(validateCharacterSlotSelection(3, false, 3), null);
    });

    test("validateCharacterSlotSelection rejects invalid slot numbers", () => {
      assert.notEqual(validateCharacterSlotSelection(0, true), null);
      assert.notEqual(validateCharacterSlotSelection(4, true), null);
      assert.notEqual(validateCharacterSlotSelection(-1, true), null);
    });
  });

  describe("Realtime unlock and lifecycle scenarios", () => {
    test("device capability unlocks dynamically when agent announces token", () => {
      // 1. Initial state: old runtime on Railway
      const device: Device = createMockDevice({
        agentVersion: "0.1.0",
        status: "online",
        lastSeen: Date.now() - 5_000,
      });

      // Old runtime fails closed
      assert.equal(isCharacterSlotAvailableOnDevice(device), false);
      assert.notEqual(validateCharacterSlotSelection(2, isCharacterSlotAvailableOnDevice(device)), null);

      // 2. User deploys new runtime to Railway -> device announces new agent_version
      const updatedDevice: Device = {
        ...device,
        agentVersion: "0.1.0+character-slot-v1",
        lastSeen: Date.now() - 1_000,
      };

      // Unlocks immediately without Web redeployment
      assert.equal(isCharacterSlotAvailableOnDevice(updatedDevice), true);
      assert.equal(validateCharacterSlotSelection(2, isCharacterSlotAvailableOnDevice(updatedDevice)), null);
      assert.equal(validateCharacterSlotSelection(3, isCharacterSlotAvailableOnDevice(updatedDevice)), null);
    });

    test("rollback to old runtime deterministically locks Slot 2/3 again", () => {
      // If a rollback happens and old agent PATCHes devices with agentVersion = "0.1.0"
      const rolledBackDevice: Device = createMockDevice({
        agentVersion: "0.1.0",
        status: "online",
        lastSeen: Date.now() - 2_000,
      });

      assert.equal(isCharacterSlotAvailableOnDevice(rolledBackDevice), false);
      assert.notEqual(validateCharacterSlotSelection(2, isCharacterSlotAvailableOnDevice(rolledBackDevice)), null);
    });

    test("stored unsupported value allows safe downgrade but blocks changing to another unsupported slot", () => {
      const isCapable = false;
      const storedSlot = 2;

      // Unchanged save: preserved
      assert.equal(validateCharacterSlotSelection(2, isCapable, storedSlot), null);

      // Explicit downgrade to 1: allowed
      assert.equal(validateCharacterSlotSelection(1, isCapable, storedSlot), null);

      // Switch to 3: blocked
      assert.notEqual(validateCharacterSlotSelection(3, isCapable, storedSlot), null);
    });
  });
});


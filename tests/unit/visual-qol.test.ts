/**
 * Unit tests for Visual QoL Capability Helper & Device Availability Gate
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
  VISUAL_QOL_CAPABILITY_TOKEN,
  CHARACTER_SLOT_CAPABILITY_TOKEN,
  DEVICE_FRESHNESS_THRESHOLD_MS,
  hasVisualQoLCapability,
  hasCharacterSlotCapability,
  isVisualQoLAvailableOnDevice,
  isCharacterSlotAvailableOnDevice,
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
    agentVersion: "0.1.0+visual-qol-v1",
    runtimeVersion: "14",
    lastSeen: Date.now() - 30_000, // 30s ago (fresh)
    viewerAvailable: true,
    metrics: {
      cpu: 10,
      ramUsedMb: 512,
      ramTotalMb: 2048,
      uptimeSeconds: 3600,
    },
    jar_ctl_version: 14,
    viewer_url: null,
    ...overrides,
  };
}

describe("Visual QoL Capability Helper", () => {
  describe("Token constants and exact parsing", () => {
    test("token is visual-qol-v1", () => {
      assert.equal(VISUAL_QOL_CAPABILITY_TOKEN, "visual-qol-v1");
    });

    test("0.1.0+character-slot-v1.visual-qol-v1 matches visual-qol-v1 and character-slot-v1 independently", () => {
      const version = "0.1.0+character-slot-v1.visual-qol-v1";
      assert.equal(hasVisualQoLCapability(version), true);
      assert.equal(hasCharacterSlotCapability(version), true);
    });

    test("0.1.0+character-slot-v1 does not match visual-qol-v1", () => {
      assert.equal(hasVisualQoLCapability("0.1.0+character-slot-v1"), false);
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v1"), true);
    });

    test("0.1.0+visual-qol-v10 does not match visual-qol-v1", () => {
      assert.equal(hasVisualQoLCapability("0.1.0+visual-qol-v10"), false);
    });

    test("0.1.0+character-slot-v10 does not match character-slot-v1", () => {
      assert.equal(hasCharacterSlotCapability("0.1.0+character-slot-v10"), false);
    });

    test("handles non-string, empty, unknown, null, undefined gracefully", () => {
      assert.equal(hasVisualQoLCapability(null), false);
      assert.equal(hasVisualQoLCapability(undefined), false);
      assert.equal(hasVisualQoLCapability(""), false);
      assert.equal(hasVisualQoLCapability("unknown"), false);
      assert.equal(hasVisualQoLCapability("UNKNOWN"), false);
      assert.equal(hasVisualQoLCapability("0.1.0"), false);
    });
  });

  describe("Device availability and freshness gate", () => {
    test("fresh online capable device passes", () => {
      const dev = createMockDevice({
        status: "online",
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1",
        lastSeen: Date.now() - 10_000,
      });
      assert.equal(isVisualQoLAvailableOnDevice(dev), true);
    });

    test("offline capable device fails availability", () => {
      const dev = createMockDevice({
        status: "offline",
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1",
        lastSeen: Date.now() - 10_000,
      });
      assert.equal(isVisualQoLAvailableOnDevice(dev), false);
    });

    test("stale capable device fails availability (> 5 min threshold)", () => {
      const dev = createMockDevice({
        status: "online",
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1",
        lastSeen: Date.now() - (DEVICE_FRESHNESS_THRESHOLD_MS + 1000),
      });
      assert.equal(isVisualQoLAvailableOnDevice(dev), false);
    });

    test("null / undefined device fails closed", () => {
      assert.equal(isVisualQoLAvailableOnDevice(null), false);
      assert.equal(isVisualQoLAvailableOnDevice(undefined), false);
    });

    test("device missing lastSeen fails closed", () => {
      const dev = createMockDevice({
        status: "online",
        agentVersion: "0.1.0+character-slot-v1.visual-qol-v1",
        lastSeen: null,
      });
      assert.equal(isVisualQoLAvailableOnDevice(dev), false);
    });
  });
});

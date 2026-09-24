/**
 * Feature capabilities and runtime availability gates.
 *
 * Centralizes all feature capability token parsing and device availability logic.
 * Ensures fail-closed behavior across Create Account, Edit Account, and RPC service boundaries.
 */

import type { CharacterSlot, Device } from "./types";

/**
 * Exact capability token advertised in agent_version build metadata for Character Slot support.
 * Producer: zeus-agent (commit bcfd8c78a57786232dd07b10580be510ae977b0b).
 */
export const CHARACTER_SLOT_CAPABILITY_TOKEN = "character-slot-v1";
export const VISUAL_QOL_CAPABILITY_TOKEN = "visual-qol-v1";

/**
 * Device heartbeat freshness threshold: 5 minutes (300,000 ms).
 * Based on zeus-agent 60-second heartbeat cadence (5 missed beats = stale).
 */
export const DEVICE_FRESHNESS_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Locked positional labels for vanilla character selection:
 * 1: Slot 1 (Trái) - left
 * 2: Slot 2 (Giữa) - center
 * 3: Slot 3 (Phải) - right
 */
export const CHARACTER_SLOT_LABELS: Record<CharacterSlot, string> = {
  1: "Slot 1 (Trái)",
  2: "Slot 2 (Giữa)",
  3: "Slot 3 (Phải)",
};

export const CHARACTER_SLOT_OPTIONS: Array<{ value: CharacterSlot; label: string }> = [
  { value: 1, label: "Slot 1 (Trái)" },
  { value: 2, label: "Slot 2 (Giữa)" },
  { value: 3, label: "Slot 3 (Phải)" },
];

/**
 * Validates whether a value is a valid CharacterSlot (1 | 2 | 3).
 */
export function isValidCharacterSlot(slot: unknown): slot is CharacterSlot {
  return slot === 1 || slot === 2 || slot === 3;
}

/**
 * Parses an agentVersion string and detects whether it contains an exact
 * capability token within its SemVer build metadata.
 *
 * Requirements:
 * - Build metadata appears after the first '+' delimiter.
 * - Build metadata may contain dot-separated identifiers (e.g. 0.1.0+sha.abcd.visual-qol-v1).
 * - Exact token equality is required (no arbitrary substring or prefix/suffix containment).
 * - Malformed, missing, null, undefined, or "unknown" versions return false.
 */
export function hasBuildMetadataToken(
  agentVersion: string | null | undefined,
  targetToken: string,
): boolean {
  if (typeof agentVersion !== "string") {
    return false;
  }
  const trimmed = agentVersion.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return false;
  }

  const plusIndex = trimmed.indexOf("+");
  if (plusIndex === -1) {
    return false;
  }

  // Ensure there is only one '+' separating build metadata per SemVer spec
  const secondPlus = trimmed.indexOf("+", plusIndex + 1);
  if (secondPlus !== -1) {
    return false;
  }

  const versionPart = trimmed.slice(0, plusIndex).trim();
  const buildMetadata = trimmed.slice(plusIndex + 1).trim();

  if (!versionPart || !buildMetadata) {
    return false;
  }

  // Check each dot-separated identifier for exact token match
  const identifiers = buildMetadata.split(".").map((id) => id.trim());
  return identifiers.some((token) => token === targetToken);
}

/**
 * Parses an agentVersion string and detects whether it contains the exact
 * `character-slot-v1` capability token within its SemVer build metadata.
 */
export function hasCharacterSlotCapability(agentVersion: string | null | undefined): boolean {
  return hasBuildMetadataToken(agentVersion, CHARACTER_SLOT_CAPABILITY_TOKEN);
}

/**
 * Parses an agentVersion string and detects whether it contains the exact
 * `visual-qol-v1` capability token within its SemVer build metadata.
 */
export function hasVisualQoLCapability(agentVersion: string | null | undefined): boolean {
  return hasBuildMetadataToken(agentVersion, VISUAL_QOL_CAPABILITY_TOKEN);
}

/**
 * Evaluates whether a device is currently online and fresh within DEVICE_FRESHNESS_THRESHOLD_MS (5 min).
 */
export function isDeviceOnlineAndFresh(
  device: Device | null | undefined,
  now = Date.now(),
): boolean {
  if (!device) {
    return false;
  }

  // 1. Device must be strictly online
  if (device.status !== "online") {
    return false;
  }

  // 2. Device must have a recorded lastSeen timestamp
  if (typeof device.lastSeen !== "number" || !Number.isFinite(device.lastSeen)) {
    return false;
  }

  // 3. Heartbeat must be within the freshness threshold
  const age = now - device.lastSeen;
  if (age > DEVICE_FRESHNESS_THRESHOLD_MS || age < -60_000) {
    return false;
  }

  return true;
}

/**
 * Evaluates whether a device is currently capable, online, and fresh enough
 * to safely select or switch to Character Slot 2 or 3.
 */
export function isCharacterSlotAvailableOnDevice(
  device: Device | null | undefined,
  now = Date.now(),
): boolean {
  if (!isDeviceOnlineAndFresh(device, now)) {
    return false;
  }
  return hasCharacterSlotCapability(device!.agentVersion);
}

/**
 * Evaluates whether a device is currently capable, online, and fresh enough
 * to safely configure or promote Visual QoL (Control v14).
 *
 * Fail-closed conditions:
 * - Device is absent, null, or undefined -> false
 * - Device status is not "online" (offline or error) -> false
 * - Device has never reported a heartbeat (lastSeen === null) -> false
 * - Device heartbeat is older than DEVICE_FRESHNESS_THRESHOLD_MS (5 min) -> false
 * - Device agentVersion does not advertise visual-qol-v1 -> false
 */
export function isVisualQoLAvailableOnDevice(
  device: Device | null | undefined,
  now = Date.now(),
): boolean {
  if (!isDeviceOnlineAndFresh(device, now)) {
    return false;
  }
  return hasVisualQoLCapability(device!.agentVersion);
}

/**
 * Checks whether a given character slot value is supported on the target device.
 * Slot 1 is always supported regardless of runtime or device status.
 * Slot 2 and 3 require verified device capability and freshness.
 */
export function isCharacterSlotSupported(
  slot: number | undefined,
  device: Device | null | undefined,
  now = Date.now(),
): boolean {
  if (slot === undefined || slot === 1) {
    return true;
  }
  if (!isValidCharacterSlot(slot)) {
    return false;
  }
  return isCharacterSlotAvailableOnDevice(device, now);
}

/**
 * Validates a character slot selection attempt in Create or Edit Account flows.
 *
 * Rules:
 * 1. Slot must be a valid integer: 1, 2, or 3.
 * 2. Slot 1 is always permitted regardless of device capability.
 * 3. Slot 2 and Slot 3 are permitted if the device is currently capable and available.
 * 4. If the device is not capable, Slot 2 or 3 is ONLY permitted if it matches the
 *    previously persisted storedSlot (preserving unsupported stored values without silent downgrade).
 * 5. Switching to a new unsupported Slot 2 or 3 is rejected.
 *
 * Returns null if valid, or a concise human-readable error string if invalid.
 */
export function validateCharacterSlotSelection(
  slot: number,
  isCapable: boolean,
  storedSlot?: number,
): string | null {
  if (!isValidCharacterSlot(slot)) {
    return "Vị trí nhân vật không hợp lệ. Vui lòng chọn Slot 1, 2 hoặc 3.";
  }
  if (slot === 1) {
    return null;
  }
  if (isCapable) {
    return null;
  }
  if (storedSlot !== undefined && slot === storedSlot) {
    return null;
  }
  return `Máy chủ hiện tại chưa hỗ trợ ${CHARACTER_SLOT_LABELS[slot]}. Vui lòng chọn Slot 1 hoặc cập nhật runtime mới.`;
}


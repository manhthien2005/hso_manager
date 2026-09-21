/**
 * Pure Utility and Business Rules for Auto Farm Workflows (Round 4B).
 *
 * Responsibilities:
 * 1. Preset name normalization and client-side duplicate validation.
 * 2. Materialization of presets, runtime position, and scan candidates into draft updates.
 * 3. Telemetry availability checks.
 * 4. Scan correlation and retained scan freshness evaluation.
 *
 * Critical Guarantees:
 * - Location workflows never modify attack mode or unrelated fields.
 * - Captured zone metadata is preserved on preset/candidate/telemetry materialization.
 * - Retained scans are scoped to current runtime map and fresh TTL (< 300s).
 */

import type { ConfigPath, ConfigValue } from "@/lib/config-schema";
import type {
  FarmSpot,
  PlayerSnapshot,
  SpotScanCandidate,
  SpotScanSnapshot,
} from "@/lib/types";

/** Timeout in milliseconds before local pending scan expires and resets UI. */
export const DETECT_SPOTS_TIMEOUT_MS = 5000;

/** Retained scan freshness time-to-live in milliseconds (300 seconds). */
export const RETAINED_SCAN_TTL_MS = 300_000;

export interface PresetNameValidationResult {
  valid: boolean;
  error?: string;
  normalizedName: string;
}

/**
 * Validates and normalizes a preset name.
 * - Trims whitespace.
 * - Must be non-empty.
 * - Must not exceed 48 characters.
 * - Case-insensitive duplicate check against existing presets on the same map.
 * - When editing an existing preset, excludes currentSpotId from duplicate check.
 */
export function validatePresetName(
  name: string,
  existingSpots: readonly FarmSpot[],
  mapId: number,
  currentSpotId?: string,
): PresetNameValidationResult {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    return {
      valid: false,
      error: "Tên mẫu không được để trống",
      normalizedName,
    };
  }

  if (normalizedName.length > 48) {
    return {
      valid: false,
      error: "Tên mẫu không được vượt quá 48 ký tự",
      normalizedName,
    };
  }

  const isDuplicate = existingSpots.some((spot) => {
    if (spot.mapId !== mapId) return false;
    if (currentSpotId && spot.id === currentSpotId) return false;
    return spot.name.trim().toLowerCase() === normalizedName.toLowerCase();
  });

  if (isDuplicate) {
    return {
      valid: false,
      error: `Mẫu "${normalizedName}" đã tồn tại trên map này`,
      normalizedName,
    };
  }

  return {
    valid: true,
    normalizedName,
  };
}

/**
 * Checks whether runtime telemetry contains a valid current position.
 * Requires:
 * - snapshot present
 * - non-negative map number
 * - non-negative px and py world coordinates (non-NaN)
 */
export function isCurrentPositionAvailable(
  snapshot?: PlayerSnapshot | null,
): boolean {
  if (!snapshot) return false;
  if (
    typeof snapshot.map !== "number" ||
    Number.isNaN(snapshot.map) ||
    snapshot.map < 0
  ) {
    return false;
  }
  if (
    typeof snapshot.px !== "number" ||
    Number.isNaN(snapshot.px) ||
    snapshot.px < 0
  ) {
    return false;
  }
  if (
    typeof snapshot.py !== "number" ||
    Number.isNaN(snapshot.py) ||
    snapshot.py < 0
  ) {
    return false;
  }
  return true;
}

/**
 * Materializes a saved FarmSpot into partial draft updates.
 * Copies: atk.map, atk.x, atk.y, atk.zone.
 * Preserves capturedZone from the preset (does NOT reset to -1).
 * Does NOT touch atk.mode or any other field.
 */
export function materializePreset(
  spot: FarmSpot,
): Partial<Record<ConfigPath, ConfigValue>> {
  return {
    "atk.map": spot.mapId,
    "atk.x": spot.x,
    "atk.y": spot.y,
    "atk.zone": spot.capturedZone ?? -1,
  };
}

/**
 * Materializes player snapshot telemetry into partial draft updates.
 * Copies: snapshot.map to atk.map, snapshot.px to atk.x, snapshot.py to atk.y.
 * Copies snapshot.zone to atk.zone if >= 0, else -1.
 * Does NOT touch atk.mode or any other field.
 */
export function materializeCurrentPosition(
  snapshot: PlayerSnapshot,
): Partial<Record<ConfigPath, ConfigValue>> {
  const zone =
    typeof snapshot.zone === "number" &&
    !Number.isNaN(snapshot.zone) &&
    snapshot.zone >= 0
      ? snapshot.zone
      : -1;

  return {
    "atk.map": snapshot.map,
    "atk.x": snapshot.px,
    "atk.y": snapshot.py,
    "atk.zone": zone,
  };
}

/**
 * Materializes a detected spot candidate into partial draft updates.
 * Copies: mapId to atk.map, candidate.x to atk.x, candidate.y to atk.y,
 * capturedZone from scan result to atk.zone.
 * Does NOT touch atk.mode or any other field.
 */
export function materializeCandidate(
  mapId: number,
  capturedZone: number,
  candidate: SpotScanCandidate,
): Partial<Record<ConfigPath, ConfigValue>> {
  return {
    "atk.map": mapId,
    "atk.x": candidate.x,
    "atk.y": candidate.y,
    "atk.zone": capturedZone,
  };
}

/**
 * Determines whether a retained scan result from snapshot is still fresh and usable.
 * Rules:
 * - Must not be undefined or null.
 * - Retained "pending" is never shown as a spinner on reload (returns false).
 * - Status must be "completed" or "empty".
 * - If current runtime map is known, scan mapId must match current runtime map.
 * - If detectedAt is present, age must be less than RETAINED_SCAN_TTL_MS (300s).
 */
export function isRetainedScanFresh(
  spotScan?: SpotScanSnapshot | null,
  currentMapId?: number | null,
  now: number = Date.now(),
): boolean {
  if (!spotScan) return false;
  if (spotScan.status === "pending") return false;
  if (spotScan.status !== "completed" && spotScan.status !== "empty") {
    return false;
  }

  if (
    currentMapId !== undefined &&
    currentMapId !== null &&
    currentMapId >= 0
  ) {
    if (spotScan.mapId !== undefined && spotScan.mapId !== currentMapId) {
      return false;
    }
  }

  if (spotScan.detectedAt !== undefined && spotScan.detectedAt > 0) {
    if (now - spotScan.detectedAt >= RETAINED_SCAN_TTL_MS) {
      return false;
    }
  }

  return true;
}

export interface ScanCorrelationResult {
  isPending: boolean;
  isMatched: boolean;
  result?: SpotScanSnapshot;
}

/**
 * Correlates runtime snapshot spotScan with local pending request.
 * - When livePendingScanId is set:
 *   - Only matches if spotScan.scanId === livePendingScanId.
 *   - If matched and status is completed/empty/timeout/error: resolves pending.
 *   - If mismatched or no scan: keeps pending true, hides mismatched result.
 * - When no live pending request:
 *   - isMatched is false, isPending is false, returns spotScan as potential retained candidate.
 */
export function correlateScanResult(
  livePendingScanId: string | null,
  spotScan?: SpotScanSnapshot | null,
): ScanCorrelationResult {
  if (livePendingScanId) {
    if (spotScan && spotScan.scanId === livePendingScanId) {
      const isPending = spotScan.status === "pending";
      return {
        isMatched: true,
        isPending,
        result: spotScan,
      };
    }
    // Mismatched or absent scan does not satisfy the pending request.
    // Hide previous retained result while a new live request is pending.
    return {
      isMatched: false,
      isPending: true,
      result: undefined,
    };
  }

  return {
    isMatched: false,
    isPending: false,
    result: spotScan ?? undefined,
  };
}

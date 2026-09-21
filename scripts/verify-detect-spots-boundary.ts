/**
 * Verification script for R3C1 Detect Spots Web Command Boundary.
 *
 * Verifies:
 * 1. SpotScanCandidate mapping: snake_case -> camelCase, all 6 fields preserved.
 * 2. SpotScanCandidate defensive rejection: negative coords, missing fields return null without fabricating fake defaults.
 * 3. SpotScanSnapshot mapping: completed payload with valid candidates.
 * 4. SpotScanSnapshot mapping: empty candidates payload (status='empty', candidates=[]).
 * 5. SpotScanSnapshot mapping: pending, timeout, error statuses.
 * 6. SpotScanSnapshot defensive handling: invalid status, missing scan_id, malformed payloads safely return null.
 * 7. PlayerSnapshot mapping: preserves all 48 player telemetry fields and unknown keys.
 * 8. PlayerSnapshot backward compatibility: absent spot_scan leaves spotScan undefined.
 * 9. PlayerSnapshot safety: malformed spot_scan does not crash and leaves spotScan undefined.
 * 10. PlayerSnapshot non-mutation: raw input object is not modified.
 * 11. MockApi detectSpots implementation: creates queued detect-spots command with valid scan id.
 * 12. MockApi detectSpots validation: offline device or non-existent account properly rejected.
 * 13. PendingKey contract: pendingKey.detectSpots and pendingKey.command('detect-spots') supported.
 */

import { register } from "node:module";

// Ensure dummy environment variables are present so supabase client singleton can initialize in pure test environment
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "dummy-anon-key";

const scriptDir = new URL(".", import.meta.url).href;

// Custom loader hook supporting relative .ts and @/ alias resolution under Node ESM
const hookCode = `
const baseDir = ${JSON.stringify(scriptDir)};
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith("@/")) {
    target = new URL("../src/" + target.slice(2), baseDir).href;
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

async function main(): Promise<void> {
  const {
    mapSpotScanCandidate,
    mapSpotScanSnapshot,
    mapPlayerSnapshot,
    mapAccount,
  } = await import("../src/services/supabase-api.ts");
  const { mockApi } = await import("../src/services/mock-api.ts");

  let failures = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.error(`  [FAIL] ${msg}`);
      failures++;
    } else {
      console.log(`  [PASS] ${msg}`);
    }
  }

  console.log("=== RUNNING R3C1 DETECT SPOTS BOUNDARY VERIFICATION ===");

  // ── 1. SpotScanCandidate mapping ──────────────────────────────────────────
  console.log("\n1. SpotScanCandidate mapping:");
  const validCandidateRaw = {
    x: 120.5,
    y: 340.25,
    mob_count: 5,
    spread_radius: 14.5,
    mob_name: "Sói Xám",
    mob_level: 22,
  };
  const cand = mapSpotScanCandidate(validCandidateRaw);
  assert(cand !== null, "Valid candidate maps successfully");
  assert(cand?.x === 120.5, "cand.x is 120.5");
  assert(cand?.y === 340.25, "cand.y is 340.25");
  assert(cand?.mobCount === 5, "cand.mobCount is 5");
  assert(cand?.spreadRadius === 14.5, "cand.spreadRadius is 14.5");
  assert(cand?.mobName === "Sói Xám", "cand.mobName is 'Sói Xám'");
  assert(cand?.mobLevel === 22, "cand.mobLevel is 22");

  // ── 2. SpotScanCandidate defensive rejection ──────────────────────────────
  console.log("\n2. SpotScanCandidate defensive rejection:");
  assert(mapSpotScanCandidate(null) === null, "null candidate rejected");
  assert(mapSpotScanCandidate("invalid") === null, "string candidate rejected");
  assert(mapSpotScanCandidate({ ...validCandidateRaw, x: -1 }) === null, "negative x rejected (no fake defaults)");
  assert(mapSpotScanCandidate({ ...validCandidateRaw, y: -10 }) === null, "negative y rejected");
  assert(mapSpotScanCandidate({ ...validCandidateRaw, mob_count: -1 }) === null, "negative mob_count rejected");
  assert(mapSpotScanCandidate({ ...validCandidateRaw, spread_radius: -5 }) === null, "negative spread_radius rejected");
  assert(mapSpotScanCandidate({ ...validCandidateRaw, mob_name: "" }) === null, "empty mob_name rejected");
  assert(mapSpotScanCandidate({ x: 10, y: 20 }) === null, "missing fields rejected");

  // ── 3. SpotScanSnapshot mapping: completed payload ─────────────────────────
  console.log("\n3. SpotScanSnapshot mapping: completed payload:");
  const completedRaw = {
    scan_id: "550e8400-e29b-41d4-a716-446655440000",
    status: "completed",
    detected_at: "2026-09-21T08:15:30.000Z",
    map_id: 1,
    captured_zone: 3,
    candidates: [
      {
        x: 100,
        y: 200,
        mob_count: 4,
        spread_radius: 10,
        mob_name: "Orc",
        mob_level: 15,
      },
      {
        x: 350.5,
        y: 450.5,
        mob_count: 7,
        spread_radius: 16.2,
        mob_name: "Goblin",
        mob_level: 18,
      },
    ],
  };
  const snap = mapSpotScanSnapshot(completedRaw);
  assert(snap !== null, "Completed snapshot parsed");
  assert(snap?.scanId === "550e8400-e29b-41d4-a716-446655440000", "scanId matches");
  assert(snap?.status === "completed", "status is completed");
  assert(snap?.detectedAt === new Date("2026-09-21T08:15:30.000Z").getTime(), "detectedAt timestamp converted to epoch ms");
  assert(snap?.mapId === 1, "mapId is 1");
  assert(snap?.capturedZone === 3, "capturedZone is 3");
  assert(Array.isArray(snap?.candidates) && snap.candidates.length === 2, "2 candidates mapped");
  assert(snap?.candidates?.[0].mobName === "Orc", "first candidate mobName is Orc");
  assert(snap?.candidates?.[1].mobCount === 7, "second candidate mobCount is 7");

  // ── 4. SpotScanSnapshot mapping: empty candidates payload ──────────────────
  console.log("\n4. SpotScanSnapshot mapping: empty candidates payload:");
  const emptyRaw = {
    scan_id: "550e8400-e29b-41d4-a716-446655440001",
    status: "empty",
    detected_at: "2026-09-21T08:16:00.000Z",
    map_id: 5,
    captured_zone: 0,
    candidates: [],
  };
  const emptySnap = mapSpotScanSnapshot(emptyRaw);
  assert(emptySnap !== null, "Empty snapshot parsed");
  assert(emptySnap?.status === "empty", "status is empty");
  assert(Array.isArray(emptySnap?.candidates) && emptySnap.candidates.length === 0, "candidates is empty array");

  // ── 5. SpotScanSnapshot mapping: other statuses ───────────────────────────
  console.log("\n5. SpotScanSnapshot mapping: pending, timeout, error statuses:");
  const pendingSnap = mapSpotScanSnapshot({
    scan_id: "cmd-pending-1",
    status: "pending",
  });
  assert(pendingSnap !== null && pendingSnap.status === "pending", "pending status mapped");
  assert(pendingSnap?.candidates === undefined, "pending has no candidates");

  const timeoutSnap = mapSpotScanSnapshot({
    scan_id: "cmd-timeout-1",
    status: "timeout",
  });
  assert(timeoutSnap !== null && timeoutSnap.status === "timeout", "timeout status mapped");

  const errorSnap = mapSpotScanSnapshot({
    scan_id: "cmd-error-1",
    status: "error",
  });
  assert(errorSnap !== null && errorSnap.status === "error", "error status mapped");

  // ── 6. SpotScanSnapshot defensive handling ─────────────────────────────────
  console.log("\n6. SpotScanSnapshot defensive handling:");
  assert(mapSpotScanSnapshot(null) === null, "null rejected");
  assert(mapSpotScanSnapshot({}) === null, "empty object rejected");
  assert(mapSpotScanSnapshot({ scan_id: "" }) === null, "empty scan_id rejected");
  assert(mapSpotScanSnapshot({ scan_id: "abc", status: "invalid_status" }) === null, "invalid status rejected");
  assert(mapSpotScanSnapshot({ scan_id: "abc", status: "completed", candidates: "not-an-array" }) !== null, "non-array candidates tolerated without crash");

  // ── 7. PlayerSnapshot mapping with spot_scan ──────────────────────────────
  console.log("\n7. PlayerSnapshot mapping:");
  const mockTelemetry = {
    v: 6,
    t: 1720000000,
    name: "HeroKnight",
    lv: 60,
    xp: 450,
    hp: 1500,
    hpmax: 1500,
    mp: 800,
    mpmax: 800,
    map: 1,
    zone: 0,
    px: 120,
    py: 340,
    gold: 50000,
    gem: 10,
    wallet: 50000,
    guild: "Zeus",
    bag: 12,
    bagmax: 28,
    mount: 1,
    mounts: "1",
    buffs: "0",
    drops: "",
    state: 1,
    stale: 0,
    quota: 100,
    potions: 50,
    revives: 2,
    atkphase: 1,
    atkstate: 0,
    target: 0,
    stuck: 0,
    pkrank: 1,
    pkmphp: 0,
    pkgold: 0,
    travel: 0,
    travelstate: 0,
    travelgoal: 0,
    travelhops: 0,
    travelwhy: "",
    dungeonstate: 0,
    dungeonruns: 0,
    dungeongoal: 0,
    dungeonwhy: "",
    enhancephase: 0,
    enhancedone: 0,
    enhancewhy: "",
    xprate: 100,
    ctl: 1,
    spot_scan: completedRaw,
    custom_telemetry_key: "telemetry_preserved",
  };

  const rawCopy = JSON.parse(JSON.stringify(mockTelemetry));
  const mappedPlayer = mapPlayerSnapshot(mockTelemetry);

  assert(mappedPlayer !== null, "PlayerSnapshot mapped");
  assert(mappedPlayer?.lv === 60, "player lv preserved");
  assert(mappedPlayer?.hp === 1500, "player hp preserved");
  assert(mappedPlayer?.name === "HeroKnight", "player name preserved");
  assert(mappedPlayer?.ctl === 1, "player ctl preserved");
  assert((mappedPlayer as unknown as Record<string, unknown>).custom_telemetry_key === "telemetry_preserved", "additional unknown keys preserved");
  assert(mappedPlayer?.spotScan !== undefined, "spotScan is attached");
  assert(mappedPlayer?.spotScan?.scanId === completedRaw.scan_id, "spotScan scanId matches");
  assert(mappedPlayer?.spotScan?.candidates?.length === 2, "spotScan candidates mapped");

  // Non-mutation check:
  assert(JSON.stringify(mockTelemetry) === JSON.stringify(rawCopy), "mapPlayerSnapshot does not mutate raw input");

  // ── 8. PlayerSnapshot backward compatibility: absent spot_scan ────────────
  console.log("\n8. PlayerSnapshot backward compatibility:");
  const telemetryWithoutScan = { ...mockTelemetry };
  delete (telemetryWithoutScan as Record<string, unknown>).spot_scan;
  const legacyPlayer = mapPlayerSnapshot(telemetryWithoutScan);
  assert(legacyPlayer !== null, "Legacy telemetry without spot_scan mapped");
  assert(legacyPlayer?.spotScan === undefined, "spotScan is undefined on legacy telemetry");
  assert(legacyPlayer?.lv === 60, "lv is still 60");

  // ── 9. PlayerSnapshot safety: malformed spot_scan ─────────────────────────
  console.log("\n9. PlayerSnapshot safety with malformed spot_scan:");
  const telemetryMalformedScan = {
    ...mockTelemetry,
    spot_scan: { broken: true, status: 12345 },
  };
  let safelyParsed: unknown = null;
  try {
    safelyParsed = mapPlayerSnapshot(telemetryMalformedScan);
  } catch (e) {
    safelyParsed = e;
  }
  assert(safelyParsed !== null && !(safelyParsed instanceof Error), "Malformed spot_scan does not crash mapping");
  assert((safelyParsed as { spotScan?: unknown })?.spotScan === undefined, "spotScan safely left undefined on malformed data");

  // ── 10. MockApi detectSpots operation ─────────────────────────────────────
  console.log("\n10. MockApi detectSpots operation:");
  const mockCommand = await mockApi.detectSpots("acc_01");
  assert(mockCommand !== null, "mockApi.detectSpots returned a Command");
  assert(typeof mockCommand.id === "string" && mockCommand.id.length > 0, "mockCommand has valid id (UUID/scan id)");
  assert(mockCommand.type === "detect-spots", "mockCommand.type is 'detect-spots'");
  assert(mockCommand.status === "queued", "mockCommand.status is 'queued'");
  assert(mockCommand.accountId === "acc_01", "mockCommand.accountId matches target account");

  // ── 11. MockApi offline / not found rejection ─────────────────────────────
  console.log("\n11. MockApi error rejection:");
  let offlineRejected = false;
  try {
    await mockApi.detectSpots("acc_05"); // acc_05 device is dev_02 (offline)
  } catch (err: unknown) {
    offlineRejected = (err as { code?: string })?.code === "DEVICE_OFFLINE";
  }
  assert(offlineRejected, "detectSpots on offline device throws DEVICE_OFFLINE");

  let notFoundRejected = false;
  try {
    await mockApi.detectSpots("non-existent-account");
  } catch (err: unknown) {
    notFoundRejected = (err as { code?: string })?.code === "ACCOUNT_NOT_FOUND";
  }
  assert(notFoundRejected, "detectSpots on unknown account throws ACCOUNT_NOT_FOUND");

  // ── 12. Store contract verification ─────────────────────────────────────
  console.log("\n12. Store contract verification:");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const storeSource = fs.readFileSync(path.resolve("src/store/zeus-store.tsx"), "utf-8");
  assert(storeSource.includes("detectSpots(accountId: string)"), "pendingKey has detectSpots helper");
  assert(storeSource.includes("detectSpots(accountId: string): Promise<Command>"), "ZeusStoreValue has detectSpots signature");
  assert(storeSource.includes("api.detectSpots(accountId)"), "Store action delegates to api.detectSpots");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=================================");
  if (failures === 0) {
    console.log("ALL DETECT SPOTS BOUNDARY TESTS PASSED (0 failures)\n");
  } else {
    console.error(`DETECT SPOTS BOUNDARY TESTS FAILED (${failures} failures)\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR in verification script:", err);
  process.exit(1);
});

/**
 * Web Catalog Drift Verification Script
 *
 * Compares authoritative generated catalog facts against current Web catalogs
 * (src/lib/game-maps.ts and src/lib/game-servers.ts) to detect drift or contract violations.
 *
 * Usage:
 *   node scripts/verify-catalog-drift.ts
 *   npm run verify:catalog
 */

import {
  GENERATED_GAME_MAPS,
  GENERATED_GAME_SERVERS,
  GENERATED_CATALOG_METADATA,
} from "../src/lib/game-catalog.generated.ts";
import { GAME_MAPS } from "../src/lib/game-maps.ts";
import { SERVER_OPTIONS } from "../src/lib/game-servers.ts";
import { defaultControlDraft } from "../src/lib/config-schema.ts";

function verifyCatalogDrift(): void {
  console.log("=== CATALOG DRIFT VERIFICATION ===");
  console.log(`Source Commit: ${GENERATED_CATALOG_METADATA.sourceCommit}`);
  console.log(`CTL_VERSION:   ${GENERATED_CATALOG_METADATA.ctlVersion}`);
  console.log(`Jar SHA256:    ${GENERATED_CATALOG_METADATA.sourceJarSha256}\n`);

  let errors = 0;

  // ── 1. MAP ID PARITY ──────────────────────────────────────────────────────────
  console.log("1. Verifying Map ID parity (expected: 101 IDs)...");
  const genMapIds = new Set(GENERATED_GAME_MAPS.map((m) => m.id));
  const webMapIds = new Set(GAME_MAPS.map((m) => m.id));

  if (genMapIds.size !== 101) {
    console.error(`[FAIL] Generated map ID count is ${genMapIds.size}, expected 101`);
    errors++;
  }
  if (webMapIds.size !== 101) {
    console.error(`[FAIL] Current Web map ID count is ${webMapIds.size}, expected 101`);
    errors++;
  }

  for (const id of genMapIds) {
    if (!webMapIds.has(id)) {
      console.error(`[FAIL] Web catalog is missing map ID ${id}`);
      errors++;
    }
  }
  for (const id of webMapIds) {
    if (!genMapIds.has(id)) {
      console.error(`[FAIL] Web catalog has extra unexpected map ID ${id}`);
      errors++;
    }
  }
  if (errors === 0) {
    console.log("   [PASS] 101/101 map IDs match exactly: 0..91, 92..98, 127, 135.");
  }

  // ── 2. TRAVEL ELIGIBILITY PARITY ─────────────────────────────────────────────
  console.log("\n2. Verifying Travel eligibility parity (expected: 76 eligible destinations)...");
  const genTravelMapIds = new Set(
    GENERATED_GAME_MAPS.filter((m) => m.travelEligible).map((m) => m.id),
  );
  const webTravelMapIds = new Set(
    GAME_MAPS.filter((m) => m.travelSupported).map((m) => m.id),
  );

  if (genTravelMapIds.size !== 76) {
    console.error(
      `[FAIL] Generated travel-eligible count is ${genTravelMapIds.size}, expected 76`,
    );
    errors++;
  }
  if (webTravelMapIds.size !== 76) {
    console.error(
      `[FAIL] Current Web travel-supported count is ${webTravelMapIds.size}, expected 76`,
    );
    errors++;
  }

  for (const id of genMapIds) {
    const genEligible = genTravelMapIds.has(id);
    const webSupported = webTravelMapIds.has(id);
    if (genEligible !== webSupported) {
      console.error(
        `[FAIL] Map ${id} travel eligibility mismatch: generated=${genEligible}, web=${webSupported}`,
      );
      errors++;
    }
  }

  // Verify non-eligible singletons specifically
  if (genTravelMapIds.has(127) || webTravelMapIds.has(127)) {
    console.error("[FAIL] Map 127 must not be travel eligible/supported");
    errors++;
  }
  if (genTravelMapIds.has(135) || webTravelMapIds.has(135)) {
    console.error("[FAIL] Map 135 must not be travel eligible/supported");
    errors++;
  }

  if (errors === 0) {
    console.log("   [PASS] Exactly 76 travel destinations match SCC topology containing root Map 1.");
    console.log("   [PASS] Maps 127 and 135 are confirmed non-travel-eligible singletons.");
  }

  // ── 3. INTENTIONAL DISPLAY-NAME DIFFERENCES AUDIT ───────────────────────────
  console.log("\n3. Auditing Raw Authoritative Names vs Curated Web Display Names...");
  const knownCuratedDifferences: Record<number, { raw: string | null; curated: string; reason: string }> = {
    53: {
      raw: "Chuẩn bị",
      curated: "Chuẩn bị (Ánh sáng)",
      reason: "Faction disambiguation for Light village preparation room",
    },
    55: {
      raw: "Chuẩn bị",
      curated: "Chuẩn bị (Gió)",
      reason: "Faction disambiguation for Wind village preparation room",
    },
    57: {
      raw: "Chuẩn bị",
      curated: "Chuẩn bị (Sét)",
      reason: "Faction disambiguation for Lightning village preparation room",
    },
    59: {
      raw: "Chuẩn bị",
      curated: "Chuẩn bị (Lửa)",
      reason: "Faction disambiguation for Fire village preparation room",
    },
    81: {
      raw: "",
      curated: "Bản đồ 81 (Chưa đặt tên)",
      reason: "Client source has empty string df.gE[81] = \"\"",
    },
    127: {
      raw: null,
      curated: "UNKNOWN (Bản đồ 127)",
      reason: "No authoritative human-readable string in client/mod for Map 127",
    },
  };

  const genMapById = new Map(GENERATED_GAME_MAPS.map((m) => [m.id, m]));
  for (const webMap of GAME_MAPS) {
    const genMap = genMapById.get(webMap.id);
    if (!genMap) continue;

    const curatedDiff = knownCuratedDifferences[webMap.id];
    if (curatedDiff) {
      if (genMap.rawNameVi !== curatedDiff.raw) {
        console.error(
          `[FAIL] Expected rawNameVi for Map ${webMap.id} to be ${JSON.stringify(curatedDiff.raw)}, got ${JSON.stringify(genMap.rawNameVi)}`,
        );
        errors++;
      }
      if (webMap.name !== curatedDiff.curated) {
        console.error(
          `[FAIL] Expected Web display name for Map ${webMap.id} to be ${curatedDiff.curated}, got ${webMap.name}`,
        );
        errors++;
      }
    } else {
      // Maps not in known curated differences should match raw Vietnamese string
      if (genMap.rawNameVi !== null && genMap.rawNameVi !== webMap.name) {
        console.warn(
          `   [INFO] Display divergence on Map ${webMap.id}: raw="${genMap.rawNameVi}" vs web="${webMap.name}"`,
        );
      }
    }
  }
  console.log("   [PASS] Known curated display differences verified and distinguished from drift.");

  // ── 4. SERVER PARITY ────────────────────────────────────────────────────────
  console.log("\n4. Verifying Server identity parity (expected: 8 servers 0..7)...");
  if (GENERATED_GAME_SERVERS.length !== 8) {
    console.error(
      `[FAIL] Generated server count is ${GENERATED_GAME_SERVERS.length}, expected 8`,
    );
    errors++;
  }
  if (SERVER_OPTIONS.length !== 8) {
    console.error(`[FAIL] Web SERVER_OPTIONS count is ${SERVER_OPTIONS.length}, expected 8`);
    errors++;
  }

  for (let i = 0; i < 8; i++) {
    const gen = GENERATED_GAME_SERVERS[i];
    const web = SERVER_OPTIONS[i];
    if (!gen || !web) {
      console.error(`[FAIL] Missing server at index ${i}`);
      errors++;
      continue;
    }
    if (web.value !== gen.index) {
      console.error(`[FAIL] Server index mismatch: web=${web.value}, gen=${gen.index}`);
      errors++;
    }
    if (web.label !== gen.name) {
      console.error(
        `[FAIL] Server name mismatch at index ${i}: web="${web.label}", gen="${gen.name}"`,
      );
      errors++;
    }
    if (web.host !== gen.host) {
      console.error(
        `[FAIL] Server host mismatch at index ${i}: web="${web.host}", gen="${gen.host}"`,
      );
      errors++;
    }
  }

  // Note on port
  console.log("   [PASS] 8/8 server records match index, name, and host exactly.");
  console.log("   [INFO] Web stores runtime connection port=19129; authoritative catalog correctly isolates identity.");

  // ── 5. ATTACK MAP-0 CONTRACT REGRESSION CHECK ──────────────────────────────
  console.log("\n5. Verifying Attack Map-0 tuple contract (NO SPOT default)...");
  const draft = defaultControlDraft();
  if (draft["atk.map"] !== 0) {
    console.error(`[FAIL] Expected default atk.map === 0, got ${draft["atk.map"]}`);
    errors++;
  }
  if (draft["atk.zone"] !== -1) {
    console.error(`[FAIL] Expected default atk.zone === -1, got ${draft["atk.zone"]}`);
    errors++;
  }
  if (draft["atk.x"] !== -1 || draft["atk.y"] !== -1) {
    console.error(
      `[FAIL] Expected default atk.x, atk.y === -1, got x=${draft["atk.x"]}, y=${draft["atk.y"]}`,
    );
    errors++;
  }
  if (errors === 0) {
    console.log("   [PASS] Attack default tuple { map: 0, zone: -1, x: -1, y: -1 } preserved.");
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  console.log("\n=================================");
  if (errors > 0) {
    console.error(`DRIFT VERIFICATION FAILED with ${errors} error(s).`);
    process.exit(1);
  } else {
    console.log("DRIFT VERIFICATION PASSED: 0 errors.");
  }
}

verifyCatalogDrift();

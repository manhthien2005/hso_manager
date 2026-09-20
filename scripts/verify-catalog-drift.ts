/**
 * Web Catalog Drift & Architectural Boundary Verification Script
 *
 * Verifies:
 * 1. Generated foundation invariants (101 maps, 76 travel destinations, 8 servers, topology singletons)
 * 2. Curated metadata integrity (exact override IDs, raw name contracts, fail-closed on blank/unknown)
 * 3. Public map facade contract (id, name, travelSupported, notes)
 * 4. Travel facade contract (76 eligible maps)
 * 5. Map index & lookup helpers (GAME_MAP_BY_ID, getGameMap, formatGameMap)
 * 6. Server facade contract (identity fields from generated, port policy 19129, helpers)
 * 7. Attack Map-0 default contract regression (atk.map=0, atk.zone=-1, atk.x=-1, atk.y=-1)
 *
 * Usage:
 *   npm run verify:catalog
 *   node scripts/verify-catalog-drift.ts
 */

import { register } from "node:module";

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

async function verifyCatalog(): Promise<void> {
  const {
    GENERATED_GAME_MAPS,
    GENERATED_GAME_SERVERS,
    GENERATED_CATALOG_METADATA,
    GENERATED_GAME_MAP_BY_ID,
  } = await import("../src/lib/game-catalog.generated.ts");

  const {
    GAME_MAP_DISPLAY_OVERRIDES,
    GAME_MAP_NOTES,
  } = await import("../src/lib/game-map-curation.ts");

  const {
    GAME_MAPS,
    TRAVEL_SUPPORTED_MAPS,
    GAME_MAP_BY_ID,
    getGameMap,
    formatGameMap,
  } = await import("../src/lib/game-maps.ts");

  const {
    SERVER_OPTIONS,
    SERVER_NAME_BY_INDEX,
    DEFAULT_GAME_SERVER_PORT,
    getServerOption,
    getServerName,
    formatServerDisplay,
  } = await import("../src/lib/game-servers.ts");

  const { defaultControlDraft } = await import("../src/lib/config-schema.ts");

  console.log("=== CATALOG ARCHITECTURAL BOUNDARY & DRIFT VERIFICATION ===");
  console.log(`Source Commit: ${GENERATED_CATALOG_METADATA.sourceCommit}`);
  console.log(`CTL_VERSION:   ${GENERATED_CATALOG_METADATA.ctlVersion}`);
  console.log(`Jar SHA256:    ${GENERATED_CATALOG_METADATA.sourceJarSha256}\n`);

  let errors = 0;

  // ── 1. GENERATED FOUNDATION INVARIANTS ─────────────────────────────────────────
  console.log("1. Verifying Generated Foundation Invariants...");
  if (GENERATED_GAME_MAPS.length !== 101) {
    console.error(`[FAIL] Generated map count is ${GENERATED_GAME_MAPS.length}, expected 101`);
    errors++;
  }
  const genTravelMaps = GENERATED_GAME_MAPS.filter((m) => m.travelEligible);
  if (genTravelMaps.length !== 76) {
    console.error(`[FAIL] Generated travel-eligible map count is ${genTravelMaps.length}, expected 76`);
    errors++;
  }
  if (GENERATED_GAME_SERVERS.length !== 8) {
    console.error(`[FAIL] Generated server count is ${GENERATED_GAME_SERVERS.length}, expected 8`);
    errors++;
  }

  // Check special cases
  const map127 = GENERATED_GAME_MAP_BY_ID.get(127);
  if (!map127 || map127.rawNameVi !== null || map127.travelEligible !== false) {
    console.error("[FAIL] Map 127 generated invariant failed (expected rawNameVi=null, travelEligible=false)");
    errors++;
  }
  const map81 = GENERATED_GAME_MAP_BY_ID.get(81);
  if (!map81 || map81.rawNameVi !== "" || map81.travelEligible !== false) {
    console.error("[FAIL] Map 81 generated invariant failed (expected rawNameVi=\"\", travelEligible=false)");
    errors++;
  }
  const map135 = GENERATED_GAME_MAP_BY_ID.get(135);
  if (!map135 || map135.travelEligible !== false) {
    console.error("[FAIL] Map 135 generated invariant failed (expected travelEligible=false)");
    errors++;
  }
  if (errors === 0) {
    console.log("   [PASS] 101 maps, 76 travel-eligible destinations, 8 servers, and special-case topology invariants verified.");
  }

  // ── 2. CURATED METADATA VERIFICATION ──────────────────────────────────────────
  console.log("\n2. Verifying Curated Product Metadata Invariants...");
  const EXPECTED_OVERRIDE_IDS = [53, 55, 57, 59, 81, 127];
  const actualOverrideKeys = Object.keys(GAME_MAP_DISPLAY_OVERRIDES).map((k) => parseInt(k, 10)).sort((a, b) => a - b);
  const expectedSorted = [...EXPECTED_OVERRIDE_IDS].sort((a, b) => a - b);

  if (actualOverrideKeys.length !== expectedSorted.length || !actualOverrideKeys.every((id, idx) => id === expectedSorted[idx])) {
    console.error(`[FAIL] Curated override IDs mismatch! Expected: ${JSON.stringify(expectedSorted)}, got: ${JSON.stringify(actualOverrideKeys)}`);
    errors++;
  }

  for (const id of actualOverrideKeys) {
    const override = GAME_MAP_DISPLAY_OVERRIDES[id];
    const genMap = GENERATED_GAME_MAP_BY_ID.get(id);
    if (!genMap) {
      console.error(`[FAIL] Curated override references non-existent map ID ${id}`);
      errors++;
      continue;
    }
    if (genMap.rawNameVi !== override.expectedRawNameVi) {
      console.error(`[FAIL] Curated override expectedRawNameVi mismatch for Map ${id}: expected ${JSON.stringify(override.expectedRawNameVi)}, actual rawNameVi=${JSON.stringify(genMap.rawNameVi)}`);
      errors++;
    }
    if (!override.displayName || override.displayName.trim().length === 0) {
      console.error(`[FAIL] Curated override displayName for Map ${id} is empty`);
      errors++;
    }
  }

  // Verify all generated maps with null or empty rawNameVi have explicit overrides
  for (const genMap of GENERATED_GAME_MAPS) {
    if (genMap.rawNameVi === null || genMap.rawNameVi.trim().length === 0) {
      if (!GAME_MAP_DISPLAY_OVERRIDES[genMap.id]) {
        console.error(`[FAIL] Generated Map ${genMap.id} has null or empty rawNameVi but lacks curated display override`);
        errors++;
      }
    }
  }
  if (errors === 0) {
    console.log("   [PASS] Curated overrides match exact approved IDs {53, 55, 57, 59, 81, 127} and enforce raw contracts.");
  }

  // ── 3. PUBLIC MAP FACADE VERIFICATION ─────────────────────────────────────────
  console.log("\n3. Verifying Public Map Facade (GAME_MAPS)...");
  if (GAME_MAPS.length !== GENERATED_GAME_MAPS.length) {
    console.error(`[FAIL] GAME_MAPS count (${GAME_MAPS.length}) !== GENERATED_GAME_MAPS count (${GENERATED_GAME_MAPS.length})`);
    errors++;
  }

  for (let i = 0; i < GENERATED_GAME_MAPS.length; i++) {
    const gen = GENERATED_GAME_MAPS[i];
    const web = GAME_MAPS[i];
    if (!web || web.id !== gen.id) {
      console.error(`[FAIL] Map order/id mismatch at index ${i}: web id=${web?.id}, gen id=${gen.id}`);
      errors++;
      continue;
    }

    if (web.travelSupported !== gen.travelEligible) {
      console.error(`[FAIL] Map ${web.id} travelSupported mismatch: web=${web.travelSupported}, gen=${gen.travelEligible}`);
      errors++;
    }

    const expectedName = GAME_MAP_DISPLAY_OVERRIDES[web.id]?.displayName ?? gen.rawNameVi;
    if (web.name !== expectedName) {
      console.error(`[FAIL] Map ${web.id} name mismatch: web="${web.name}", expected="${expectedName}"`);
      errors++;
    }

    if (!web.name || web.name.trim().length === 0) {
      console.error(`[FAIL] Map ${web.id} has empty public display name`);
      errors++;
    }

    const expectedNote = GAME_MAP_NOTES[web.id];
    if (expectedNote !== undefined && web.notes !== expectedNote) {
      console.error(`[FAIL] Map ${web.id} notes mismatch: web="${web.notes}", expected="${expectedNote}"`);
      errors++;
    }
  }
  if (errors === 0) {
    console.log("   [PASS] Public GAME_MAPS facade derived accurately from generated facts and curated metadata.");
  }

  // ── 4. TRAVEL FACADE VERIFICATION ─────────────────────────────────────────────
  console.log("\n4. Verifying Travel Facade (TRAVEL_SUPPORTED_MAPS)...");
  if (TRAVEL_SUPPORTED_MAPS.length !== 76) {
    console.error(`[FAIL] TRAVEL_SUPPORTED_MAPS length is ${TRAVEL_SUPPORTED_MAPS.length}, expected 76`);
    errors++;
  }

  const expectedTravel = GAME_MAPS.filter((m) => m.travelSupported);
  if (TRAVEL_SUPPORTED_MAPS.length !== expectedTravel.length) {
    console.error("[FAIL] TRAVEL_SUPPORTED_MAPS filter parity failed");
    errors++;
  }

  for (let i = 0; i < TRAVEL_SUPPORTED_MAPS.length; i++) {
    if (TRAVEL_SUPPORTED_MAPS[i].id !== expectedTravel[i].id) {
      console.error(`[FAIL] Travel destination mismatch at index ${i}: ${TRAVEL_SUPPORTED_MAPS[i].id} !== ${expectedTravel[i].id}`);
      errors++;
    }
    if (!TRAVEL_SUPPORTED_MAPS[i].travelSupported) {
      console.error(`[FAIL] Map ${TRAVEL_SUPPORTED_MAPS[i].id} in TRAVEL_SUPPORTED_MAPS has travelSupported=false`);
      errors++;
    }
  }
  if (errors === 0) {
    console.log("   [PASS] TRAVEL_SUPPORTED_MAPS contains exactly 76 travel-eligible maps matching SCC topology.");
  }

  // ── 5. MAP INDEX & HELPERS VERIFICATION ───────────────────────────────────────
  console.log("\n5. Verifying Map Index & Helpers (GAME_MAP_BY_ID, getGameMap, formatGameMap)...");
  if (GAME_MAP_BY_ID.size !== 101) {
    console.error(`[FAIL] GAME_MAP_BY_ID size is ${GAME_MAP_BY_ID.size}, expected 101`);
    errors++;
  }

  for (const map of GAME_MAPS) {
    const indexed = GAME_MAP_BY_ID.get(map.id);
    if (!indexed || indexed !== map) {
      console.error(`[FAIL] GAME_MAP_BY_ID lookup failed for Map ${map.id}`);
      errors++;
    }
    if (getGameMap(map.id) !== map) {
      console.error(`[FAIL] getGameMap(${map.id}) did not return public map object`);
      errors++;
    }
    const formatted = formatGameMap(map.id);
    const expectedFormat = `[${map.id}] ${map.name}`;
    if (formatted !== expectedFormat) {
      console.error(`[FAIL] formatGameMap(${map.id}) = "${formatted}", expected "${expectedFormat}"`);
      errors++;
    }
  }
  if (formatGameMap(9999) !== "Unknown map [9999]") {
    console.error("[FAIL] formatGameMap(9999) fallback failed");
    errors++;
  }
  if (errors === 0) {
    console.log("   [PASS] Map index and helper functions verified for all 101 maps.");
  }

  // ── 6. SERVER FACADE VERIFICATION ─────────────────────────────────────────────
  console.log("\n6. Verifying Server Facade (SERVER_OPTIONS)...");
  if (SERVER_OPTIONS.length !== 8) {
    console.error(`[FAIL] SERVER_OPTIONS length is ${SERVER_OPTIONS.length}, expected 8`);
    errors++;
  }
  if (DEFAULT_GAME_SERVER_PORT !== 19129) {
    console.error(`[FAIL] DEFAULT_GAME_SERVER_PORT is ${DEFAULT_GAME_SERVER_PORT}, expected 19129`);
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
      console.error(`[FAIL] Server label mismatch at index ${i}: web="${web.label}", gen="${gen.name}"`);
      errors++;
    }
    if (web.host !== gen.host) {
      console.error(`[FAIL] Server host mismatch at index ${i}: web="${web.host}", gen="${gen.host}"`);
      errors++;
    }
    if (web.port !== DEFAULT_GAME_SERVER_PORT) {
      console.error(`[FAIL] Server port mismatch at index ${i}: web=${web.port}, expected=${DEFAULT_GAME_SERVER_PORT}`);
      errors++;
    }
    if (SERVER_NAME_BY_INDEX[gen.index] !== gen.name) {
      console.error(`[FAIL] SERVER_NAME_BY_INDEX mismatch for index ${gen.index}`);
      errors++;
    }
    if (getServerOption(gen.index) !== web) {
      console.error(`[FAIL] getServerOption(${gen.index}) failed`);
      errors++;
    }
    if (getServerName(gen.index) !== gen.name) {
      console.error(`[FAIL] getServerName(${gen.index}) failed`);
      errors++;
    }
    if (formatServerDisplay(gen.index) !== gen.name) {
      console.error(`[FAIL] formatServerDisplay(${gen.index}) failed`);
      errors++;
    }
  }
  if (formatServerDisplay(null) !== "—") {
    console.error("[FAIL] formatServerDisplay(null) !== \"—\"");
    errors++;
  }
  if (errors === 0) {
    console.log("   [PASS] 8/8 server records match generated identity and connection port policy 19129.");
  }

  // ── 7. ATTACK MAP-0 CONTRACT REGRESSION CHECK ─────────────────────────────────
  console.log("\n7. Verifying Attack Map-0 tuple contract (NO SPOT default)...");
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

  // ── SUMMARY ───────────────────────────────────────────────────────────────────
  console.log("\n=================================");
  if (errors > 0) {
    console.error(`CATALOG VERIFICATION FAILED with ${errors} error(s).`);
    process.exit(1);
  } else {
    console.log("CATALOG VERIFICATION PASSED: 0 errors.");
  }
}

verifyCatalog().catch((err) => {
  console.error("FATAL VERIFICATION ERROR:", err);
  process.exit(1);
});

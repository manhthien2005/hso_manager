/**
 * Unit tests for Stable Server Catalog and Facade
 * Task: KNIGHT_V403_BACH_HO_R3_CLOUD_WEB_SUPPORT
 *
 * Verifies:
 * 1. Exactly 9 server entries
 * 2. Dense IDs 0..8
 * 3. Legacy 0..7 exact match
 * 4. ID 8 Bạch Hổ New exact match
 * 5. Unique hosts
 * 6. formatServerDisplay(8) returns Bạch Hổ New
 * 7. Invalid server ID (e.g. 9, -1) rejected by isValidServerIndex
 */

import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

describe("Stable Server Catalog & Facade Tests", async () => {
  const {
    STABLE_SERVER_CATALOG,
    STABLE_SERVER_BY_LOGICAL_ID,
    GENERATED_SERVER_CATALOG_METADATA,
  } = await import("../../src/lib/server-catalog.generated");

  const {
    SERVER_OPTIONS,
    SERVER_NAME_BY_INDEX,
    DEFAULT_GAME_SERVER_PORT,
    BACH_HO_LOGICAL_ID,
    isValidServerIndex,
    getServerOption,
    getServerName,
    getServerHost,
    getServerPort,
    getServerLang,
    formatServerDisplay,
  } = await import("../../src/lib/game-servers");

  it("metadata contains required provenance fields", () => {
    assert.equal(GENERATED_SERVER_CATALOG_METADATA.ctlVersion, 15);
    assert.equal(GENERATED_SERVER_CATALOG_METADATA.sourceJarSha256, "c177d9ace4cd2c45fbebb4422c0bec8c8021e81872254e84b3d0960c8c510bd5");
    assert.equal(GENERATED_SERVER_CATALOG_METADATA.sourceCommit, "fab5854a98f5a9febd5ba737ba3ac6fe14656c1a");
    assert.equal(GENERATED_SERVER_CATALOG_METADATA.serverCount, 9);
    assert.ok(GENERATED_SERVER_CATALOG_METADATA.sourceCommit.length >= 7);
  });

  it("contains exactly 9 stable server entries", () => {
    assert.equal(STABLE_SERVER_CATALOG.length, 9);
    assert.equal(SERVER_OPTIONS.length, 9);
    assert.equal(STABLE_SERVER_BY_LOGICAL_ID.size, 9);
  });

  it("logical IDs are dense 0..8", () => {
    for (let i = 0; i < 9; i++) {
      assert.equal(STABLE_SERVER_CATALOG[i].logicalId, i);
      assert.equal(SERVER_OPTIONS[i].value, i);
      assert.ok(isValidServerIndex(i));
    }
  });

  it("preserves exact legacy servers 0..7", () => {
    const expectedLegacy = [
      { logicalId: 0, name: "Chiến Thần", host: "hs1.teamobi.com", port: 19129, lang: 0 },
      { logicalId: 1, name: "Rồng Lửa", host: "hs2.teamobi.com", port: 19129, lang: 0 },
      { logicalId: 2, name: "Global Server", host: "hsglobal.teamobi.com", port: 19129, lang: 1 },
      { logicalId: 3, name: "Phượng Hoàng", host: "hs3.teamobi.com", port: 19129, lang: 0 },
      { logicalId: 4, name: "Nhân Mã", host: "hs5.teamobi.com", port: 19129, lang: 0 },
      { logicalId: 5, name: "Kì Lân", host: "hs6.teamobi.com", port: 19129, lang: 0 },
      { logicalId: 6, name: "Thiên Hà (New)", host: "hs7.teamobi.com", port: 19129, lang: 0 },
      { logicalId: 7, name: "Thách Đấu", host: "hs4.teamobi.com", port: 19129, lang: 0 },
    ];

    for (let i = 0; i < 8; i++) {
      const exp = expectedLegacy[i];
      const actual = STABLE_SERVER_CATALOG[i];
      assert.deepEqual(actual, exp);
      assert.equal(SERVER_OPTIONS[i].label, exp.name);
      assert.equal(SERVER_OPTIONS[i].host, exp.host);
      assert.equal(SERVER_OPTIONS[i].port, exp.port);
      assert.equal(SERVER_OPTIONS[i].lang, exp.lang);
      assert.equal(getServerName(i), exp.name);
      assert.equal(getServerHost(i), exp.host);
      assert.equal(getServerPort(i), exp.port);
      assert.equal(getServerLang(i), exp.lang);
      assert.equal(formatServerDisplay(i), exp.name);
    }
  });

  it("defines logical ID 8 as Bạch Hổ New exact match", () => {
    assert.equal(BACH_HO_LOGICAL_ID, 8);
    const bachHo = STABLE_SERVER_CATALOG[8];
    assert.deepEqual(bachHo, {
      logicalId: 8,
      name: "Bạch Hổ New",
      host: "hs8.teamobi.com",
      port: 19129,
      lang: 0,
    });
    assert.equal(SERVER_OPTIONS[8].label, "Bạch Hổ New");
    assert.equal(SERVER_OPTIONS[8].host, "hs8.teamobi.com");
    assert.equal(SERVER_OPTIONS[8].port, 19129);
    assert.equal(SERVER_OPTIONS[8].lang, 0);
    assert.equal(getServerName(8), "Bạch Hổ New");
    assert.equal(getServerHost(8), "hs8.teamobi.com");
    assert.equal(getServerPort(8), 19129);
    assert.equal(getServerLang(8), 0);
    assert.equal(formatServerDisplay(8), "Bạch Hổ New");
  });

  it("enforces canonical host uniqueness across all 9 servers", () => {
    const hosts = STABLE_SERVER_CATALOG.map((s) => s.host);
    const uniqueHosts = new Set(hosts);
    assert.equal(uniqueHosts.size, 9);
  });

  it("isValidServerIndex rejects out-of-range and invalid values", () => {
    assert.equal(isValidServerIndex(-1), false);
    assert.equal(isValidServerIndex(9), false);
    assert.equal(isValidServerIndex(255), false);
    assert.equal(isValidServerIndex(null), false);
    assert.equal(isValidServerIndex(undefined), false);
    assert.equal(isValidServerIndex("8"), false);
    assert.equal(isValidServerIndex(NaN), false);
    assert.equal(isValidServerIndex(1.5), false);
  });

  it("formatServerDisplay fallback for unknown server IDs", () => {
    assert.equal(formatServerDisplay(null), "—");
    assert.equal(formatServerDisplay(9), "Không xác định (9)");
    assert.equal(formatServerDisplay(999), "Không xác định (999)");
  });
});

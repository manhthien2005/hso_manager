/**
 * Unit tests for Bạch Hổ Runtime Capability Evaluator
 * Task: KNIGHT_V403_BACH_HO_R3_CLOUD_WEB_SUPPORT
 *
 * Verifies:
 * 1. R2.3 SHA + CTL 15 -> capable
 * 2. historical b18... + CTL 15 -> NOT capable
 * 3. R1 bd15... + CTL 15 -> NOT capable
 * 4. unknown SHA + CTL 15 -> NOT capable
 * 5. null/undefined SHA -> NOT capable
 * 6. valid SHA + CTL != 15 -> NOT capable
 * 7. Device-level helper handles null, undefined, and valid devices accurately
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

describe("Bạch Hổ Runtime Capability Evaluator Tests", async () => {
  const {
    BACH_HO_REQUIRED_CTL_VERSION,
    COMPATIBLE_BACH_HO_JAR_SHAS,
    MANAGED_IDENTITY_RESTART_CAPABILITY_TOKEN,
    hasManagedIdentityRestartCapability,
    isBachHoRuntimeCompatible,
    isBachHoSupportedOnDevice,
  } = await import("../../src/lib/capabilities");

  const R2_3_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOVEMENT_FIX_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FORGE_FIX_SHA = "ca3b65038a1416a9fcd7eedc9127a1ba4702d48628b0030fda701ceb77c84dec";
  const OBSOLETE_37D1_SHA = "37d18817d6b9b49fa1c20b1859a2d300272506101d7de7d8cf51ec3dd1f15d14";
  const FAILED_FORGE_CANDIDATE_B2BC_SHA = "b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658";
  const FAILED_FORGE_CANDIDATE_24E9_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const FAILED_FORGE_CANDIDATE_278F_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_FORGE_CANDIDATE_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";
  const OBSOLETE_0BDDA_SHA = "0bddaee4680f8521f4628f4d52399ceee161c4e5d0387eab3dbe48cf662e8216";
  const OBSOLETE_D369_SHA = "d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a";
  const HISTORICAL_B18_SHA = "b18baf709e7c5ecbc0c8b6b1076b1f20b784a9e3e78bdf1b4a2bfec19280d0d1";
  const R1_BD15_SHA = "bd15eea25df4b2aa929ecdf2fcf795ccebeae876f296c0502dc85ec280f33333";

  const VALID_AGENT_VERSION = "0.1.0+character-slot-v1.visual-qol-v1.managed-identity-restart-v1";
  const NO_TOKEN_AGENT_VERSION = "0.1.0+character-slot-v1.visual-qol-v1";
  const NEAR_MATCH_TOKEN_AGENT_VERSION = "0.1.0+managed-identity-restart-v1-beta";

  it("constants are defined accurately", () => {
    assert.equal(BACH_HO_REQUIRED_CTL_VERSION, 15);
    assert.ok(COMPATIBLE_BACH_HO_JAR_SHAS.has(R2_3_SHA));
    assert.ok(COMPATIBLE_BACH_HO_JAR_SHAS.has(MOVEMENT_FIX_SHA));
    assert.ok(COMPATIBLE_BACH_HO_JAR_SHAS.has(FORGE_FIX_SHA));
    assert.ok(!COMPATIBLE_BACH_HO_JAR_SHAS.has(FAILED_FORGE_CANDIDATE_B2BC_SHA));
    assert.ok(!COMPATIBLE_BACH_HO_JAR_SHAS.has(FAILED_FORGE_CANDIDATE_24E9_SHA));
    assert.ok(!COMPATIBLE_BACH_HO_JAR_SHAS.has(FAILED_FORGE_CANDIDATE_278F_SHA));
    assert.ok(!COMPATIBLE_BACH_HO_JAR_SHAS.has(FAILED_FORGE_CANDIDATE_47E4_SHA));
    assert.equal(COMPATIBLE_BACH_HO_JAR_SHAS.size, 3);
    assert.equal(MANAGED_IDENTITY_RESTART_CAPABILITY_TOKEN, "managed-identity-restart-v1");
  });

  it("hasManagedIdentityRestartCapability parses exact token in SemVer build metadata", () => {
    assert.equal(hasManagedIdentityRestartCapability(VALID_AGENT_VERSION), true);
    assert.equal(hasManagedIdentityRestartCapability("0.1.0+managed-identity-restart-v1"), true);
    assert.equal(hasManagedIdentityRestartCapability(NO_TOKEN_AGENT_VERSION), false);
    assert.equal(hasManagedIdentityRestartCapability(NEAR_MATCH_TOKEN_AGENT_VERSION), false);
    assert.equal(hasManagedIdentityRestartCapability("0.1.0+not-managed-identity-restart-v1"), false);
    assert.equal(hasManagedIdentityRestartCapability(null), false);
    assert.equal(hasManagedIdentityRestartCapability(undefined), false);
    assert.equal(hasManagedIdentityRestartCapability(""), false);
  });

  it("correct JAR + CTL15 + token -> compatible (R2.3, movement-fix, and forge-fix JARs)", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15, VALID_AGENT_VERSION), true);
    // Case insensitivity of JAR SHA
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA.toUpperCase(), 15, VALID_AGENT_VERSION), true);

    // Movement-fix SHA
    assert.equal(isBachHoRuntimeCompatible(MOVEMENT_FIX_SHA, 15, VALID_AGENT_VERSION), true);
    assert.equal(isBachHoRuntimeCompatible(MOVEMENT_FIX_SHA.toUpperCase(), 15, VALID_AGENT_VERSION), true);

    // Forge-fix SHA
    assert.equal(isBachHoRuntimeCompatible(FORGE_FIX_SHA, 15, VALID_AGENT_VERSION), true);
    assert.equal(isBachHoRuntimeCompatible(FORGE_FIX_SHA.toUpperCase(), 15, VALID_AGENT_VERSION), true);
  });

  it("correct JAR + CTL15 + no token -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15, NO_TOKEN_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(MOVEMENT_FIX_SHA, 15, NO_TOKEN_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FORGE_FIX_SHA, 15, NO_TOKEN_AGENT_VERSION), false);
  });

  it("correct JAR + CTL15 + near-match token -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15, NEAR_MATCH_TOKEN_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(MOVEMENT_FIX_SHA, 15, NEAR_MATCH_TOKEN_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FORGE_FIX_SHA, 15, NEAR_MATCH_TOKEN_AGENT_VERSION), false);
  });

  it("substring, prefix, or suffix tampering on valid SHA -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA.slice(0, 32), 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(MOVEMENT_FIX_SHA.slice(0, 32), 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(MOVEMENT_FIX_SHA + "a", 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible("a" + MOVEMENT_FIX_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FORGE_FIX_SHA.slice(0, 32), 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FORGE_FIX_SHA + "a", 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible("a" + FORGE_FIX_SHA, 15, VALID_AGENT_VERSION), false);
  });

  it("old JAR or obsolete candidate JAR + token -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(HISTORICAL_B18_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(R1_BD15_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(OBSOLETE_0BDDA_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(OBSOLETE_D369_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(OBSOLETE_37D1_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FAILED_FORGE_CANDIDATE_B2BC_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FAILED_FORGE_CANDIDATE_24E9_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FAILED_FORGE_CANDIDATE_278F_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(FAILED_FORGE_CANDIDATE_47E4_SHA, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible("0000000000000000000000000000000000000000000000000000000000000000", 15, VALID_AGENT_VERSION), false);
  });

  it("correct JAR + CTL14 + token -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 14, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 13, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, null, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, undefined, VALID_AGENT_VERSION), false);
  });

  it("null or undefined agentVersion -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15, null), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15, undefined), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15, ""), false);
  });

  it("null or undefined SHA -> incompatible", () => {
    assert.equal(isBachHoRuntimeCompatible(null, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible(undefined, 15, VALID_AGENT_VERSION), false);
    assert.equal(isBachHoRuntimeCompatible("", 15, VALID_AGENT_VERSION), false);
  });

  it("isBachHoSupportedOnDevice verifies device-level runtime reporting", () => {
    // Capable device
    const capableDevice = {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agentVersion: VALID_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(capableDevice), true);

    // Capable device with movement-fix JAR
    const capableMovementFixDevice = {
      jar_sha256: MOVEMENT_FIX_SHA,
      jar_ctl_version: 15,
      agentVersion: VALID_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(capableMovementFixDevice), true);

    // Capable device with forge-fix JAR
    const capableForgeFixDevice = {
      jar_sha256: FORGE_FIX_SHA,
      jar_ctl_version: 15,
      agentVersion: VALID_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(capableForgeFixDevice), true);

    // Support camelCase or snake_case agent_version
    const snakeCaseDevice = {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agent_version: VALID_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(snakeCaseDevice), true);

    // Device missing token
    const noTokenDevice = {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agentVersion: NO_TOKEN_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(noTokenDevice), false);

    // Incompatible SHA
    const oldJarDevice = {
      jar_sha256: HISTORICAL_B18_SHA,
      jar_ctl_version: 15,
      agentVersion: VALID_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(oldJarDevice), false);

    // Incompatible CTL
    const oldCtlDevice = {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 14,
      agentVersion: VALID_AGENT_VERSION,
    };
    assert.equal(isBachHoSupportedOnDevice(oldCtlDevice), false);

    // Missing fields
    assert.equal(isBachHoSupportedOnDevice({ jar_sha256: null, jar_ctl_version: 15, agentVersion: VALID_AGENT_VERSION }), false);
    assert.equal(isBachHoSupportedOnDevice({ jar_sha256: R2_3_SHA, jar_ctl_version: null, agentVersion: VALID_AGENT_VERSION }), false);
    assert.equal(isBachHoSupportedOnDevice({ jar_sha256: R2_3_SHA, jar_ctl_version: 15, agentVersion: null }), false);
    assert.equal(isBachHoSupportedOnDevice(null), false);
    assert.equal(isBachHoSupportedOnDevice(undefined), false);
  });
});

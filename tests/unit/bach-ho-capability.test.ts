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
    isBachHoRuntimeCompatible,
    isBachHoSupportedOnDevice,
  } = await import("../../src/lib/capabilities");

  const R2_3_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const HISTORICAL_B18_SHA = "b18baf709e7c5ecbc0c8b6b1076b1f20b784a9e3e78bdf1b4a2bfec19280d0d1";
  const R1_BD15_SHA = "bd15eea25df4b2aa929ecdf2fcf795ccebeae876f296c0502dc85ec280f33333";

  it("constants are defined accurately", () => {
    assert.equal(BACH_HO_REQUIRED_CTL_VERSION, 15);
    assert.ok(COMPATIBLE_BACH_HO_JAR_SHAS.has(R2_3_SHA));
    assert.equal(COMPATIBLE_BACH_HO_JAR_SHAS.size, 1);
  });

  it("accepts R2.3 SHA with CTL 15 as capable", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 15), true);
    // Case insensitivity
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA.toUpperCase(), 15), true);
  });

  it("rejects historical b18... SHA with CTL 15", () => {
    assert.equal(isBachHoRuntimeCompatible(HISTORICAL_B18_SHA, 15), false);
  });

  it("rejects R1 bd15... SHA with CTL 15", () => {
    assert.equal(isBachHoRuntimeCompatible(R1_BD15_SHA, 15), false);
  });

  it("rejects unknown SHA with CTL 15", () => {
    assert.equal(isBachHoRuntimeCompatible("0000000000000000000000000000000000000000000000000000000000000000", 15), false);
  });

  it("rejects null or undefined SHA", () => {
    assert.equal(isBachHoRuntimeCompatible(null, 15), false);
    assert.equal(isBachHoRuntimeCompatible(undefined, 15), false);
    assert.equal(isBachHoRuntimeCompatible("", 15), false);
  });

  it("rejects R2.3 SHA with non-15 CTL version", () => {
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 14), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, 13), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, null), false);
    assert.equal(isBachHoRuntimeCompatible(R2_3_SHA, undefined), false);
  });

  it("isBachHoSupportedOnDevice verifies device-level runtime reporting", () => {
    // Capable device
    const capableDevice = {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
    };
    assert.equal(isBachHoSupportedOnDevice(capableDevice), true);

    // Incompatible SHA
    const oldJarDevice = {
      jar_sha256: HISTORICAL_B18_SHA,
      jar_ctl_version: 15,
    };
    assert.equal(isBachHoSupportedOnDevice(oldJarDevice), false);

    // Incompatible CTL
    const oldCtlDevice = {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 14,
    };
    assert.equal(isBachHoSupportedOnDevice(oldCtlDevice), false);

    // Missing fields
    assert.equal(isBachHoSupportedOnDevice({ jar_sha256: null, jar_ctl_version: 15 }), false);
    assert.equal(isBachHoSupportedOnDevice({ jar_sha256: R2_3_SHA, jar_ctl_version: null }), false);
    assert.equal(isBachHoSupportedOnDevice(null), false);
    assert.equal(isBachHoSupportedOnDevice(undefined), false);
  });
});

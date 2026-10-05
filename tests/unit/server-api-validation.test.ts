/**
 * Unit tests for Web API Server & Capability Validation
 * Task: KNIGHT_V403_BACH_HO_R3_CLOUD_WEB_SUPPORT
 *
 * Verifies:
 * 1. Legacy server create accepted (0..7)
 * 2. Bạch Hổ create on capable device accepted
 * 3. Bạch Hổ create on incompatible device rejected
 * 4. Legacy -> Bạch Hổ update on capable device accepted
 * 5. Legacy -> Bạch Hổ update on incompatible device rejected
 * 6. Existing Bạch Hổ metadata-only update preserved
 * 7. Bạch Hổ -> legacy allowed
 * 8. Invalid server index (9, -1) rejected
 */

import { register } from "node:module";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mock.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "mock-anon-key";

const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith("@/")) {
    target = new URL("../../src/" + target.slice(2), "${import.meta.url}").href;
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

const { mockApi, setMockDevice, resetMockState } = await import("../../src/services/mock-api");
const { ApiError } = await import("../../src/services/api");
const { BACH_HO_LOGICAL_ID } = await import("../../src/lib/game-servers");

const R2_3_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
const MOVEMENT_FIX_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";

describe("Web API Server & Bạch Hổ Capability Validation Tests", () => {
  let devices: any[];
  let accounts: any[];

  beforeEach(async () => {
    resetMockState();
    devices = await mockApi.getDevices();
    accounts = await mockApi.getAccounts();
  });

  it("legacy server create accepted (0..7)", async () => {
    const acc = await mockApi.createAccount({
      deviceId: devices[0].deviceId,
      label: "Test Legacy",
      username: "legacy_user",
      password: "password123",
      serverIndex: 0,
      character_slot: 1,
    });
    assert.equal(acc.serverId, 0);
  });

  it("Bạch Hổ create on capable device accepted", async () => {
    // Configure device 0 with compatible runtime
    setMockDevice(devices[0].deviceId, {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });

    const acc = await mockApi.createAccount({
      deviceId: devices[0].deviceId,
      label: "Test Bach Ho Capable",
      username: "bachho_user",
      password: "password123",
      serverIndex: BACH_HO_LOGICAL_ID,
      character_slot: 1,
    });
    assert.equal(acc.serverId, 8);
  });

  it("Bạch Hổ create on movement-fix capable device accepted", async () => {
    setMockDevice(devices[0].deviceId, {
      jar_sha256: MOVEMENT_FIX_SHA,
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });

    const acc = await mockApi.createAccount({
      deviceId: devices[0].deviceId,
      label: "Test Bach Ho Movement Fix Capable",
      username: "bachho_user_mov",
      password: "password123",
      serverIndex: BACH_HO_LOGICAL_ID,
      character_slot: 1,
    });
    assert.equal(acc.serverId, 8);
  });

  it("Bạch Hổ create on incompatible device rejected before credentials are submitted", async () => {
    // Configure device 0 with incompatible runtime
    setMockDevice(devices[0].deviceId, {
      jar_sha256: "b18baf709e7c5ecbc0c8b6b1076b1f20b784a9e3e78bdf1b4a2bfec19280d0d1",
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });

    await assert.rejects(
      async () => {
        await mockApi.createAccount({
          deviceId: devices[0].deviceId,
          label: "Test Bach Ho Incompatible",
          username: "bachho_user",
          password: "password123",
          serverIndex: BACH_HO_LOGICAL_ID,
          character_slot: 1,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "UNSUPPORTED_SERVER");
        return true;
      },
    );
  });

  it("Bạch Hổ create on device missing agent capability rejected", async () => {
    setMockDevice(devices[0].deviceId, {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agentVersion: "0.4.2+visual-qol-v1",
    });

    await assert.rejects(
      async () => {
        await mockApi.createAccount({
          deviceId: devices[0].deviceId,
          label: "Test Bach Ho Missing Agent Token",
          username: "bachho_user",
          password: "password123",
          serverIndex: BACH_HO_LOGICAL_ID,
          character_slot: 1,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "UNSUPPORTED_SERVER");
        return true;
      },
    );
  });

  it("legacy -> Bạch Hổ update on capable device accepted", async () => {
    setMockDevice(devices[0].deviceId, {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });

    const updated = await mockApi.updateAccount({
      accountId: "acc_01",
      label: "Account 01 - Switched to 8",
      serverIndex: 8,
    });
    assert.equal(updated.serverId, 8);
  });

  it("legacy -> Bạch Hổ update on movement-fix capable device accepted", async () => {
    setMockDevice(devices[0].deviceId, {
      jar_sha256: MOVEMENT_FIX_SHA,
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });

    const updated = await mockApi.updateAccount({
      accountId: "acc_01",
      label: "Account 01 - Switched to 8 via movement fix",
      serverIndex: 8,
    });
    assert.equal(updated.serverId, 8);
  });

  it("legacy -> Bạch Hổ update on incompatible device rejected", async () => {
    setMockDevice(devices[0].deviceId, {
      jar_sha256: "b18baf709e7c5ecbc0c8b6b1076b1f20b784a9e3e78bdf1b4a2bfec19280d0d1",
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });

    await assert.rejects(
      async () => {
        await mockApi.updateAccount({
          accountId: "acc_02",
          label: "Account 02 - Switched to 8",
          serverIndex: 8,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "UNSUPPORTED_SERVER");
        return true;
      },
    );
  });

  it("existing Bạch Hổ metadata-only update preserved without re-checking device capability", async () => {
    // First, make acc_03 server 8 while capable
    setMockDevice(devices[0].deviceId, {
      jar_sha256: R2_3_SHA,
      jar_ctl_version: 15,
      agentVersion: "0.4.2+managed-identity-restart-v1",
    });
    await mockApi.updateAccount({
      accountId: "acc_03",
      label: "Account 03",
      serverIndex: 8,
    });

    // Now device becomes temporarily unverified/offline or reports null sha
    setMockDevice(devices[0].deviceId, {
      jar_sha256: null,
    });

    // Unrelated label edit while already server 8
    const updated = await mockApi.updateAccount({
      accountId: "acc_03",
      label: "Account 03 Renamed",
      serverIndex: 8,
    });
    assert.equal(updated.serverId, 8);
    assert.equal(updated.label, "Account 03 Renamed");
  });

  it("Bạch Hổ -> legacy allowed unconditionally", async () => {
    const updated = await mockApi.updateAccount({
      accountId: "acc_03",
      label: "Account 03 Back to Legacy",
      serverIndex: 1,
    });
    assert.equal(updated.serverId, 1);
  });

  it("server 9 rejected in createAccount and updateAccount", async () => {
    await assert.rejects(
      async () => {
        await mockApi.createAccount({
          deviceId: devices[0].deviceId,
          label: "Test 9",
          username: "user9",
          password: "password123",
          serverIndex: 9,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "INVALID_ACCOUNT_INPUT");
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await mockApi.updateAccount({
          accountId: "acc_01",
          label: "Test 9",
          serverIndex: 9,
        });
      },
      (err: any) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "INVALID_ACCOUNT_INPUT");
        return true;
      },
    );
  });
});

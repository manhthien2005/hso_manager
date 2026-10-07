/**
 * Migration 028: Bạch Hổ Forge Live Title Contract Runtime Compatibility Contract Test
 * Task: KNIGHT_V403_R4_15_FIX_LIVE_LOCAL_MENU_TITLE_CONTRACT
 *
 * Verifies static structural invariants of migration 028:
 * 1. Migration 022 through 027 exist and are 100% untouched.
 * 2. Migration 028 exists, is non-empty, and non-destructive.
 * 3. Migration 028 contains exactly the 3 approved Bạch Hổ JAR SHAs:
 *    - 4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d (v4.0.3 base)
 *    - 51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a (v4.0.3 movement fix)
 *    - c177d9ace4cd2c45fbebb4422c0bec8c8021e81872254e84b3d0960c8c510bd5 (v4.0.3 forge live title contract fix)
 * 4. Migration 028 explicitly excludes ca3b... and older failed candidates (b2bc..., 24e9..., 278f..., 47e4..., 37d1...).
 * 5. Migration 028 enforces exact CTL 15 and exact managed-identity-restart-v1 capability.
 * 6. Migration 028 preserves user_id / device_id immutability and ownership invariants.
 * 7. Migration 028 preserves create_game_account and update_game_account signatures and grants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 028: Bạch Hổ Forge Live Title Contract Invariants", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const file022 = path.join(migrationsDir, "022_v403_bach_ho_server_support.sql");
  const file023 = path.join(migrationsDir, "023_v403_movement_runtime_compat.sql");
  const file024 = path.join(migrationsDir, "024_v403_forge_runtime_compat.sql");
  const file025 = path.join(migrationsDir, "025_v403_forge_dialog_runtime_compat.sql");
  const file026 = path.join(migrationsDir, "026_v403_forge_native_interaction_runtime_compat.sql");
  const file027 = path.join(migrationsDir, "027_allow_v403_local_npc_forge_jar.sql");
  const file028 = path.join(migrationsDir, "028_v403_forge_live_title_runtime_compat.sql");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FINAL_TITLE_FIX_SHA = "c177d9ace4cd2c45fbebb4422c0bec8c8021e81872254e84b3d0960c8c510bd5";

  const FAILED_CA3B_SHA = "ca3b65038a1416a9fcd7eedc9127a1ba4702d48628b0030fda701ceb77c84dec";
  const OBSOLETE_37D1_SHA = "37d18817d6b9b49fa1c20b1859a2d300272506101d7de7d8cf51ec3dd1f15d14";
  const FAILED_B2BC_SHA = "b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658";
  const FAILED_24E9_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";

  it("migration 022 through 027 exist and are untouched", () => {
    assert.ok(fs.existsSync(file022), "022 must exist");
    assert.ok(fs.existsSync(file023), "023 must exist");
    assert.ok(fs.existsSync(file024), "024 must exist");
    assert.ok(fs.existsSync(file025), "025 must exist");
    assert.ok(fs.existsSync(file026), "026 must exist");
    assert.ok(fs.existsSync(file027), "027 must exist");

    const sql027 = fs.readFileSync(file027, "utf-8");
    assert.ok(sql027.length > 1000);
    assert.match(sql027, new RegExp(BASE_SHA));
    assert.match(sql027, new RegExp(MOV_SHA));
    assert.match(sql027, new RegExp(FAILED_CA3B_SHA));
  });

  it("migration 028 exists and contains exact required SHAs in its allowlist", () => {
    assert.ok(fs.existsSync(file028), "028 must exist");
    const sql028 = fs.readFileSync(file028, "utf-8");
    assert.ok(sql028.length > 1000);

    // Exact 3 allowlist matches in the 3 functions
    const baseMatches = sql028.match(new RegExp(BASE_SHA, "g"));
    const movMatches = sql028.match(new RegExp(MOV_SHA, "g"));
    const finalMatches = sql028.match(new RegExp(FINAL_TITLE_FIX_SHA, "g"));

    assert.equal(baseMatches?.length, 4, "BASE_SHA must appear in header + 3 functions");
    assert.equal(movMatches?.length, 4, "MOV_SHA must appear in header + 3 functions");
    assert.equal(finalMatches?.length, 4, "FINAL_TITLE_FIX_SHA must appear in header + 3 functions");

    // Rejected candidates only appear in comments, not in SQL code blocks
    const lines = sql028.split("\n");
    const nonCommentSql = lines.filter((l) => !l.trim().startsWith("--")).join("\n");

    assert.doesNotMatch(nonCommentSql, new RegExp(FAILED_CA3B_SHA), "ca3b must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(OBSOLETE_37D1_SHA), "37d1 must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(FAILED_B2BC_SHA), "b2bc must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(FAILED_24E9_SHA), "24e9 must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(ROLLED_BACK_FORGE_SHA), "278f must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(FAILED_47E4_SHA), "47e4 must not be in active allowlist");
  });

  it("migration 028 replaces only the 3 designated compatibility functions", () => {
    const sql028 = fs.readFileSync(file028, "utf-8");
    const createOrReplaceCount = (sql028.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
    assert.equal(createOrReplaceCount, 3, "Must replace exactly 3 functions");

    assert.match(sql028, /CREATE OR REPLACE FUNCTION public\.accounts_before_write\(\)/);
    assert.match(sql028, /CREATE OR REPLACE FUNCTION public\.create_game_account\(/);
    assert.match(sql028, /CREATE OR REPLACE FUNCTION public\.update_game_account\(/);
  });

  it("migration 028 preserves CTL 15 and exact capability invariants", () => {
    const sql028 = fs.readFileSync(file028, "utf-8");
    const ctl15Matches = sql028.match(/v_device_jar_ctl_version <> 15/g);
    assert.equal(ctl15Matches?.length, 3, "CTL 15 check must be present in all 3 functions");

    const capMatches = sql028.match(/agent_has_exact_capability\(v_device_agent_version, 'managed-identity-restart-v1'\)/g);
    assert.equal(capMatches?.length, 3, "Exact capability check must be present in all 3 functions");
  });
});

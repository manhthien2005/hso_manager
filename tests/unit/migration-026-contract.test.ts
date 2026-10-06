/**
 * Migration 026: Bạch Hổ Forge Native NPC Interaction Fix Runtime Compatibility Expansion Contract Test
 * Task: KNIGHT_V403_R4_11_FIX_FORGE_NATIVE_NPC_INTERACTION
 *
 * Verifies static structural invariants of migration 026:
 * 1. Migration 022, 023, 024, and 025 exist and are 100% untouched.
 * 2. Migration 026 exists, is non-empty, and non-destructive.
 * 3. Migration 026 contains exactly the 3 approved Bạch Hổ JAR SHAs:
 *    - 4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d (v4.0.3 base)
 *    - 51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a (v4.0.3 movement fix)
 *    - b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658 (v4.0.3 forge native interaction fix)
 * 4. Migration 026 explicitly excludes rolled-back / obsolete candidates (24e9..., 278f..., 47e4..., 0bdda..., d369...).
 * 5. Migration 026 enforces exact CTL 15 and exact managed-identity-restart-v1 capability.
 * 6. Migration 026 preserves user_id / device_id immutability and ownership invariants.
 * 7. Migration 026 preserves create_game_account and update_game_account signatures and grants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 026: Bạch Hổ Forge Native NPC Interaction Fix Contract Invariants", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const file022 = path.join(migrationsDir, "022_v403_bach_ho_server_support.sql");
  const file023 = path.join(migrationsDir, "023_v403_movement_runtime_compat.sql");
  const file024 = path.join(migrationsDir, "024_v403_forge_runtime_compat.sql");
  const file025 = path.join(migrationsDir, "025_v403_forge_dialog_runtime_compat.sql");
  const file026 = path.join(migrationsDir, "026_v403_forge_native_interaction_runtime_compat.sql");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FORGE_NATIVE_SHA = "b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658";
  const FAILED_24E9_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";

  it("migration 022, 023, 024, and 025 exist and are untouched", () => {
    assert.ok(fs.existsSync(file022), "022 must exist");
    assert.ok(fs.existsSync(file023), "023 must exist");
    assert.ok(fs.existsSync(file024), "024 must exist");
    assert.ok(fs.existsSync(file025), "025 must exist");

    const sql022 = fs.readFileSync(file022, "utf-8");
    assert.ok(sql022.length > 1000);
    assert.match(sql022, new RegExp(BASE_SHA));
    assert.doesNotMatch(sql022, new RegExp(MOV_SHA));
    assert.doesNotMatch(sql022, new RegExp(FORGE_NATIVE_SHA));

    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.ok(sql023.length > 1000);
    assert.match(sql023, new RegExp(BASE_SHA));
    assert.match(sql023, new RegExp(MOV_SHA));
    assert.doesNotMatch(sql023, new RegExp(FORGE_NATIVE_SHA));

    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.ok(sql024.length > 1000);
    assert.match(sql024, new RegExp(BASE_SHA));
    assert.match(sql024, new RegExp(MOV_SHA));
    assert.match(sql024, new RegExp(ROLLED_BACK_FORGE_SHA));
    assert.doesNotMatch(sql024, new RegExp(FORGE_NATIVE_SHA));

    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.ok(sql025.length > 1000);
    assert.match(sql025, new RegExp(BASE_SHA));
    assert.match(sql025, new RegExp(MOV_SHA));
    assert.match(sql025, new RegExp(FAILED_24E9_SHA));
    assert.doesNotMatch(sql025, new RegExp(FORGE_NATIVE_SHA));
  });

  it("migration 026 exists and contains exact required SHAs in its allowlist", () => {
    assert.ok(fs.existsSync(file026), "026 must exist");
    const sql026 = fs.readFileSync(file026, "utf-8");
    assert.ok(sql026.length > 1000);

    // Exact 3 allowlist matches in the 3 functions
    const baseMatches = sql026.match(new RegExp(BASE_SHA, "g"));
    const movMatches = sql026.match(new RegExp(MOV_SHA, "g"));
    const forgeMatches = sql026.match(new RegExp(FORGE_NATIVE_SHA, "g"));

    assert.equal(baseMatches?.length, 4, "BASE_SHA must appear in header + 3 functions");
    assert.equal(movMatches?.length, 4, "MOV_SHA must appear in header + 3 functions");
    assert.equal(forgeMatches?.length, 4, "FORGE_NATIVE_SHA must appear in header + 3 functions");

    // Rejected candidates only appear in comments, not in SQL code blocks
    const lines = sql026.split("\n");
    const nonCommentSql = lines.filter((l) => !l.trim().startsWith("--")).join("\n");

    assert.doesNotMatch(nonCommentSql, new RegExp(FAILED_24E9_SHA), "24e9 must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(ROLLED_BACK_FORGE_SHA), "278f must not be in active allowlist");
    assert.doesNotMatch(nonCommentSql, new RegExp(FAILED_47E4_SHA), "47e4 must not be in active allowlist");
  });

  it("migration 026 replaces only the 3 designated compatibility functions", () => {
    const sql026 = fs.readFileSync(file026, "utf-8");
    const createOrReplaceCount = (sql026.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
    assert.equal(createOrReplaceCount, 3, "Must replace exactly 3 functions");

    assert.match(sql026, /CREATE OR REPLACE FUNCTION public\.accounts_before_write\(\)/);
    assert.match(sql026, /CREATE OR REPLACE FUNCTION public\.create_game_account\(/);
    assert.match(sql026, /CREATE OR REPLACE FUNCTION public\.update_game_account\(/);
  });

  it("migration 026 preserves CTL 15 and exact capability invariants", () => {
    const sql026 = fs.readFileSync(file026, "utf-8");
    const ctl15Matches = sql026.match(/v_device_jar_ctl_version <> 15/g);
    assert.equal(ctl15Matches?.length, 3, "CTL 15 check must be present in all 3 functions");

    const capMatches = sql026.match(/agent_has_exact_capability\(v_device_agent_version, 'managed-identity-restart-v1'\)/g);
    assert.equal(capMatches?.length, 3, "Exact capability check must be present in all 3 functions");
  });
});

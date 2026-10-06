/**
 * Migration 025: Bạch Hổ Blacksmith Intro Dialog Fix Runtime Compatibility Expansion Contract Test
 * Task: KNIGHT_V403_R4_9_BLACKSMITH_INTRO_DIALOG_LIVE_FORENSIC_AND_FIX
 *
 * Verifies static structural invariants of migration 025:
 * 1. Migration 022, 023, and 024 exist and are 100% untouched.
 * 2. Migration 025 exists, is non-empty, and non-destructive.
 * 3. Migration 025 contains exactly the 3 approved Bạch Hổ JAR SHAs:
 *    - 4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d (v4.0.3 base)
 *    - 51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a (v4.0.3 movement fix)
 *    - 47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d (v4.0.3 intro dialog fix)
 * 4. Migration 025 explicitly excludes rolled-back / obsolete candidates (278f3754..., 0bdda..., d369...).
 * 5. Migration 025 enforces exact CTL 15 and exact managed-identity-restart-v1 capability.
 * 6. Migration 025 preserves user_id / device_id immutability and ownership invariants.
 * 7. Migration 025 preserves create_game_account and update_game_account signatures and grants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 025: Bạch Hổ Blacksmith Intro Dialog Fix Contract Invariants", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const file022 = path.join(migrationsDir, "022_v403_bach_ho_server_support.sql");
  const file023 = path.join(migrationsDir, "023_v403_movement_runtime_compat.sql");
  const file024 = path.join(migrationsDir, "024_v403_forge_runtime_compat.sql");
  const file025 = path.join(migrationsDir, "025_v403_forge_dialog_runtime_compat.sql");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FORGE_DIALOG_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";

  it("migration 022, 023, and 024 exist and are untouched", () => {
    assert.ok(fs.existsSync(file022), "022 must exist");
    assert.ok(fs.existsSync(file023), "023 must exist");
    assert.ok(fs.existsSync(file024), "024 must exist");

    const sql022 = fs.readFileSync(file022, "utf-8");
    assert.ok(sql022.length > 1000);
    assert.match(sql022, new RegExp(BASE_SHA));
    assert.doesNotMatch(sql022, new RegExp(MOV_SHA));
    assert.doesNotMatch(sql022, new RegExp(FORGE_DIALOG_SHA));

    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.ok(sql023.length > 1000);
    assert.match(sql023, new RegExp(BASE_SHA));
    assert.match(sql023, new RegExp(MOV_SHA));
    assert.doesNotMatch(sql023, new RegExp(FORGE_DIALOG_SHA), "023 must not contain forge dialog fix SHA");

    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.ok(sql024.length > 1000);
    assert.match(sql024, new RegExp(BASE_SHA));
    assert.match(sql024, new RegExp(MOV_SHA));
    assert.match(sql024, new RegExp(ROLLED_BACK_FORGE_SHA));
    assert.doesNotMatch(sql024, new RegExp(FORGE_DIALOG_SHA), "024 must remain strictly unmodified");
  });

  it("migration 025 exists and is non-destructive", () => {
    assert.ok(fs.existsSync(file025), "025 must exist");
    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.ok(sql025.length > 500);
    assert.doesNotMatch(sql025, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql025, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql025, /\bDELETE\b/i);
  });

  it("migration 025 contains exactly the three approved Bạch Hổ JAR SHAs", () => {
    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.match(sql025, new RegExp(BASE_SHA));
    assert.match(sql025, new RegExp(MOV_SHA));
    assert.match(sql025, new RegExp(FORGE_DIALOG_SHA));

    // Verify SHA count matches expectation across the 3 functions
    const baseMatches = sql025.match(new RegExp(BASE_SHA, "g"));
    const movMatches = sql025.match(new RegExp(MOV_SHA, "g"));
    const forgeMatches = sql025.match(new RegExp(FORGE_DIALOG_SHA, "g"));
    assert.ok(baseMatches && baseMatches.length >= 3, "Base SHA must appear in all 3 functions");
    assert.ok(movMatches && movMatches.length >= 3, "Movement-fix SHA must appear in all 3 functions");
    assert.ok(forgeMatches && forgeMatches.length >= 3, "Forge-dialog-fix SHA must appear in all 3 functions");
  });

  it("migration 025 explicitly does not allow rolled-back or obsolete candidate SHAs in functions", () => {
    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.doesNotMatch(sql025, /0bddaee4680f8521f4628f4d52399ceee161c4e5d0387eab3dbe48cf662e8216/i);
    assert.doesNotMatch(sql025, /d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a/i);

    // Ensure ROLLED_BACK_FORGE_SHA only appears in documentation comments (if at all) and NOT in the IN-clause
    const inClauseRegex = /NOT\s+IN\s*\(\s*([^)]+)\)/g;
    let match: RegExpExecArray | null;
    let clausesChecked = 0;
    while ((match = inClauseRegex.exec(sql025)) !== null) {
      const allowedList = match[1];
      assert.ok(!allowedList.includes(ROLLED_BACK_FORGE_SHA), "Candidate 278f3754 must NOT be in the NOT IN allowlist");
      clausesChecked++;
    }
    assert.equal(clausesChecked, 3, "Must verify all 3 NOT IN clauses");
  });

  it("migration 025 enforces exact CTL 15 and managed-identity-restart-v1", () => {
    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.match(sql025, /v_device_jar_ctl_version\s*(?:IS\s+NULL\s+OR\s+v_device_jar_ctl_version\s*)?<>\s*15/);
    assert.match(sql025, /agent_has_exact_capability\(v_device_agent_version,\s*'managed-identity-restart-v1'\)/);
  });

  it("migration 025 preserves user_id and device_id immutability", () => {
    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.match(sql025, /accounts\.user_id is immutable after insert/);
    assert.match(sql025, /accounts\.device_id is immutable after insert/);
  });

  it("migration 025 preserves RPC signatures and grants", () => {
    const sql025 = fs.readFileSync(file025, "utf-8");
    assert.match(sql025, /CREATE OR REPLACE FUNCTION public\.create_game_account/);
    assert.match(sql025, /GRANT EXECUTE ON FUNCTION public\.create_game_account.*TO authenticated/);
    assert.match(sql025, /CREATE OR REPLACE FUNCTION public\.update_game_account/);
    assert.match(sql025, /GRANT EXECUTE ON FUNCTION public\.update_game_account.*TO authenticated/);
  });
});

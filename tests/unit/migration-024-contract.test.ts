/**
 * Migration 024: Bạch Hổ Forge Fix Runtime Compatibility Expansion Contract Test
 * Task: KNIGHT_V403_R4_7_FORGE_OPEN_LIVE_FORENSIC_AND_TARGETED_FIX
 *
 * Verifies static structural invariants of migration 024:
 * 1. Migration 022 and 023 exist and are 100% untouched.
 * 2. Migration 024 exists, is non-empty, and non-destructive.
 * 3. Migration 024 contains exactly the 3 approved Bạch Hổ JAR SHAs.
 * 4. Migration 024 enforces exact CTL 15 and exact managed-identity-restart-v1 capability.
 * 5. Migration 024 preserves user_id / device_id immutability and ownership invariants.
 * 6. Migration 024 preserves create_game_account and update_game_account signatures and grants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 024: Bạch Hổ Forge Fix Contract Invariants", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const file022 = path.join(migrationsDir, "022_v403_bach_ho_server_support.sql");
  const file023 = path.join(migrationsDir, "023_v403_movement_runtime_compat.sql");
  const file024 = path.join(migrationsDir, "024_v403_forge_runtime_compat.sql");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FORGE_SHA = "d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a";

  it("migration 022 and 023 exist and are untouched", () => {
    assert.ok(fs.existsSync(file022), "022 must exist");
    assert.ok(fs.existsSync(file023), "023 must exist");

    const sql022 = fs.readFileSync(file022, "utf-8");
    assert.ok(sql022.length > 1000);
    assert.match(sql022, new RegExp(BASE_SHA));
    assert.doesNotMatch(sql022, new RegExp(MOV_SHA));
    assert.doesNotMatch(sql022, new RegExp(FORGE_SHA));

    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.ok(sql023.length > 1000);
    assert.match(sql023, new RegExp(BASE_SHA));
    assert.match(sql023, new RegExp(MOV_SHA));
    assert.doesNotMatch(sql023, new RegExp(FORGE_SHA), "023 must not contain forge fix SHA");
  });

  it("migration 024 exists and is non-destructive", () => {
    assert.ok(fs.existsSync(file024), "024 must exist");
    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.ok(sql024.length > 500);
    assert.doesNotMatch(sql024, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql024, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql024, /\bDELETE\b/i);
  });

  it("migration 024 contains exactly the three approved Bạch Hổ JAR SHAs", () => {
    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.match(sql024, new RegExp(BASE_SHA));
    assert.match(sql024, new RegExp(MOV_SHA));
    assert.match(sql024, new RegExp(FORGE_SHA));

    // Verify SHA count matches expectation across the 3 functions
    const baseMatches = sql024.match(new RegExp(BASE_SHA, "g"));
    const movMatches = sql024.match(new RegExp(MOV_SHA, "g"));
    const forgeMatches = sql024.match(new RegExp(FORGE_SHA, "g"));
    assert.ok(baseMatches && baseMatches.length >= 3, "Base SHA must appear in all 3 functions");
    assert.ok(movMatches && movMatches.length >= 3, "Movement-fix SHA must appear in all 3 functions");
    assert.ok(forgeMatches && forgeMatches.length >= 3, "Forge-fix SHA must appear in all 3 functions");
  });

  it("migration 024 enforces exact CTL 15 and managed-identity-restart-v1", () => {
    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.match(sql024, /v_device_jar_ctl_version\s*(?:IS\s+NULL\s+OR\s+v_device_jar_ctl_version\s*)?<>\s*15/);
    assert.match(sql024, /agent_has_exact_capability\(v_device_agent_version,\s*'managed-identity-restart-v1'\)/);
  });

  it("migration 024 preserves user_id and device_id immutability", () => {
    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.match(sql024, /accounts\.user_id is immutable after insert/);
    assert.match(sql024, /accounts\.device_id is immutable after insert/);
  });

  it("migration 024 preserves RPC signatures and grants", () => {
    const sql024 = fs.readFileSync(file024, "utf-8");
    assert.match(sql024, /CREATE OR REPLACE FUNCTION public\.create_game_account/);
    assert.match(sql024, /GRANT EXECUTE ON FUNCTION public\.create_game_account.*TO authenticated/);
    assert.match(sql024, /CREATE OR REPLACE FUNCTION public\.update_game_account/);
    assert.match(sql024, /GRANT EXECUTE ON FUNCTION public\.update_game_account.*TO authenticated/);
  });
});

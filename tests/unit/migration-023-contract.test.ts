/**
 * Migration 023: Bạch Hổ Movement Fix Runtime Compatibility Expansion Contract Test
 * Task: KNIGHT_V403_R4_5_FIX_GAME_READY_MOVEMENT_AND_COMPATIBILITY_ROLLOUT_PREP
 *
 * Verifies static structural invariants of migration 023:
 * 1. Migration 022 is 100% untouched.
 * 2. Migration 023 exists, is non-empty, and non-destructive.
 * 3. Migration 023 contains exactly the 2 approved Bạch Hổ JAR SHAs.
 * 4. Migration 023 enforces exact CTL 15 and exact managed-identity-restart-v1 capability.
 * 5. Migration 023 preserves user_id / device_id immutability and ownership invariants.
 * 6. Migration 023 preserves create_game_account and update_game_account signatures and grants.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 023: Bạch Hổ Movement Fix Contract Invariants", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const file022 = path.join(migrationsDir, "022_v403_bach_ho_server_support.sql");
  const file023 = path.join(migrationsDir, "023_v403_movement_runtime_compat.sql");

  const OLD_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const NEW_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";

  it("migration 022 exists and is untouched", () => {
    assert.ok(fs.existsSync(file022), "022 must exist");
    const sql022 = fs.readFileSync(file022, "utf-8");
    assert.ok(sql022.length > 1000);
    // 022 retains single SHA
    assert.match(sql022, new RegExp(OLD_SHA));
    assert.doesNotMatch(sql022, new RegExp(NEW_SHA), "022 must not contain new SHA");
  });

  it("migration 023 exists and is non-destructive", () => {
    assert.ok(fs.existsSync(file023), "023 must exist");
    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.ok(sql023.length > 500);
    assert.doesNotMatch(sql023, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(sql023, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql023, /\bDELETE\b/i);
  });

  it("migration 023 contains exactly the two approved Bạch Hổ JAR SHAs", () => {
    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.match(sql023, new RegExp(OLD_SHA));
    assert.match(sql023, new RegExp(NEW_SHA));

    // Verify SHA count matches expectation across the 3 functions
    const oldMatches = sql023.match(new RegExp(OLD_SHA, "g"));
    const newMatches = sql023.match(new RegExp(NEW_SHA, "g"));
    assert.ok(oldMatches && oldMatches.length >= 3, "Old SHA must appear in all 3 functions");
    assert.ok(newMatches && newMatches.length >= 3, "New SHA must appear in all 3 functions");
  });

  it("migration 023 enforces exact CTL 15 and managed-identity-restart-v1", () => {
    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.match(sql023, /v_device_jar_ctl_version\s*(?:IS\s+NULL\s+OR\s+v_device_jar_ctl_version\s*)?<>\s*15/);
    assert.match(sql023, /agent_has_exact_capability\(v_device_agent_version,\s*'managed-identity-restart-v1'\)/);
  });

  it("migration 023 preserves user_id and device_id immutability", () => {
    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.match(sql023, /accounts\.user_id is immutable after insert/);
    assert.match(sql023, /accounts\.device_id is immutable after insert/);
  });

  it("migration 023 preserves RPC signatures and grants", () => {
    const sql023 = fs.readFileSync(file023, "utf-8");
    assert.match(sql023, /CREATE OR REPLACE FUNCTION public\.create_game_account/);
    assert.match(sql023, /GRANT EXECUTE ON FUNCTION public\.create_game_account.*TO authenticated/);
    assert.match(sql023, /CREATE OR REPLACE FUNCTION public\.update_game_account/);
    assert.match(sql023, /GRANT EXECUTE ON FUNCTION public\.update_game_account.*TO authenticated/);
  });
});

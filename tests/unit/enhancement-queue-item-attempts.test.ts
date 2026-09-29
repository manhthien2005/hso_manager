/**
 * Enhancement Queue Item Attempts Ledger Schema Contract Tests (ENHANCE-06F)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 018: Enhancement Queue Item Attempts Ledger", () => {
  const migration018Path = path.resolve(process.cwd(), "supabase/migrations/018_enhancement_queue_item_attempts.sql");
  const sql018 = fs.readFileSync(migration018Path, "utf-8");

  describe("File Integrity & Forward-Only Checks", () => {
    it("migration 018 file exists and is non-empty", () => {
      assert.ok(fs.existsSync(migration018Path));
      assert.ok(sql018.length > 500);
    });

    it("migration 018 is forward-only and contains no destructive statements", () => {
      assert.doesNotMatch(sql018, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sql018, /TRUNCATE/i);
      assert.doesNotMatch(sql018, /ALTER\s+TABLE\s+public\.enhancement_queue_items\s+DROP/i);
      assert.doesNotMatch(sql018, /ALTER\s+TABLE\s+public\.enhancement_queue_jobs\s+DROP/i);
    });

    it("migrations 013 through 017 remain untouched", () => {
      for (const mig of ["013", "014", "015", "016", "017"]) {
        const migFiles = fs.readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
          .filter((f) => f.startsWith(`${mig}_`));
        assert.equal(migFiles.length, 1, `Expected migration ${mig} to exist`);
      }
    });
  });

  describe("Table Specification & Columns", () => {
    it("creates public.enhancement_queue_item_attempts with canonical FKs", () => {
      assert.match(sql018, /CREATE TABLE IF NOT EXISTS public\.enhancement_queue_item_attempts/i);
      assert.match(sql018, /REFERENCES public\.enhancement_queue_jobs\(id\)/i);
      assert.match(sql018, /REFERENCES public\.enhancement_queue_items\(id\)/i);
      assert.match(sql018, /REFERENCES public\.accounts\(id\)/i);
      assert.match(sql018, /REFERENCES auth\.users\(id\)/i);
    });

    it("enforces attempt_uuid global uniqueness constraint", () => {
      assert.match(sql018, /attempt_uuid\s+uuid\s+NOT\s+NULL\s+UNIQUE/i);
    });

    it("enforces sequential attempt_number and item-scoped uniqueness", () => {
      assert.match(sql018, /attempt_number\s+integer\s+NOT\s+NULL/i);
      assert.match(sql018, /CONSTRAINT\s+enhancement_queue_item_attempts_attempt_number_positive\s+CHECK\s*\(attempt_number\s*>=\s*1\)/i);
      assert.match(sql018, /CONSTRAINT\s+enhancement_queue_item_attempts_item_attempt_number_unique\s+UNIQUE\s*\(item_id,\s*attempt_number\)/i);
    });

    it("enforces one-level step contract (step_target_level = expected_level + 1)", () => {
      assert.match(sql018, /expected_level\s+integer\s+NOT\s+NULL/i);
      assert.match(sql018, /step_target_level\s+integer\s+NOT\s+NULL/i);
      assert.match(sql018, /queue_item_final_target_level\s+integer\s+NOT\s+NULL/i);
      assert.match(sql018, /CONSTRAINT\s+enhancement_queue_item_attempts_single_level_step\s+CHECK\s*\(step_target_level\s*=\s*expected_level\s*\+\s*1\)/i);
      assert.match(sql018, /CONSTRAINT\s+enhancement_queue_item_attempts_step_within_final_target\s+CHECK\s*\(step_target_level\s*<=\s*queue_item_final_target_level\)/i);
    });

    it("enforces attempt phase allowlist matching migration 013", () => {
      assert.match(sql018, /'NONE'/);
      assert.match(sql018, /'PREPARING'/);
      assert.match(sql018, /'READY_TO_EXECUTE'/);
      assert.match(sql018, /'EXECUTE_MAY_HAVE_BEEN_SENT'/);
      assert.match(sql018, /'WAITING_RESULT'/);
      assert.match(sql018, /'WAITING_SETTLEMENT'/);
      assert.match(sql018, /'SETTLED'/);
    });

    it("enforces settlement source allowlist matching migration 015", () => {
      assert.match(sql018, /settlement_source\s+IS\s+NULL\s+OR\s+settlement_source\s+IN\s*\('RESULT_CODE',\s*'STATE_RECONCILED'\)/i);
    });

    it("tracks authoritative separate spend with non-negative constraints", () => {
      assert.match(sql018, /actual_gold_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /actual_gem_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /actual_material_1_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /actual_material_2_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /actual_material_3_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /actual_material_4_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /actual_charm_spent\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    });

    it("tracks recipe and quoted costs", () => {
      assert.match(sql018, /quoted_gold\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /quoted_gems\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+0/i);
      assert.match(sql018, /recipe_materials\s+jsonb\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'::jsonb/i);
    });
  });

  describe("Trigger & Immutability Guarantees", () => {
    it("defines before-write trigger function and trigger", () => {
      assert.match(sql018, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enhancement_queue_item_attempts_before_write/i);
      assert.match(sql018, /CREATE\s+TRIGGER\s+trg_enhancement_queue_item_attempts_before_write/i);
    });

    it("enforces attempt_uuid, levels, and item bindings immutability on UPDATE", () => {
      assert.match(sql018, /NEW\.attempt_uuid\s*<>\s*OLD\.attempt_uuid/);
      assert.match(sql018, /attempt_uuid\s+is\s+immutable/i);
      assert.match(sql018, /NEW\.item_id\s*<>\s*OLD\.item_id/);
      assert.match(sql018, /NEW\.expected_level\s*<>\s*OLD\.expected_level/);
      assert.match(sql018, /NEW\.step_target_level\s*<>\s*OLD\.step_target_level/);
    });

    it("guards SETTLED attempts from being rewritten", () => {
      assert.match(sql018, /OLD\.attempt_phase\s*=\s*'SETTLED'/);
      assert.match(sql018, /Settled attempt % is permanently immutable/i);
    });
  });

  describe("Row Level Security & Grants", () => {
    it("enables RLS on enhancement_queue_item_attempts", () => {
      assert.match(sql018, /ALTER TABLE public\.enhancement_queue_item_attempts ENABLE ROW LEVEL SECURITY;/i);
    });

    it("allows SELECT for authenticated owners and revokes mutations from public/anon/authenticated", () => {
      assert.match(sql018, /CREATE POLICY own_enhancement_queue_item_attempts_select ON public\.enhancement_queue_item_attempts\s+FOR SELECT/i);
      assert.match(sql018, /REVOKE ALL ON TABLE public\.enhancement_queue_item_attempts FROM anon,\s*PUBLIC;/i);
      assert.match(sql018, /GRANT SELECT ON TABLE public\.enhancement_queue_item_attempts TO authenticated;/i);
      assert.match(sql018, /GRANT ALL ON TABLE public\.enhancement_queue_item_attempts TO service_role;/i);
    });

    it("adds enhancement_queue_item_attempts to supabase_realtime publication", () => {
      assert.match(sql018, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.enhancement_queue_item_attempts;/i);
    });
  });
});

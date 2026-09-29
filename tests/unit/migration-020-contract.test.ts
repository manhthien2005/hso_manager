/**
 * Migration 020: Enhancement Queue v2 Lifecycle, Safe Ledger & Capability Contract Tests
 * Task: ENHANCE-06H-ATTEMPT-LEDGER-RLS-LIFECYCLE-AND-FRESHNESS-CORRECTIVE
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 020: Enhancement Queue v2 Lifecycle & Safe Ledger Contract", () => {
  const migration020Path = path.resolve(process.cwd(), "supabase/migrations/020_enhancement_queue_v2_lifecycle_and_ledger_contract.sql");
  const sql020 = fs.readFileSync(migration020Path, "utf-8");

  describe("File Integrity & Forward-Only Invariants", () => {
    it("migration 020 exists and is non-empty", () => {
      assert.ok(fs.existsSync(migration020Path));
      assert.ok(sql020.length > 500);
    });

    it("migration 020 contains no destructive operations", () => {
      assert.doesNotMatch(sql020, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sql020, /TRUNCATE/i);
    });

    it("migrations 013 through 019 remain strictly untouched", () => {
      for (const mig of ["013", "014", "015", "016", "017", "018", "019"]) {
        const migFiles = fs.readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
          .filter((f) => f.startsWith(`${mig}_`));
        assert.equal(migFiles.length, 1, `Expected migration ${mig} to exist`);
      }
    });
  });

  describe("Restricted Device RLS & Grants on Attempt Ledger", () => {
    it("grants strictly minimum INSERT and UPDATE to authenticated, never ALL or DELETE", () => {
      assert.match(sql020, /GRANT INSERT, UPDATE ON TABLE public\.enhancement_queue_item_attempts TO authenticated;/i);
      assert.doesNotMatch(sql020, /GRANT ALL ON (TABLE )?public\.enhancement_queue_item_attempts TO authenticated/i);
      assert.doesNotMatch(sql020, /GRANT DELETE ON (TABLE )?public\.enhancement_queue_item_attempts TO authenticated/i);
    });

    it("enforces device ownership RLS for INSERT", () => {
      assert.match(sql020, /CREATE POLICY device_enhancement_queue_item_attempts_insert ON public\.enhancement_queue_item_attempts/i);
      assert.match(sql020, /FOR INSERT/i);
      assert.match(sql020, /TO authenticated/i);
      assert.match(sql020, /d\.device_auth_id = auth\.uid\(\)/i);
      assert.match(sql020, /j\.status = 'RUNNING'/i);
    });

    it("enforces device ownership RLS for UPDATE", () => {
      assert.match(sql020, /CREATE POLICY device_enhancement_queue_item_attempts_update ON public\.enhancement_queue_item_attempts/i);
      assert.match(sql020, /FOR UPDATE/i);
      assert.match(sql020, /TO authenticated/i);
      assert.match(sql020, /d\.device_auth_id = auth\.uid\(\)/i);
    });
  });

  describe("Hardened Trigger Guarantees", () => {
    it("verifies authenticated device owns target account on INSERT and UPDATE", () => {
      assert.match(sql020, /Device % is not authorized to create attempt ledger for account %/i);
      assert.match(sql020, /Device % is not authorized to update attempt ledger for account %/i);
    });

    it("enforces monotonic sequential attempt_number", () => {
      assert.match(sql020, /SELECT COALESCE\(max\(attempt_number\), 0\) \+ 1 INTO v_expected_attempt_number/i);
      assert.match(sql020, /Invalid attempt_number % for item %: expected %/i);
    });

    it("requires initial phase to be NONE or PREPARING", () => {
      assert.match(sql020, /NEW\.attempt_phase NOT IN \('NONE', 'PREPARING'\)/i);
    });

    it("enforces strict immutability of identity, sequence, and bindings on UPDATE", () => {
      assert.match(sql020, /attempt_uuid is immutable/i);
      assert.match(sql020, /item_id is immutable/i);
      assert.match(sql020, /job_id is immutable/i);
      assert.match(sql020, /account_id is immutable/i);
      assert.match(sql020, /attempt_number is immutable/i);
      assert.match(sql020, /expected_level is immutable/i);
      assert.match(sql020, /step_target_level is immutable/i);
      assert.match(sql020, /queue_item_final_target_level is immutable/i);
    });

    it("permanently protects SETTLED attempt rows from rewrite or reopening", () => {
      assert.match(sql020, /OLD\.attempt_phase = 'SETTLED'/i);
      assert.match(sql020, /Settled attempt % is permanently immutable and cannot be rewritten or reopened/i);
    });

    it("enforces monotonic attempt phase transitions", () => {
      assert.match(sql020, /Monotonic phase violation: cannot transition attempt % from % to %/i);
    });

    it("enforces exactly-once settlement contract", () => {
      assert.match(sql020, /Settled attempt % must declare settlement_source as RESULT_CODE or STATE_RECONCILED/i);
    });
  });

  describe("Publication Gate: enhancement-queue-v2 and enhancement-multilevel-v1", () => {
    it("updates publish_enhancement_queue_job to enforce enhancement-queue-v2", () => {
      assert.match(sql020, /CREATE OR REPLACE FUNCTION public\.publish_enhancement_queue_job/i);
      assert.match(sql020, /enhancement-queue-v2/i);
      assert.match(sql020, /device % lacks capability enhancement-queue-v2/i);
    });

    it("preserves multi-level check requiring enhancement-multilevel-v1", () => {
      assert.match(sql020, /target_level > initial_level \+ 1/i);
      assert.match(sql020, /device % lacks capability enhancement-multilevel-v1/i);
    });

    it("validates device status and fresh heartbeat within 5 minutes", () => {
      assert.match(sql020, /device % is not online/i);
      assert.match(sql020, /device % heartbeat is stale/i);
      assert.match(sql020, /interval '5 minutes'/i);
    });
  });

  describe("Administrative Pre-Fence Recovery RPC", () => {
    it("defines public.admin_recover_stranded_prefence_job as SECURITY DEFINER", () => {
      assert.match(sql020, /CREATE OR REPLACE FUNCTION public\.admin_recover_stranded_prefence_job\(p_job_id uuid\)/i);
      assert.match(sql020, /SECURITY DEFINER/i);
    });

    it("requires cancel_requested_at, zero mutation fence, zero spend, and pre-fence phase", () => {
      assert.match(sql020, /cancel_requested_at is not present/i);
      assert.match(sql020, /execute_may_have_been_sent_at IS NOT NULL/i);
      assert.match(sql020, /non-zero spend detected/i);
    });

    it("atomically cancels items/job and releases exclusivity", () => {
      assert.match(sql020, /SET status = 'CANCELLED'/i);
      assert.match(sql020, /cancel_requested_at = NULL/i);
    });

    it("restricts administrative recovery RPC to service_role only", () => {
      assert.match(sql020, /REVOKE ALL ON FUNCTION public\.admin_recover_stranded_prefence_job\(uuid\) FROM anon, PUBLIC, authenticated;/i);
      assert.match(sql020, /GRANT EXECUTE ON FUNCTION public\.admin_recover_stranded_prefence_job\(uuid\) TO service_role;/i);
    });
  });
});

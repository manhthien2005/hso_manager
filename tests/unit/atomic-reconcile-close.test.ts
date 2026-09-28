/**
 * Enhancement Queue Atomic Reconcile & Close Contract Tests (ENHANCE-05N)
 */

import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mock.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "mock-anon-key";

const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith("@/")) {
    target = new URL("../../src/" + target.slice(2), "${import.meta.url}").href;
  }
  if (target === "next/server") {
    try {
      return await nextResolve("next/server.js", context);
    } catch (_) {}
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

const { QUEUE_ERROR_CODES } = await import("../../src/lib/queue");
const {
  executeAtomicReconcileAndCloseFlow,
  mapQueueJobRow,
} = await import("../../src/services/queue-service");

describe("Atomic Reconcile and Close Contract (ENHANCE-05N)", () => {
  const migration013Path = path.resolve(process.cwd(), "supabase/migrations/013_enhancement_queue.sql");
  const migration014Path = path.resolve(process.cwd(), "supabase/migrations/014_enhancement_manual_review_resolution.sql");
  const migration015Path = path.resolve(process.cwd(), "supabase/migrations/015_enhancement_reconciliation_provenance.sql");
  const migration016Path = path.resolve(process.cwd(), "supabase/migrations/016_enhancement_atomic_reconcile_close.sql");

  describe("1. Database Migration 016 Contract & Schema Invariants", () => {
    it("migration 016 file exists, is non-empty, and forward-only", () => {
      assert.ok(fs.existsSync(migration016Path), "migration 016 must exist");
      const sql016 = fs.readFileSync(migration016Path, "utf-8");
      assert.ok(sql016.length > 500, "migration 016 must be non-empty");
      assert.doesNotMatch(sql016, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sql016, /TRUNCATE/i);
    });

    it("migrations 013, 014, and 015 remain strictly unmodified", () => {
      assert.ok(fs.existsSync(migration013Path));
      assert.ok(fs.existsSync(migration014Path));
      assert.ok(fs.existsSync(migration015Path));

      const sql013 = fs.readFileSync(migration013Path, "utf-8");
      const sql014 = fs.readFileSync(migration014Path, "utf-8");
      const sql015 = fs.readFileSync(migration015Path, "utf-8");

      assert.match(sql013, /Migration 013: Enhancement Queue Schema Contract \(ENHANCE-05A\)/);
      assert.match(sql014, /Migration 014: Enhancement Queue Manual Review Administrative Resolution/);
      assert.match(sql015, /Migration 015: Enhancement Queue Non-Replay State Reconciliation Provenance/);
    });

    it("safely extends resolution_kind check constraint to permit RECONCILED_SUCCESS_CLOSE_REMAINDER", () => {
      const sql016 = fs.readFileSync(migration016Path, "utf-8");
      assert.match(sql016, /enhancement_queue_jobs_resolution_kind_check/i);
      assert.match(sql016, /RECONCILED_SUCCESS_CLOSE_REMAINDER/i);
      assert.match(sql016, /ABANDON_UNRESOLVED/i);
    });

    it("defines canonical transactional RPC reconcile_enhancement_manual_review_and_close with row locking", () => {
      const sql016 = fs.readFileSync(migration016Path, "utf-8");
      assert.match(sql016, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reconcile_enhancement_manual_review_and_close/i);
      assert.match(sql016, /FOR\s+UPDATE/i, "Must use FOR UPDATE row locking");
      assert.match(sql016, /ORDER\s+BY\s+queue_order/i, "Must lock items in deterministic order");
      assert.match(sql016, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.reconcile_enhancement_manual_review_and_close/i);
      assert.match(sql016, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.reconcile_enhancement_manual_review_and_close[\s\S]*TO\s+service_role/i);
    });

    it("contains NO hardcoded business rule pricing constants (3000 or 250)", () => {
      const sql016 = fs.readFileSync(migration016Path, "utf-8");
      assert.doesNotMatch(sql016, /\b3000\b/, "Must not hardcode 3000 Gold enhancement price");
      assert.doesNotMatch(sql016, /\b250\b/, "Must not hardcode 250 Gold routing price");
    });
  });

  describe("2. Atomic Recovery Invariants & State Transition", () => {
    const validJobId = "536ab92e-2080-496c-8a53-5789ba2fcee9";
    const candidateAItemId = "item-a-uuid";
    const candidateBItemId = "item-b-uuid";
    const attemptUuid = "7d900ac4-9307-4a24-b637-9ded6fc6d8af";
    const userId = "user-123";
    const accountId = "acc-456";

    interface DbState {
      job: any;
      items: any[];
    }

    function createSimulatedDb(): DbState {
      return {
        job: {
          id: validJobId,
          account_id: accountId,
          device_id: "dev-1",
          user_id: userId,
          status: "MANUAL_REVIEW_REQUIRED",
          active_item_id: candidateAItemId,
          active_attempt_uuid: attemptUuid,
          active_command_id: null,
          total_items: 2,
          completed_items: 0,
          claimed_by: "worker-1",
          claimed_at: new Date().toISOString(),
          claim_expires_at: null,
          pause_requested_at: null,
          cancel_requested_at: null,
          error_code: "EXEC_TIMEOUT",
          error_message: "timeout waiting for result",
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          finished_at: null,
          updated_at: new Date().toISOString(),
          resolution_kind: null,
          resolved_at: null,
          resolved_by: null,
          resolution_note: null,
        },
        items: [
          {
            id: candidateAItemId,
            job_id: validJobId,
            account_id: accountId,
            user_id: userId,
            queue_order: 1,
            captured_slot: 0,
            template_id: 101,
            category: 3,
            base_name: "Raptor",
            tier: 1,
            icon: 1,
            initial_level: 0,
            current_level: 0,
            target_level: 1,
            payment_type: "GOLD",
            charm_mode: "NONE",
            status: "MANUAL_REVIEW_REQUIRED",
            attempt_count: 1,
            active_attempt_uuid: attemptUuid,
            attempt_phase: "EXECUTE_MAY_HAVE_BEEN_SENT",
            attempt_expected_level: 0,
            attempt_target_level: 1,
            attempt_started_at: new Date().toISOString(),
            execute_may_have_been_sent_at: new Date().toISOString(),
            attempt_settled_at: null,
            last_result_code: null,
            settlement_source: null,
            reconciled_at: null,
            reconciliation_reason: null,
            actual_gold_spent: 0,
            actual_gem_spent: 0,
            actual_material_1_spent: 0,
            actual_material_2_spent: 0,
            actual_material_3_spent: 0,
            actual_material_4_spent: 0,
            actual_charm_spent: 0,
            error_code: null,
            errorMessage: null,
            started_at: new Date().toISOString(),
            finished_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: candidateBItemId,
            job_id: validJobId,
            account_id: accountId,
            user_id: userId,
            queue_order: 2,
            captured_slot: 1,
            template_id: 102,
            category: 3,
            base_name: "Iron Bow",
            tier: 1,
            icon: 2,
            initial_level: 0,
            current_level: 0,
            target_level: 1,
            payment_type: "GOLD",
            charm_mode: "NONE",
            status: "PENDING",
            attempt_count: 0,
            active_attempt_uuid: null,
            attempt_phase: "NONE",
            attempt_expected_level: null,
            attempt_target_level: null,
            attempt_started_at: null,
            execute_may_have_been_sent_at: null,
            attempt_settled_at: null,
            last_result_code: null,
            settlement_source: null,
            reconciled_at: null,
            reconciliation_reason: null,
            actual_gold_spent: 0,
            actual_gem_spent: 0,
            actual_material_1_spent: 0,
            actual_material_2_spent: 0,
            actual_material_3_spent: 0,
            actual_material_4_spent: 0,
            actual_charm_spent: 0,
            error_code: null,
            errorMessage: null,
            started_at: null,
            finished_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    }

    function createMockClient(db: DbState): any {
      return {
        from: (table: string) => {
          if (table === "enhancement_queue_jobs") {
            return {
              select: () => ({
                eq: (_col: string, val: string) => ({
                  maybeSingle: async () => {
                    if (val === db.job.id) return { data: structuredClone(db.job), error: null };
                    return { data: null, error: null };
                  },
                }),
              }),
            };
          }
          if (table === "enhancement_queue_items") {
            return {
              select: () => ({
                eq: (_col: string, val: string) => ({
                  data: db.items.filter((it) => it.job_id === val).map((it) => structuredClone(it)),
                  error: null,
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        rpc: async (fn: string, args: any) => {
          if (fn !== "reconcile_enhancement_manual_review_and_close") {
            throw new Error(`Unknown RPC ${fn}`);
          }

          const {
            p_job_id,
            p_target_item_id,
            p_attempt_uuid,
            p_proven_target_level,
            p_actual_gold_spent = 0,
            p_actual_gem_spent = 0,
            p_actual_material_1_spent = 0,
            p_actual_material_2_spent = 0,
            p_actual_material_3_spent = 0,
            p_actual_material_4_spent = 0,
            p_actual_charm_spent = 0,
            p_reconciliation_reason = "STATE_RECONCILED_SUCCESS",
            p_resolution_note = null,
          } = args;

          if (db.job.id !== p_job_id) {
            return { data: null, error: { message: `enhancement queue job ${p_job_id} not found` } };
          }

          // Idempotency: if already cancelled with RECONCILED_SUCCESS_CLOSE_REMAINDER
          if (db.job.status === "CANCELLED" && db.job.resolution_kind === "RECONCILED_SUCCESS_CLOSE_REMAINDER") {
            const target = db.items.find((i) => i.id === p_target_item_id);
            if (
              target &&
              target.status === "COMPLETED" &&
              target.settlement_source === "STATE_RECONCILED" &&
              target.active_attempt_uuid === p_attempt_uuid &&
              target.current_level === p_proven_target_level &&
              target.actual_gold_spent === p_actual_gold_spent &&
              target.actual_gem_spent === p_actual_gem_spent &&
              target.actual_material_1_spent === p_actual_material_1_spent &&
              target.actual_material_2_spent === p_actual_material_2_spent &&
              target.actual_material_3_spent === p_actual_material_3_spent &&
              target.actual_material_4_spent === p_actual_material_4_spent &&
              target.actual_charm_spent === p_actual_charm_spent
            ) {
              return { data: structuredClone(db.job), error: null };
            }
            return {
              data: null,
              error: { message: "CONFLICTING_RECOVERY: job already reconciled with different parameters" },
            };
          }

          if (db.job.status !== "MANUAL_REVIEW_REQUIRED") {
            return {
              data: null,
              error: {
                message: `job ${p_job_id} cannot be reconciled: current status is ${db.job.status} (must be MANUAL_REVIEW_REQUIRED)`,
              },
            };
          }

          const target = db.items.find((i) => i.id === p_target_item_id);
          if (!target) {
            return { data: null, error: { message: `reconciliation target item ${p_target_item_id} not found` } };
          }

          if (target.status !== "MANUAL_REVIEW_REQUIRED") {
            return {
              data: null,
              error: {
                message: `target item status is ${target.status} (must be MANUAL_REVIEW_REQUIRED)`,
              },
            };
          }

          if (target.active_attempt_uuid !== p_attempt_uuid) {
            return {
              data: null,
              error: {
                message: `ATTEMPT_UUID_MISMATCH: item active_attempt_uuid ${target.active_attempt_uuid} does not match recovery attempt_uuid ${p_attempt_uuid}`,
              },
            };
          }

          const validPhases = ["EXECUTE_MAY_HAVE_BEEN_SENT", "WAITING_RESULT", "WAITING_SETTLEMENT"];
          if (!validPhases.includes(target.attempt_phase)) {
            return {
              data: null,
              error: {
                message: `INVALID_ATTEMPT_PHASE: target item attempt_phase ${target.attempt_phase} is not post-fence`,
              },
            };
          }

          if (target.last_result_code !== null) {
            return {
              data: null,
              error: {
                message: `AUTHORITATIVE_RESULT_ALREADY_EXISTS: target item already has result code ${target.last_result_code}`,
              },
            };
          }

          if (target.attempt_settled_at !== null) {
            return {
              data: null,
              error: { message: `ITEM_ALREADY_SETTLED: target item already has attempt_settled_at` },
            };
          }

          if (target.settlement_source !== null) {
            return {
              data: null,
              error: { message: `SETTLEMENT_SOURCE_CONFLICT: target item already has settlement_source` },
            };
          }

          if (target.target_level !== p_proven_target_level) {
            return {
              data: null,
              error: {
                message: `TARGET_LEVEL_MISMATCH: proven target level ${p_proven_target_level} does not match item target_level ${target.target_level}`,
              },
            };
          }

          // Remaining items check
          const remainingItems = db.items.filter((i) => i.id !== p_target_item_id);
          for (const rem of remainingItems) {
            if (
              rem.status !== "PENDING" ||
              rem.active_attempt_uuid !== null ||
              rem.attempt_count > 0 ||
              rem.attempt_phase !== "NONE" ||
              rem.attempt_settled_at !== null ||
              rem.last_result_code !== null ||
              rem.actual_gold_spent > 0 ||
              rem.actual_gem_spent > 0 ||
              rem.actual_material_1_spent > 0 ||
              rem.actual_material_2_spent > 0 ||
              rem.actual_material_3_spent > 0 ||
              rem.actual_material_4_spent > 0 ||
              rem.actual_charm_spent > 0
            ) {
              return {
                data: null,
                error: {
                  message: `REMAINING_ITEM_EXECUTION_DETECTED: remaining item ${rem.id} has execution history or spend`,
                },
              };
            }
          }

          // Settle Candidate A
          target.status = "COMPLETED";
          target.current_level = p_proven_target_level;
          target.settlement_source = "STATE_RECONCILED";
          target.reconciled_at = new Date().toISOString();
          target.reconciliation_reason = p_reconciliation_reason;
          target.actual_gold_spent = p_actual_gold_spent;
          target.actual_gem_spent = p_actual_gem_spent;
          target.actual_material_1_spent = p_actual_material_1_spent;
          target.actual_material_2_spent = p_actual_material_2_spent;
          target.actual_material_3_spent = p_actual_material_3_spent;
          target.actual_material_4_spent = p_actual_material_4_spent;
          target.actual_charm_spent = p_actual_charm_spent;
          target.attempt_settled_at = new Date().toISOString();
          target.attempt_phase = "SETTLED";
          target.finished_at = new Date().toISOString();
          target.updated_at = new Date().toISOString();

          // Cancel remaining items
          for (const rem of remainingItems) {
            rem.status = "CANCELLED";
            rem.finished_at = new Date().toISOString();
            rem.updated_at = new Date().toISOString();
          }

          // Terminalize job
          db.job.status = "CANCELLED";
          db.job.resolution_kind = "RECONCILED_SUCCESS_CLOSE_REMAINDER";
          db.job.resolved_at = new Date().toISOString();
          db.job.resolved_by = userId;
          db.job.resolution_note = p_resolution_note;
          db.job.completed_items = 1;
          db.job.finished_at = new Date().toISOString();
          db.job.updated_at = new Date().toISOString();

          return { data: structuredClone(db.job), error: null };
        },
      };
    }

    it("atomically reconciles Candidate A, cancels Candidate B, and terminalizes job", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      const resolved = await executeAtomicReconcileAndCloseFlow(
        client,
        {
          jobId: validJobId,
          targetItemId: candidateAItemId,
          attemptUuid,
          provenTargetLevel: 1,
          spendGold: 3000,
          spendMaterial1: 1,
          spendMaterial2: 1,
          reconciliationReason: "Item level 1 confirmed in inventory without replay",
          resolutionNote: "Atomic administrative recovery",
        },
        { userId },
      );

      // Verify Job
      assert.equal(resolved.status, "CANCELLED");
      assert.equal(resolved.resolutionKind, "RECONCILED_SUCCESS_CLOSE_REMAINDER");
      assert.ok(resolved.resolvedAt);
      assert.equal(resolved.completedItems, 1);

      // Verify Candidate A
      const itemA = db.items.find((i) => i.id === candidateAItemId);
      assert.equal(itemA.status, "COMPLETED");
      assert.equal(itemA.current_level, 1);
      assert.equal(itemA.settlement_source, "STATE_RECONCILED");
      assert.equal(itemA.last_result_code, null, "last_result_code must remain NULL");
      assert.equal(itemA.active_attempt_uuid, attemptUuid, "attempt UUID must be preserved");
      assert.equal(itemA.actual_gold_spent, 3000);
      assert.equal(itemA.actual_material_1_spent, 1);
      assert.equal(itemA.actual_material_2_spent, 1);
      assert.ok(itemA.attempt_settled_at);
      assert.equal(itemA.attempt_phase, "SETTLED");

      // Verify Candidate B
      const itemB = db.items.find((i) => i.id === candidateBItemId);
      assert.equal(itemB.status, "CANCELLED");
      assert.equal(itemB.attempt_count, 0, "Candidate B attempt count must remain 0");
      assert.equal(itemB.active_attempt_uuid, null, "Candidate B attempt UUID must remain NULL");
      assert.equal(itemB.last_result_code, null);
      assert.equal(itemB.actual_gold_spent, 0);
      assert.equal(itemB.attempt_settled_at, null);
    });

    it("idempotently handles repeated identical recovery calls without double settlement", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      const params = {
        jobId: validJobId,
        targetItemId: candidateAItemId,
        attemptUuid,
        provenTargetLevel: 1,
        spendGold: 3000,
        spendMaterial1: 1,
        spendMaterial2: 1,
      };

      const first = await executeAtomicReconcileAndCloseFlow(client, params, { userId });
      assert.equal(first.status, "CANCELLED");

      const itemAAfterFirst = db.items.find((i) => i.id === candidateAItemId);
      const settledAt = itemAAfterFirst.attempt_settled_at;

      const second = await executeAtomicReconcileAndCloseFlow(client, params, { userId });
      assert.equal(second.status, "CANCELLED");

      const itemAAfterSecond = db.items.find((i) => i.id === candidateAItemId);
      assert.equal(itemAAfterSecond.actual_gold_spent, 3000, "Spend must not double");
      assert.equal(itemAAfterSecond.attempt_settled_at, settledAt, "Settlement timestamp must not change");
    });

    it("fails closed on conflicting second invocation with different spend evidence", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await executeAtomicReconcileAndCloseFlow(
        client,
        {
          jobId: validJobId,
          targetItemId: candidateAItemId,
          attemptUuid,
          provenTargetLevel: 1,
          spendGold: 3000,
        },
        { userId },
      );

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid,
              provenTargetLevel: 1,
              spendGold: 5000, // CONFLICTING EVIDENCE
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /CONFLICTING_RECOVERY/i);
          return true;
        },
      );
    });

    it("rejects if attempt UUID does not match", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: "00000000-0000-0000-0000-000000000000",
              provenTargetLevel: 1,
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /ATTEMPT_UUID_MISMATCH/i);
          return true;
        },
      );
    });

    it("rejects if target item is not MANUAL_REVIEW_REQUIRED", async () => {
      const db = createSimulatedDb();
      db.items[0].status = "RUNNING";
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid,
              provenTargetLevel: 1,
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /status is RUNNING/i);
          return true;
        },
      );
    });

    it("rejects if target item already has an authoritative result code", async () => {
      const db = createSimulatedDb();
      db.items[0].last_result_code = "1";
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid,
              provenTargetLevel: 1,
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /AUTHORITATIVE_RESULT_ALREADY_EXISTS/i);
          return true;
        },
      );
    });

    it("rejects if remaining Candidate B has attempt history or execution", async () => {
      const db = createSimulatedDb();
      db.items[1].attempt_count = 1; // Illegal attempt history
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid,
              provenTargetLevel: 1,
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /REMAINING_ITEM_EXECUTION_DETECTED/i);
          return true;
        },
      );
    });

    it("rejects if remaining Candidate B has non-zero spend", async () => {
      const db = createSimulatedDb();
      db.items[1].actual_gold_spent = 500; // Illegal spend
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid,
              provenTargetLevel: 1,
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /REMAINING_ITEM_EXECUTION_DETECTED/i);
          return true;
        },
      );
    });

    it("rejects if proven target level does not match queued target level", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicReconcileAndCloseFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid,
              provenTargetLevel: 2, // Candidate A queued target level is 1
            },
            { userId },
          );
        },
        (err: any) => {
          assert.match(err.message, /TARGET_LEVEL_MISMATCH/i);
          return true;
        },
      );
    });
  });
});

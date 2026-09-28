/**
 * Enhancement Queue Captured Authoritative Result Recovery Contract Tests (ENHANCE-05R)
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
  executeAtomicCapturedResultRecoveryFlow,
  mapQueueJobRow,
} = await import("../../src/services/queue-service");

describe("Captured Authoritative Result Recovery Contract (ENHANCE-05R)", () => {
  const migration013Path = path.resolve(process.cwd(), "supabase/migrations/013_enhancement_queue.sql");
  const migration014Path = path.resolve(process.cwd(), "supabase/migrations/014_enhancement_manual_review_resolution.sql");
  const migration015Path = path.resolve(process.cwd(), "supabase/migrations/015_enhancement_reconciliation_provenance.sql");
  const migration016Path = path.resolve(process.cwd(), "supabase/migrations/016_enhancement_atomic_reconcile_close.sql");
  const migration017Path = path.resolve(process.cwd(), "supabase/migrations/017_enhancement_captured_result_recovery.sql");

  describe("1. Database Migration 017 Contract & Schema Invariants", () => {
    it("migration 017 file exists, is non-empty, and forward-only", () => {
      assert.ok(fs.existsSync(migration017Path), "migration 017 must exist");
      const sql017 = fs.readFileSync(migration017Path, "utf-8");
      assert.ok(sql017.length > 500, "migration 017 must be non-empty");
      assert.doesNotMatch(sql017, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sql017, /TRUNCATE/i);
    });

    it("migrations 013, 014, 015, and 016 remain strictly unmodified", () => {
      assert.ok(fs.existsSync(migration013Path));
      assert.ok(fs.existsSync(migration014Path));
      assert.ok(fs.existsSync(migration015Path));
      assert.ok(fs.existsSync(migration016Path));

      const sql013 = fs.readFileSync(migration013Path, "utf-8");
      const sql014 = fs.readFileSync(migration014Path, "utf-8");
      const sql015 = fs.readFileSync(migration015Path, "utf-8");
      const sql016 = fs.readFileSync(migration016Path, "utf-8");

      assert.match(sql013, /Migration 013: Enhancement Queue Schema Contract \(ENHANCE-05A\)/);
      assert.match(sql014, /Migration 014: Enhancement Queue Manual Review Administrative Resolution/);
      assert.match(sql015, /Migration 015: Enhancement Queue Non-Replay State Reconciliation Provenance/);
      assert.match(sql016, /Migration 016: Enhancement Queue Atomic State Reconcile and Close/);
    });

    it("safely extends resolution_kind check constraint to permit RESULT_CODE_SUCCESS_CLOSE_REMAINDER", () => {
      const sql017 = fs.readFileSync(migration017Path, "utf-8");
      assert.match(sql017, /enhancement_queue_jobs_resolution_kind_check/i);
      assert.match(sql017, /RESULT_CODE_SUCCESS_CLOSE_REMAINDER/i);
      assert.match(sql017, /RECONCILED_SUCCESS_CLOSE_REMAINDER/i);
      assert.match(sql017, /ABANDON_UNRESOLVED/i);
    });

    it("defines canonical transactional RPC recover_enhancement_result_code_success_and_close with row locking", () => {
      const sql017 = fs.readFileSync(migration017Path, "utf-8");
      assert.match(sql017, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.recover_enhancement_result_code_success_and_close/i);
      assert.match(sql017, /FOR\s+UPDATE/i, "Must use FOR UPDATE row locking");
      assert.match(sql017, /ORDER\s+BY\s+queue_order\s+ASC/i, "Must lock items in deterministic order");
      assert.match(sql017, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.recover_enhancement_result_code_success_and_close/i);
      assert.match(sql017, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.recover_enhancement_result_code_success_and_close[\s\S]*TO\s+service_role/i);
    });

    it("strictly validates result_code=3 as authoritative success in the RPC", () => {
      const sql017 = fs.readFileSync(migration017Path, "utf-8");
      assert.match(sql017, /p_captured_result_code\s+IS\s+NULL\s+OR\s+p_captured_result_code\s*<>\s*3/i);
      assert.match(sql017, /INVALID_RESULT_CODE/i);
    });

    it("contains NO hardcoded business rule pricing constants (3000 or 250)", () => {
      const sql017 = fs.readFileSync(migration017Path, "utf-8");
      assert.doesNotMatch(sql017, /\b3000\b/, "Must not hardcode 3000 Gold enhancement price");
      assert.doesNotMatch(sql017, /\b250\b/, "Must not hardcode 250 Gold routing price");
    });
  });

  describe("2. Atomic Recovery Invariants & State Transition", () => {
    const validJobId = "536ab92e-2080-496c-8a53-5789ba2fcee9";
    const candidateAItemId = "item-a-uuid";
    const candidateBItemId = "item-b-uuid";
    const attemptUuid = "5c0882b8-478c-4c9e-a753-bd8730c6a557";
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
          error_code: "MANUAL_REVIEW_REQUIRED",
          error_message: "Terminal status lost after Opcode67 command",
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
            template_id: 66,
            category: 3,
            base_name: "Kiếm nhân mã",
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
            error_message: null,
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
            template_id: 70,
            category: 3,
            base_name: "Nhẫn nhân mã [Khoá]",
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
            error_message: null,
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
          if (fn !== "recover_enhancement_result_code_success_and_close") {
            throw new Error(`Unknown RPC ${fn}`);
          }

          const {
            p_job_id,
            p_target_item_id,
            p_attempt_uuid,
            p_proven_target_level,
            p_captured_result_code = 3,
            p_actual_gold_spent = 0,
            p_actual_gem_spent = 0,
            p_actual_material_1_spent = 0,
            p_actual_material_2_spent = 0,
            p_actual_material_3_spent = 0,
            p_actual_material_4_spent = 0,
            p_actual_charm_spent = 0,
            p_resolution_note = null,
          } = args;

          if (db.job.id !== p_job_id) {
            return { data: null, error: { message: `enhancement queue job ${p_job_id} not found` } };
          }

          // Idempotency: if already cancelled with RESULT_CODE_SUCCESS_CLOSE_REMAINDER
          if (db.job.status === "CANCELLED" && db.job.resolution_kind === "RESULT_CODE_SUCCESS_CLOSE_REMAINDER") {
            const target = db.items.find((i) => i.id === p_target_item_id);
            if (
              target &&
              target.status === "COMPLETED" &&
              target.settlement_source === "RESULT_CODE" &&
              target.last_result_code === String(p_captured_result_code) &&
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
              error: { message: "CONFLICTING_RECOVERY: job already recovered with different parameters" },
            };
          }

          if (db.job.status !== "MANUAL_REVIEW_REQUIRED") {
            return {
              data: null,
              error: {
                message: `job ${p_job_id} cannot be recovered: current status is ${db.job.status} (must be MANUAL_REVIEW_REQUIRED)`,
              },
            };
          }

          const target = db.items.find((i) => i.id === p_target_item_id);
          if (!target) {
            return { data: null, error: { message: `recovery target item ${p_target_item_id} not found` } };
          }

          if (target.status !== "MANUAL_REVIEW_REQUIRED") {
            return {
              data: null,
              error: { message: `target item status is ${target.status} (must be MANUAL_REVIEW_REQUIRED)` },
            };
          }

          if (p_captured_result_code !== 3) {
            return {
              data: null,
              error: { message: `INVALID_RESULT_CODE: result_code ${p_captured_result_code} is not authoritative success 3` },
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

          if (target.last_result_code !== null) {
            return {
              data: null,
              error: {
                message: `AUTHORITATIVE_RESULT_ALREADY_EXISTS: target item already has result code ${target.last_result_code}`,
              },
            };
          }

          if (target.attempt_settled_at !== null || target.settlement_source !== null) {
            return {
              data: null,
              error: { message: "ITEM_ALREADY_SETTLED: target item already settled" },
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

          // Check remaining items
          const remainingItems = db.items.filter((i) => i.id !== p_target_item_id);
          for (const rem of remainingItems) {
            if (
              rem.status !== "PENDING" ||
              rem.active_attempt_uuid !== null ||
              rem.attempt_count > 0 ||
              rem.attempt_phase !== "NONE" ||
              rem.attempt_settled_at !== null ||
              rem.last_result_code !== null ||
              rem.settlement_source !== null ||
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
                  message:
                    "REMAINING_ITEM_EXECUTION_DETECTED: remaining items have begun execution or have spend",
                },
              };
            }
          }

          // Mutation 1: Settle Candidate A
          target.status = "COMPLETED";
          target.current_level = p_proven_target_level;
          target.settlement_source = "RESULT_CODE";
          target.last_result_code = String(p_captured_result_code);
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

          // Mutation 2: Cancel remaining unattempted items
          for (const rem of remainingItems) {
            rem.status = "CANCELLED";
            rem.finished_at = new Date().toISOString();
            rem.updated_at = new Date().toISOString();
          }

          // Mutation 3: Terminalize job
          db.job.status = "CANCELLED";
          db.job.resolution_kind = "RESULT_CODE_SUCCESS_CLOSE_REMAINDER";
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

    it("atomically recovers Candidate A with RESULT_CODE=3, cancels Candidate B, and terminalizes job", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      const resolved = await executeAtomicCapturedResultRecoveryFlow(
        client,
        {
          jobId: validJobId,
          targetItemId: candidateAItemId,
          attemptUuid: attemptUuid,
          provenTargetLevel: 1,
          capturedResultCode: 3,
          spendGold: 3000,
          spendMaterial1: 1,
          spendMaterial2: 1,
          resolutionNote: "Captured server success c.C=3",
        },
        { userId },
      );

      // Verify returned job
      assert.equal(resolved.status, "CANCELLED");
      assert.equal(resolved.resolutionKind, "RESULT_CODE_SUCCESS_CLOSE_REMAINDER");
      assert.equal(resolved.completedItems, 1);
      assert.ok(resolved.resolvedAt);

      // Verify Candidate A state
      const itemA = db.items.find((i) => i.id === candidateAItemId);
      assert.equal(itemA.status, "COMPLETED");
      assert.equal(itemA.current_level, 1);
      assert.equal(itemA.settlement_source, "RESULT_CODE");
      assert.equal(itemA.last_result_code, "3");
      assert.equal(itemA.reconciled_at, null, "Must NOT set reconciled_at for RESULT_CODE");
      assert.equal(itemA.reconciliation_reason, null, "Must NOT set reconciliation_reason for RESULT_CODE");
      assert.equal(itemA.actual_gold_spent, 3000);
      assert.equal(itemA.actual_material_1_spent, 1);
      assert.equal(itemA.actual_material_2_spent, 1);
      assert.equal(itemA.attempt_phase, "SETTLED");
      assert.ok(itemA.attempt_settled_at);

      // Verify Candidate B state
      const itemB = db.items.find((i) => i.id === candidateBItemId);
      assert.equal(itemB.status, "CANCELLED");
      assert.equal(itemB.attempt_count, 0);
      assert.equal(itemB.active_attempt_uuid, null);
      assert.equal(itemB.last_result_code, null);
      assert.equal(itemB.settlement_source, null);
      assert.equal(itemB.actual_gold_spent, 0);
    });

    it("idempotently handles repeated identical recovery calls without double settlement", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      const params = {
        jobId: validJobId,
        targetItemId: candidateAItemId,
        attemptUuid: attemptUuid,
        provenTargetLevel: 1,
        capturedResultCode: 3,
        spendGold: 3000,
        spendMaterial1: 1,
        spendMaterial2: 1,
      };

      const first = await executeAtomicCapturedResultRecoveryFlow(client, params, { userId });
      assert.equal(first.status, "CANCELLED");
      assert.equal(first.resolutionKind, "RESULT_CODE_SUCCESS_CLOSE_REMAINDER");

      // Repeated invocation
      const second = await executeAtomicCapturedResultRecoveryFlow(client, params, { userId });
      assert.equal(second.status, "CANCELLED");
      assert.equal(second.resolutionKind, "RESULT_CODE_SUCCESS_CLOSE_REMAINDER");

      // Verify spend was not doubled
      const itemA = db.items.find((i) => i.id === candidateAItemId);
      assert.equal(itemA.actual_gold_spent, 3000);
    });

    it("fails closed on conflicting second invocation with different spend evidence", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await executeAtomicCapturedResultRecoveryFlow(
        client,
        {
          jobId: validJobId,
          targetItemId: candidateAItemId,
          attemptUuid: attemptUuid,
          provenTargetLevel: 1,
          capturedResultCode: 3,
          spendGold: 3000,
        },
        { userId },
      );

      // Conflicting second call
      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
              spendGold: 5000, // Conflict!
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if attempt UUID does not match", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: "wrong-uuid-00000000",
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects result_code other than 3", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 1 as any, // Not 3
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID },
      );
    });

    it("rejects if target job is not in MANUAL_REVIEW_REQUIRED status", async () => {
      const db = createSimulatedDb();
      db.job.status = "RUNNING";
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if target item is not MANUAL_REVIEW_REQUIRED", async () => {
      const db = createSimulatedDb();
      db.items[0].status = "RUNNING";
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if target item already has an authoritative result code", async () => {
      const db = createSimulatedDb();
      db.items[0].last_result_code = "1";
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if target item already has settlement provenance", async () => {
      const db = createSimulatedDb();
      db.items[0].settlement_source = "STATE_RECONCILED";
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if remaining Candidate B has attempt history or execution", async () => {
      const db = createSimulatedDb();
      db.items[1].attempt_count = 1;
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if remaining Candidate B has non-zero spend", async () => {
      const db = createSimulatedDb();
      db.items[1].actual_gold_spent = 500;
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 1,
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("rejects if proven target level does not match queued target level", async () => {
      const db = createSimulatedDb();
      const client = createMockClient(db);

      await assert.rejects(
        async () => {
          await executeAtomicCapturedResultRecoveryFlow(
            client,
            {
              jobId: validJobId,
              targetItemId: candidateAItemId,
              attemptUuid: attemptUuid,
              provenTargetLevel: 2, // Candidate A has target_level: 1
              capturedResultCode: 3,
            },
            { userId },
          );
        },
        { name: "QueueError", code: QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT },
      );
    });

    it("simulates exact historical production reference job febfef9f-be77-4681-9512-51e870f47607", async () => {
      const refJobId = "febfef9f-be77-4681-9512-51e870f47607";
      const candAAttemptUuid = "5c0882b8-478c-4c9e-a753-bd8730c6a557";
      const candAItemId = "ref-cand-a-uuid";
      const candBItemId = "ref-cand-b-uuid";

      const db: DbState = {
        job: {
          id: refJobId,
          account_id: "acc-ref-1",
          device_id: "dev-ref-1",
          user_id: "user-ref-1",
          status: "MANUAL_REVIEW_REQUIRED",
          active_item_id: candAItemId,
          active_attempt_uuid: candAAttemptUuid,
          active_command_id: null,
          total_items: 2,
          completed_items: 0,
          claimed_by: "worker-ref",
          claimed_at: new Date().toISOString(),
          claim_expires_at: null,
          pause_requested_at: null,
          cancel_requested_at: null,
          error_code: "MANUAL_REVIEW_REQUIRED",
          error_message: "Terminal status lost after Opcode67 command",
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
            id: candAItemId,
            job_id: refJobId,
            account_id: "acc-ref-1",
            user_id: "user-ref-1",
            queue_order: 1,
            captured_slot: 0,
            template_id: 66,
            category: 3,
            base_name: "Kiếm nhân mã",
            tier: 1,
            icon: 1,
            initial_level: 0,
            current_level: 0,
            target_level: 1,
            payment_type: "GOLD",
            charm_mode: "NONE",
            status: "MANUAL_REVIEW_REQUIRED",
            attempt_count: 1,
            active_attempt_uuid: candAAttemptUuid,
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
            error_message: null,
            started_at: new Date().toISOString(),
            finished_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: candBItemId,
            job_id: refJobId,
            account_id: "acc-ref-1",
            user_id: "user-ref-1",
            queue_order: 2,
            captured_slot: 1,
            template_id: 70,
            category: 3,
            base_name: "Nhẫn nhân mã [Khoá]",
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
            error_message: null,
            started_at: null,
            finished_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };

      const client = createMockClient(db);

      // Invoke recovery with proven historical evidence
      const recovered = await executeAtomicCapturedResultRecoveryFlow(
        client,
        {
          jobId: refJobId,
          targetItemId: candAItemId,
          attemptUuid: candAAttemptUuid,
          provenTargetLevel: 1,
          capturedResultCode: 3,
          spendGold: 3000,
          spendGem: 0,
          spendMaterial1: 1,
          spendMaterial2: 1,
          spendMaterial3: 0,
          spendMaterial4: 0,
          spendCharm: 0,
          resolutionNote: "Production reference recovery via captured authoritative server result c.C=3",
        },
        { userId: "user-ref-1" },
      );

      // Verify historical evidence completely satisfies contract
      assert.equal(recovered.status, "CANCELLED");
      assert.equal(recovered.resolutionKind, "RESULT_CODE_SUCCESS_CLOSE_REMAINDER");
      assert.equal(recovered.completedItems, 1);

      const itemA = db.items.find((i) => i.id === candAItemId);
      assert.equal(itemA.status, "COMPLETED");
      assert.equal(itemA.current_level, 1);
      assert.equal(itemA.settlement_source, "RESULT_CODE");
      assert.equal(itemA.last_result_code, "3");
      assert.equal(itemA.reconciled_at, null);
      assert.equal(itemA.actual_gold_spent, 3000);
      assert.equal(itemA.actual_material_1_spent, 1);
      assert.equal(itemA.actual_material_2_spent, 1);

      const itemB = db.items.find((i) => i.id === candBItemId);
      assert.equal(itemB.status, "CANCELLED");
      assert.equal(itemB.attempt_count, 0);
      assert.equal(itemB.active_attempt_uuid, null);
    });
  });
});

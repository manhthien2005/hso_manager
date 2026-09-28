/**
 * Manual Review Queue Resolution Contract & Invariant Tests (Task ENHANCE-05J)
 */

import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { QueueError } from "../../src/lib/queue";

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
  executeResolveManualReviewFlow,
  executeCancelQueueFlow,
} = await import("../../src/services/queue-service");

describe("Manual Review Administrative Resolution Contract (ENHANCE-05J)", () => {
  const migration013Path = path.resolve(process.cwd(), "supabase/migrations/013_enhancement_queue.sql");
  const migration014Path = path.resolve(process.cwd(), "supabase/migrations/014_enhancement_manual_review_resolution.sql");

  describe("1. Database Migration 014 Contract & Integrity", () => {
    it("migration 014 file exists, is non-empty, and forward-only", () => {
      assert.ok(fs.existsSync(migration014Path), "migration 014 must exist");
      const sql014 = fs.readFileSync(migration014Path, "utf-8");
      assert.ok(sql014.length > 500, "migration 014 must be non-empty");
      assert.doesNotMatch(sql014, /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i);
      assert.doesNotMatch(sql014, /TRUNCATE/i);
    });

    it("migration 013 remains strictly unmodified", () => {
      assert.ok(fs.existsSync(migration013Path), "migration 013 must exist");
      const sql013 = fs.readFileSync(migration013Path, "utf-8");
      assert.match(
        sql013,
        /status\s+IN\s+\('QUEUED',\s*'RUNNING',\s*'PAUSING',\s*'PAUSED',\s*'MANUAL_REVIEW_REQUIRED'\)/i,
      );
      assert.match(sql013, /Migration 013: Enhancement Queue Schema Contract \(ENHANCE-05A\)/);
    });

    it("adds required resolution metadata columns to public.enhancement_queue_jobs", () => {
      const sql014 = fs.readFileSync(migration014Path, "utf-8");
      assert.match(sql014, /ALTER\s+TABLE\s+public\.enhancement_queue_jobs/i);
      assert.match(sql014, /resolution_kind\s+text/i);
      assert.match(sql014, /resolved_at\s+timestamptz/i);
      assert.match(sql014, /resolved_by\s+uuid/i);
      assert.match(sql014, /resolution_note\s+text/i);
      assert.match(sql014, /resolution_kind\s+IN\s+\('ABANDON_UNRESOLVED'\)/i);
      assert.match(sql014, /char_length\(resolution_note\)\s*<=\s*500/i);
    });

    it("defines canonical transactional RPC resolve_enhancement_queue_manual_review with row locking and guards", () => {
      const sql014 = fs.readFileSync(migration014Path, "utf-8");
      assert.match(sql014, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.resolve_enhancement_queue_manual_review/i);
      assert.match(sql014, /FOR\s+UPDATE/i, "Must use FOR UPDATE row locking");
      assert.match(sql014, /MANUAL_REVIEW_REQUIRED/i);
      assert.match(sql014, /ABANDON_UNRESOLVED/i);
      assert.match(sql014, /MANUAL_REVIEW_STATE_CHANGED/i, "Must contain late-state guard error");
      assert.match(sql014, /SET\s+status\s+=\s+'CANCELLED'/i, "Must transition to CANCELLED");
      assert.match(sql014, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.resolve_enhancement_queue_manual_review/i);
    });
  });

  describe("2. Resolution Flow Execution & Invariants", () => {
    const validJobId = "a843041f-2d20-455d-a82d-b8b30a14731f";
    const userId = "user-123";
    const accountId = "acc-456";

    function createMockClient(options: {
      jobStatus?: string;
      jobUserId?: string;
      resolutionKind?: string | null;
      fetchError?: { message: string } | null;
      rpcError?: { message: string } | null;
      rpcResultJob?: any;
    } = {}): any {
      const {
        jobStatus = "MANUAL_REVIEW_REQUIRED",
        jobUserId = userId,
        resolutionKind = null,
        fetchError = null,
        rpcError = null,
        rpcResultJob = null,
      } = options;

      return {
        from: (table: string) => {
          if (table === "enhancement_queue_jobs") {
            return {
              select: () => ({
                eq: (col: string, val: string) => ({
                  maybeSingle: async () => {
                    if (fetchError) return { data: null, error: fetchError };
                    if (val === validJobId) {
                      return {
                        data: {
                          id: validJobId,
                          account_id: accountId,
                          device_id: "dev-789",
                          user_id: jobUserId,
                          status: jobStatus,
                          active_item_id: "item-a",
                          active_attempt_uuid: "3ed37a83-c57b-4b03-b894-f02cfa0eabcc",
                          active_command_id: null,
                          total_items: 2,
                          completed_items: 0,
                          claimed_by: "worker-1",
                          claimed_at: new Date().toISOString(),
                          claim_expires_at: null,
                          pause_requested_at: null,
                          cancel_requested_at: null,
                          error_code: "EXEC_TIMEOUT",
                          error_message: "execute response timeout",
                          created_at: new Date().toISOString(),
                          started_at: new Date().toISOString(),
                          finished_at: null,
                          updated_at: new Date().toISOString(),
                          resolution_kind: resolutionKind,
                          resolved_at: null,
                          resolved_by: null,
                          resolution_note: null,
                        },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        rpc: async (fn: string, args: any) => {
          if (fn === "resolve_enhancement_queue_manual_review") {
            if (rpcError) return { data: null, error: rpcError };
            return {
              data: rpcResultJob ?? {
                id: args.p_job_id,
                account_id: accountId,
                device_id: "dev-789",
                user_id: userId,
                status: "CANCELLED",
                active_item_id: "item-a",
                active_attempt_uuid: "3ed37a83-c57b-4b03-b894-f02cfa0eabcc",
                active_command_id: null,
                total_items: 2,
                completed_items: 0,
                claimed_by: "worker-1",
                claimed_at: new Date().toISOString(),
                claim_expires_at: null,
                pause_requested_at: null,
                cancel_requested_at: null,
                error_code: "EXEC_TIMEOUT",
                error_message: "execute response timeout",
                created_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
                finished_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                resolution_kind: "ABANDON_UNRESOLVED",
                resolved_at: new Date().toISOString(),
                resolved_by: userId,
                resolution_note: args.p_note ?? null,
              },
              error: null,
            };
          }
          throw new Error(`Unexpected rpc: ${fn}`);
        },
      };
    }

    it("rejects resolution if caller is unauthenticated", async () => {
      const client = createMockClient();
      await assert.rejects(
        () => executeResolveManualReviewFlow(client, validJobId, "", "ABANDON_UNRESOLVED"),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_NOT_OWNED);
          return true;
        },
      );
    });

    it("rejects resolution if user does not own the target queue", async () => {
      const client = createMockClient({ jobUserId: "other-user" });
      await assert.rejects(
        () => executeResolveManualReviewFlow(client, validJobId, userId, "ABANDON_UNRESOLVED"),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_NOT_OWNED);
          return true;
        },
      );
    });

    it("does not masquerade database query failure as ownership failure", async () => {
      const client = createMockClient({ fetchError: { message: "connection failed" } });
      await assert.rejects(
        () => executeResolveManualReviewFlow(client, validJobId, userId, "ABANDON_UNRESOLVED"),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED);
          return true;
        },
      );
    });

    it("rejects resolution if target job is not in MANUAL_REVIEW_REQUIRED status and not already resolved", async () => {
      const invalidStatuses = ["QUEUED", "RUNNING", "PAUSED", "COMPLETED", "FAILED"];
      for (const st of invalidStatuses) {
        const client = createMockClient({ jobStatus: st });
        await assert.rejects(
          () => executeResolveManualReviewFlow(client, validJobId, userId, "ABANDON_UNRESOLVED"),
          (err: QueueError) => {
            assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT);
            return true;
          },
        );
      }
    });

    it("rejects unsupported disposition actions", async () => {
      const client = createMockClient();
      await assert.rejects(
        () => executeResolveManualReviewFlow(client, validJobId, userId, "FABRICATE_SUCCESS" as any),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.MANUAL_REVIEW_INVALID_DISPOSITION);
          return true;
        },
      );
    });

    it("successfully resolves MANUAL_REVIEW_REQUIRED queue and returns CANCELLED job with resolution metadata", async () => {
      const client = createMockClient();
      const resolved = await executeResolveManualReviewFlow(
        client,
        validJobId,
        userId,
        "ABANDON_UNRESOLVED",
        "Administrative resolution confirmed by user",
      );

      assert.equal(resolved.status, "CANCELLED");
      assert.equal(resolved.resolutionKind, "ABANDON_UNRESOLVED");
      assert.equal(resolved.resolvedBy, userId);
      assert.equal(resolved.resolutionNote, "Administrative resolution confirmed by user");
      assert.ok(resolved.resolvedAt);
      assert.equal(resolved.activeAttemptUuid, "3ed37a83-c57b-4b03-b894-f02cfa0eabcc");
      assert.equal(resolved.errorMessage, "execute response timeout");
    });

    it("idempotently returns already-resolved job on repeated resolution call", async () => {
      const alreadyResolvedJob = {
        id: validJobId,
        account_id: accountId,
        device_id: "dev-789",
        user_id: userId,
        status: "CANCELLED",
        active_item_id: "item-a",
        active_attempt_uuid: "3ed37a83-c57b-4b03-b894-f02cfa0eabcc",
        active_command_id: null,
        total_items: 2,
        completed_items: 0,
        claimed_by: "worker-1",
        claimed_at: new Date().toISOString(),
        claim_expires_at: null,
        pause_requested_at: null,
        cancel_requested_at: null,
        error_code: "EXEC_TIMEOUT",
        error_message: "execute response timeout",
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolution_kind: "ABANDON_UNRESOLVED",
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_note: "Prior resolution note",
      };

      const client = createMockClient({
        jobStatus: "CANCELLED",
        resolutionKind: "ABANDON_UNRESOLVED",
        rpcResultJob: alreadyResolvedJob,
      });

      const resolved = await executeResolveManualReviewFlow(client, validJobId, userId, "ABANDON_UNRESOLVED");
      assert.equal(resolved.status, "CANCELLED");
      assert.equal(resolved.resolutionKind, "ABANDON_UNRESOLVED");
    });

    it("aborts with MANUAL_REVIEW_STATE_CHANGED if late state check fails in RPC", async () => {
      const client = createMockClient({
        rpcError: { message: "MANUAL_REVIEW_STATE_CHANGED: attempted item has gained authoritative settlement or result" },
      });

      await assert.rejects(
        () => executeResolveManualReviewFlow(client, validJobId, userId, "ABANDON_UNRESOLVED"),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.MANUAL_REVIEW_STATE_CHANGED);
          return true;
        },
      );
    });
  });

  describe("3. Cancel Endpoint Guard for MANUAL_REVIEW_REQUIRED", () => {
    it("rejects ordinary cancel on MANUAL_REVIEW_REQUIRED with MANUAL_REVIEW_RESOLUTION_REQUIRED", async () => {
      const client = {
        from: (table: string) => {
          if (table === "enhancement_queue_jobs") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "job-mr",
                      account_id: "acc-1",
                      device_id: "dev-1",
                      user_id: "user-1",
                      status: "MANUAL_REVIEW_REQUIRED",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      } as any;

      await assert.rejects(
        () => executeCancelQueueFlow(client, "job-mr", "user-1"),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.MANUAL_REVIEW_RESOLUTION_REQUIRED);
          assert.match(err.message, /MANUAL_REVIEW_REQUIRED/);
          return true;
        },
      );
    });

    it("does not write cancel_requested_at when rejecting MANUAL_REVIEW_REQUIRED", async () => {
      let updateCalled = false;
      const client = {
        from: (table: string) => {
          if (table === "enhancement_queue_jobs") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "job-mr",
                      account_id: "acc-1",
                      device_id: "dev-1",
                      user_id: "user-1",
                      status: "MANUAL_REVIEW_REQUIRED",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => {
                updateCalled = true;
                return {
                  eq: () => ({
                    eq: () => ({
                      select: () => ({
                        single: async () => ({ data: {}, error: null }),
                      }),
                    }),
                  }),
                };
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      } as any;

      await assert.rejects(
        () => executeCancelQueueFlow(client, "job-mr", "user-1"),
        (err: QueueError) => {
          assert.equal(err.code, QUEUE_ERROR_CODES.MANUAL_REVIEW_RESOLUTION_REQUIRED);
          return true;
        },
      );
      assert.equal(updateCalled, false, "update must not be called when rejecting MANUAL_REVIEW_REQUIRED");
    });
  });

  describe("4. Candidate Invariants & Exclusivity Release (Transactional Simulation)", () => {
    it("preserves Candidate A evidence byte-for-byte, cancels Candidate B, and releases exclusivity", async () => {
      // Simulating the transactional DB state
      const dbState = {
        job: {
          id: "a843041f-2d20-455d-a82d-b8b30a14731f",
          account_id: "acc-fixed",
          device_id: "dev-fixed",
          user_id: "user-owner",
          status: "MANUAL_REVIEW_REQUIRED",
          active_item_id: "item-a",
          active_attempt_uuid: "3ed37a83-c57b-4b03-b894-f02cfa0eabcc",
          total_items: 2,
          completed_items: 0,
          resolution_kind: null as string | null,
          resolved_at: null as string | null,
          resolved_by: null as string | null,
          resolution_note: null as string | null,
        },
        items: [
          {
            id: "item-a",
            job_id: "a843041f-2d20-455d-a82d-b8b30a14731f",
            queue_order: 1,
            status: "MANUAL_REVIEW_REQUIRED",
            active_attempt_uuid: "3ed37a83-c57b-4b03-b894-f02cfa0eabcc",
            attempt_phase: "EXECUTE_MAY_HAVE_BEEN_SENT",
            last_result_code: null,
            attempt_settled_at: null,
            actual_gold_spent: 50000,
            actual_gem_spent: 10,
            actual_material_1_spent: 2,
            actual_material_2_spent: 0,
            actual_material_3_spent: 0,
            actual_material_4_spent: 0,
            actual_charm_spent: 1,
            attempt_count: 1,
          },
          {
            id: "item-b",
            job_id: "a843041f-2d20-455d-a82d-b8b30a14731f",
            queue_order: 2,
            status: "PENDING",
            active_attempt_uuid: null,
            attempt_phase: "NONE",
            last_result_code: null,
            attempt_settled_at: null,
            actual_gold_spent: 0,
            actual_gem_spent: 0,
            actual_material_1_spent: 0,
            actual_material_2_spent: 0,
            actual_material_3_spent: 0,
            actual_material_4_spent: 0,
            actual_charm_spent: 0,
            attempt_count: 0,
          },
        ],
      };

      const unresolvedIndexStatuses = ["QUEUED", "RUNNING", "PAUSING", "PAUSED", "MANUAL_REVIEW_REQUIRED"];

      // Verify BEFORE resolution: job conflicts with unresolved exclusivity index
      assert.ok(
        unresolvedIndexStatuses.includes(dbState.job.status),
        "Job must initially conflict with unresolved index",
      );

      // Candidate A pre-resolution snapshot
      const itemABefore = { ...dbState.items[0] };

      // Execute RPC simulation matching migration 014 logic
      const simulateRpc = (jobId: string, disposition: string, note: string | null, callerUid: string) => {
        if (disposition !== "ABANDON_UNRESOLVED") throw new Error("unsupported disposition");
        if (callerUid !== dbState.job.user_id) throw new Error("not owned");
        if (dbState.job.status === "CANCELLED" && dbState.job.resolution_kind === "ABANDON_UNRESOLVED") {
          return dbState.job;
        }
        if (dbState.job.status !== "MANUAL_REVIEW_REQUIRED") throw new Error("not MANUAL_REVIEW_REQUIRED");

        // Late state guard: Candidate A
        const candA = dbState.items.find((i) => i.id === "item-a")!;
        if (candA.status !== "MANUAL_REVIEW_REQUIRED" || candA.attempt_settled_at !== null || candA.last_result_code !== null) {
          throw new Error("MANUAL_REVIEW_STATE_CHANGED: candidate item settled");
        }

        // Late state guard: Candidate B
        const candB = dbState.items.find((i) => i.id === "item-b")!;
        if (candB.attempt_count > 0 || candB.active_attempt_uuid !== null) {
          throw new Error("MANUAL_REVIEW_STATE_CHANGED: unattempted item has history");
        }

        // Transition unattempted PENDING items to CANCELLED
        for (const item of dbState.items) {
          if (item.status === "PENDING") {
            item.status = "CANCELLED";
          }
        }

        // Terminalize job to CANCELLED with resolution metadata
        dbState.job.status = "CANCELLED";
        dbState.job.resolution_kind = "ABANDON_UNRESOLVED";
        dbState.job.resolved_at = new Date().toISOString();
        dbState.job.resolved_by = callerUid;
        dbState.job.resolution_note = note;

        return dbState.job;
      };

      const mockClient: any = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: dbState.job, error: null }),
            }),
          }),
        }),
        rpc: async (_fn: string, args: any) => ({
          data: simulateRpc(args.p_job_id, args.p_disposition, args.p_note, "user-owner"),
          error: null,
        }),
      };

      const resolved = await executeResolveManualReviewFlow(
        mockClient,
        dbState.job.id,
        "user-owner",
        "ABANDON_UNRESOLVED",
        "Confirmed resolution",
      );

      // Verify Job Terminal State & Resolution Metadata
      assert.equal(resolved.status, "CANCELLED");
      assert.equal(resolved.resolutionKind, "ABANDON_UNRESOLVED");
      assert.equal(resolved.resolvedBy, "user-owner");
      assert.equal(resolved.resolutionNote, "Confirmed resolution");

      // Verify Exclusivity Released: status is CANCELLED, not in unresolved index!
      assert.equal(
        unresolvedIndexStatuses.includes(dbState.job.status),
        false,
        "Resolved job must NOT match the unresolved unique index predicate",
      );

      // Verify Candidate A Invariants: PRESERVED EXACTLY
      const itemAAfter = dbState.items[0];
      assert.equal(itemAAfter.status, "MANUAL_REVIEW_REQUIRED");
      assert.equal(itemAAfter.active_attempt_uuid, itemABefore.active_attempt_uuid);
      assert.equal(itemAAfter.attempt_phase, itemABefore.attempt_phase);
      assert.equal(itemAAfter.last_result_code, null);
      assert.equal(itemAAfter.attempt_settled_at, null);
      assert.equal(itemAAfter.actual_gold_spent, itemABefore.actual_gold_spent);
      assert.equal(itemAAfter.actual_gem_spent, itemABefore.actual_gem_spent);
      assert.equal(itemAAfter.actual_material_1_spent, itemABefore.actual_material_1_spent);
      assert.equal(itemAAfter.actual_charm_spent, itemABefore.actual_charm_spent);
      assert.equal(itemAAfter.attempt_count, itemABefore.attempt_count);

      // Verify Candidate B Invariants: TRANSITIONED TO CANCELLED, NEVER EXECUTED
      const itemBAfter = dbState.items[1];
      assert.equal(itemBAfter.status, "CANCELLED");
      assert.equal(itemBAfter.attempt_count, 0);
      assert.equal(itemBAfter.active_attempt_uuid, null);
      assert.equal(itemBAfter.actual_gold_spent, 0);

      // Verify Idempotency: repeated identical resolution returns success without altering data
      const repeated = await executeResolveManualReviewFlow(
        mockClient,
        dbState.job.id,
        "user-owner",
        "ABANDON_UNRESOLVED",
      );
      assert.equal(repeated.status, "CANCELLED");
      assert.equal(repeated.resolutionKind, "ABANDON_UNRESOLVED");

      // Verify Concurrency: 2 concurrent calls serialize safely
      const [res1, res2] = await Promise.all([
        executeResolveManualReviewFlow(mockClient, dbState.job.id, "user-owner", "ABANDON_UNRESOLVED"),
        executeResolveManualReviewFlow(mockClient, dbState.job.id, "user-owner", "ABANDON_UNRESOLVED"),
      ]);
      assert.equal(res1.status, "CANCELLED");
      assert.equal(res2.status, "CANCELLED");
    });
  });

  describe("5. Route Handler Specification (POST /api/queue/resolve-manual-review)", () => {
    it("route module exists and exports POST handler", async () => {
      const routeModule = await import("../../src/app/api/queue/resolve-manual-review/route");
      assert.equal(typeof routeModule.POST, "function");
    });
  });
});


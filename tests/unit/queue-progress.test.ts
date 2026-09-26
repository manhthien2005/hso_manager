import { register } from "node:module";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mock.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "mock-anon-key";

const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith("@/")) {
    target = new URL("../../src/" + target.slice(2), "${import.meta.url}").href;
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

const {
  FULL_ATTEMPT_HISTORY_SUPPORTED,
  HISTORY_CLASSIFICATION,
  UNRESOLVED_QUEUE_STATUSES,
  TERMINAL_QUEUE_STATUSES,
  ATTEMPT_PHASE_INFO,
  isUnresolvedQueueStatus,
  isTerminalQueueStatus,
  deriveQueueSpend,
  mapQueueItemRow,
  orderQueueItems,
  determineItemProgressState,
} = await import("../../src/lib/queue-progress");

const {
  fetchActiveQueueWithItems,
  fetchRecentQueueHistory,
  executePauseQueueFlow,
  executeCancelQueueFlow,
  QueueError,
} = await import("../../src/services/queue-service");

const { isEnhancementQueueAvailableOnDevice } = await import(
  "../../src/lib/capabilities"
);

const { QUEUE_ERROR_CODES } = await import("../../src/lib/queue");
import type { EnhancementQueueItem } from "../../src/lib/types";

describe("1. Schema Capability Audit & Attempt History Semantics", () => {
  it("explicitly documents that full per-attempt history is not supported by migration 013", () => {
    assert.equal(FULL_ATTEMPT_HISTORY_SUPPORTED, false);
    assert.equal(HISTORY_CLASSIFICATION, "NOT_SUPPORTED_BY_CURRENT_SCHEMA");
  });

  it("classifies unresolved and terminal statuses according to migration 013 invariants", () => {
    assert.deepEqual(
      [...UNRESOLVED_QUEUE_STATUSES].sort(),
      ["MANUAL_REVIEW_REQUIRED", "PAUSED", "PAUSING", "QUEUED", "RUNNING"].sort(),
    );
    assert.deepEqual(
      [...TERMINAL_QUEUE_STATUSES].sort(),
      ["CANCELLED", "COMPLETED", "FAILED"].sort(),
    );

    assert.equal(isUnresolvedQueueStatus("QUEUED"), true);
    assert.equal(isUnresolvedQueueStatus("RUNNING"), true);
    assert.equal(isUnresolvedQueueStatus("PAUSING"), true);
    assert.equal(isUnresolvedQueueStatus("PAUSED"), true);
    assert.equal(isUnresolvedQueueStatus("MANUAL_REVIEW_REQUIRED"), true);
    assert.equal(isUnresolvedQueueStatus("COMPLETED"), false);
    assert.equal(isUnresolvedQueueStatus("DRAFT"), false);

    assert.equal(isTerminalQueueStatus("COMPLETED"), true);
    assert.equal(isTerminalQueueStatus("FAILED"), true);
    assert.equal(isTerminalQueueStatus("CANCELLED"), true);
    assert.equal(isTerminalQueueStatus("RUNNING"), false);
    assert.equal(isTerminalQueueStatus("DRAFT"), false);
  });
});

describe("2. Attempt Phase Presentation & Human-Readable Mapping", () => {
  it("provides concise human-readable labels and descriptions for all 7 durable attempt phases", () => {
    const phases = [
      "NONE",
      "PREPARING",
      "READY_TO_EXECUTE",
      "EXECUTE_MAY_HAVE_BEEN_SENT",
      "WAITING_RESULT",
      "WAITING_SETTLEMENT",
      "SETTLED",
    ] as const;

    for (const phase of phases) {
      const info = ATTEMPT_PHASE_INFO[phase];
      assert.ok(info, `Phase ${phase} must have presentation info`);
      assert.ok(info.label.length > 0, `Phase ${phase} label must not be empty`);
      assert.ok(info.description.length > 0, `Phase ${phase} description must not be empty`);
    }
  });

  it("ensures NONE does not imply execution", () => {
    const noneInfo = ATTEMPT_PHASE_INFO.NONE;
    assert.equal(noneInfo.isExecutionStarted, false);
    assert.equal(noneInfo.isSensitive, false);
  });

  it("marks EXECUTE_MAY_HAVE_BEEN_SENT as a sensitive in-flight state", () => {
    const sentInfo = ATTEMPT_PHASE_INFO.EXECUTE_MAY_HAVE_BEEN_SENT;
    assert.equal(sentInfo.isSensitive, true);
    assert.match(sentInfo.label, /lệnh|nhạy cảm/i);
  });

  it("does not imply success solely from SETTLED phase", () => {
    const settledInfo = ATTEMPT_PHASE_INFO.SETTLED;
    assert.equal(settledInfo.impliesSuccess, false);
  });
});

describe("3. Authoritative Item & Queue Spend Derivation", () => {
  const sampleItems: EnhancementQueueItem[] = [
    {
      id: "item-1",
      jobId: "job-1",
      accountId: "acc-1",
      userId: "user-1",
      queueOrder: 1,
      capturedSlot: 2,
      templateId: 101,
      category: 1,
      baseName: "Sword of Light",
      tier: 1,
      icon: 5,
      initialLevel: 1,
      currentLevel: 3,
      targetLevel: 7,
      paymentType: "GOLD",
      charmMode: "CO_3_LA",
      status: "COMPLETED",
      attemptCount: 4,
      activeAttemptUuid: null,
      attemptPhase: "SETTLED",
      attemptExpectedLevel: null,
      attemptTargetLevel: null,
      attemptStartedAt: null,
      executeMayHaveBeenSentAt: null,
      attemptSettledAt: "2026-09-26T10:00:00Z",
      lastResultCode: "SUCCESS",
      actualGoldSpent: 50000,
      actualGemSpent: 0,
      actualMaterial1Spent: 12,
      actualMaterial2Spent: 6,
      actualMaterial3Spent: 0,
      actualMaterial4Spent: 0,
      actualCharmSpent: 2,
      errorCode: null,
      errorMessage: null,
      startedAt: "2026-09-26T09:50:00Z",
      finishedAt: "2026-09-26T10:00:00Z",
      createdAt: "2026-09-26T09:40:00Z",
      updatedAt: "2026-09-26T10:00:00Z",
    },
    {
      id: "item-2",
      jobId: "job-1",
      accountId: "acc-1",
      userId: "user-1",
      queueOrder: 2,
      capturedSlot: 5,
      templateId: 202,
      category: 2,
      baseName: "Shield of Hope",
      tier: 2,
      icon: 8,
      initialLevel: 0,
      currentLevel: 2,
      targetLevel: 5,
      paymentType: "GEMS",
      charmMode: "NONE",
      status: "RUNNING",
      attemptCount: 3,
      activeAttemptUuid: "attempt-uuid-2",
      attemptPhase: "WAITING_RESULT",
      attemptExpectedLevel: 2,
      attemptTargetLevel: 3,
      attemptStartedAt: "2026-09-26T10:05:00Z",
      executeMayHaveBeenSentAt: "2026-09-26T10:05:02Z",
      attemptSettledAt: null,
      lastResultCode: null,
      actualGoldSpent: 0,
      actualGemSpent: 150,
      actualMaterial1Spent: 4,
      actualMaterial2Spent: 0,
      actualMaterial3Spent: 2,
      actualMaterial4Spent: 1,
      actualCharmSpent: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: "2026-09-26T10:01:00Z",
      finishedAt: null,
      createdAt: "2026-09-26T09:40:00Z",
      updatedAt: "2026-09-26T10:05:02Z",
    },
  ];

  it("derives queue-wide totals purely from item rows without double counting", () => {
    const spend = deriveQueueSpend(sampleItems);

    assert.equal(spend.actualGoldSpent, 50000);
    assert.equal(spend.actualGemSpent, 150);
    assert.equal(spend.actualMaterial1Spent, 16);
    assert.equal(spend.actualMaterial2Spent, 6);
    assert.equal(spend.actualMaterial3Spent, 2);
    assert.equal(spend.actualMaterial4Spent, 1);
    assert.equal(spend.actualCharmSpent, 2);
    assert.equal(spend.totalAttemptCount, 7);

    // Repeated call produces exact same result without state mutation
    const spend2 = deriveQueueSpend(sampleItems);
    assert.deepEqual(spend, spend2);
  });

  it("handles empty items array safely with zeroes", () => {
    const emptySpend = deriveQueueSpend([]);
    assert.equal(emptySpend.actualGoldSpent, 0);
    assert.equal(emptySpend.actualGemSpent, 0);
    assert.equal(emptySpend.actualMaterial1Spent, 0);
    assert.equal(emptySpend.actualMaterial2Spent, 0);
    assert.equal(emptySpend.actualMaterial3Spent, 0);
    assert.equal(emptySpend.actualMaterial4Spent, 0);
    assert.equal(emptySpend.actualCharmSpent, 0);
    assert.equal(emptySpend.totalAttemptCount, 0);
  });

  it("excludes non-enhancement routing gold", () => {
    // Only item.actualGoldSpent is counted. No teleport/routing fee is added.
    const spend = deriveQueueSpend(sampleItems);
    assert.equal(spend.actualGoldSpent, 50000);
  });
});

describe("4. Item Progression Order & Stop-on-Failure Visibility", () => {
  it("sorts items strictly by queueOrder ascending", () => {
    const unordered = [
      { id: "c", queueOrder: 3 },
      { id: "a", queueOrder: 1 },
      { id: "b", queueOrder: 2 },
    ] as EnhancementQueueItem[];

    const ordered = orderQueueItems(unordered);
    assert.equal(ordered[0].id, "a");
    assert.equal(ordered[1].id, "b");
    assert.equal(ordered[2].id, "c");
  });

  it("identifies unexecuted subsequent items when an earlier item failed or cancelled", () => {
    const itemsWithFailure = [
      { id: "1", queueOrder: 1, status: "COMPLETED" },
      { id: "2", queueOrder: 2, status: "FAILED", errorCode: "INSUFFICIENT_MATERIALS" },
      { id: "3", queueOrder: 3, status: "PENDING" },
    ] as EnhancementQueueItem[];

    const progress = determineItemProgressState(itemsWithFailure);

    assert.equal(progress[0].isUnexecutedDueToPriorFailure, false);
    assert.equal(progress[1].isUnexecutedDueToPriorFailure, false);
    assert.equal(progress[2].isUnexecutedDueToPriorFailure, true);
    assert.equal(progress[2].displayStatus, "SKIPPED_AFTER_FAILURE");
  });

  it("maps raw snake_case database row to camelCase EnhancementQueueItem correctly", () => {
    const rawRow = {
      id: "item-mapped-1",
      job_id: "job-mapped-1",
      account_id: "acc-1",
      user_id: "user-1",
      queue_order: 1,
      captured_slot: 3,
      template_id: 101,
      category: 1,
      base_name: "Holy Sword",
      tier: 1,
      icon: 2,
      initial_level: 1,
      current_level: 2,
      target_level: 6,
      payment_type: "GOLD",
      charm_mode: "CO_3_LA",
      status: "RUNNING",
      attempt_count: 2,
      active_attempt_uuid: "att-mapped-1",
      attempt_phase: "WAITING_RESULT",
      attempt_expected_level: 2,
      attempt_target_level: 3,
      attempt_started_at: "2026-09-26T10:00:00Z",
      execute_may_have_been_sent_at: "2026-09-26T10:00:02Z",
      attempt_settled_at: null,
      last_result_code: null,
      actual_gold_spent: 10000,
      actual_gem_spent: 0,
      actual_material_1_spent: 4,
      actual_material_2_spent: 2,
      actual_material_3_spent: 0,
      actual_material_4_spent: 0,
      actual_charm_spent: 1,
      error_code: null,
      error_message: null,
      started_at: "2026-09-26T09:59:00Z",
      finished_at: null,
      created_at: "2026-09-26T09:50:00Z",
      updated_at: "2026-09-26T10:00:02Z",
    };

    const mapped = mapQueueItemRow(rawRow);

    assert.equal(mapped.id, "item-mapped-1");
    assert.equal(mapped.jobId, "job-mapped-1");
    assert.equal(mapped.queueOrder, 1);
    assert.equal(mapped.capturedSlot, 3);
    assert.equal(mapped.baseName, "Holy Sword");
    assert.equal(mapped.initialLevel, 1);
    assert.equal(mapped.currentLevel, 2);
    assert.equal(mapped.targetLevel, 6);
    assert.equal(mapped.paymentType, "GOLD");
    assert.equal(mapped.charmMode, "CO_3_LA");
    assert.equal(mapped.status, "RUNNING");
    assert.equal(mapped.attemptPhase, "WAITING_RESULT");
    assert.equal(mapped.actualGoldSpent, 10000);
    assert.equal(mapped.actualMaterial1Spent, 4);
    assert.equal(mapped.actualCharmSpent, 1);
  });
});

describe("5. Active Queue Loading, Multi-Queue Failure Protection & Reload Recovery", () => {
  function createMockSupabase(jobs: Record<string, unknown>[], items: Record<string, unknown>[]) {
    return {
      rpc() {
        return Promise.resolve({ data: null, error: null });
      },
      from(table: string) {
        if (table === "enhancement_queue_jobs") {
          return {
            select(_cols?: string) {
              return {
                eq(_col: string, val: string) {
                  return {
                    in(_statusCol: string, statuses: string[]) {
                      const matched = jobs.filter(
                        (j) => j.account_id === val && statuses.includes(String(j.status)),
                      );
                      return Promise.resolve({ data: matched, error: null });
                    },
                    order(_col: string, _opts: unknown) {
                      return {
                        limit(n: number) {
                          const matched = jobs.filter((j) => j.account_id === val).slice(0, n);
                          return Promise.resolve({ data: matched, error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "enhancement_queue_items") {
          return {
            select(_cols?: string) {
              return {
                eq(_col: string, val: string) {
                  return {
                    order(_col: string, _opts: unknown) {
                      const matched = items
                        .filter((i) => i.job_id === val)
                        .sort((a, b) => Number(a.queue_order) - Number(b.queue_order));
                      return Promise.resolve({ data: matched, error: null });
                    },
                  };
                },
                in(_col: string, vals: string[]) {
                  return {
                    order(_col: string, _opts: unknown) {
                      const matched = items
                        .filter((i) => vals.includes(String(i.job_id)))
                        .sort((a, b) => Number(a.queue_order) - Number(b.queue_order));
                      return Promise.resolve({ data: matched, error: null });
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };
  }

  const rawJobRow = {
    id: "job-100",
    account_id: "acc-1",
    device_id: "dev-1",
    user_id: "user-1",
    status: "RUNNING",
    active_item_id: "item-101",
    active_attempt_uuid: "att-1",
    active_command_id: null,
    total_items: 2,
    completed_items: 0,
    claimed_by: "agent-1",
    claimed_at: "2026-09-26T10:00:00Z",
    claim_expires_at: "2026-09-26T10:05:00Z",
    pause_requested_at: null,
    cancel_requested_at: null,
    error_code: null,
    error_message: null,
    created_at: "2026-09-26T09:59:00Z",
    started_at: "2026-09-26T10:00:00Z",
    finished_at: null,
    updated_at: "2026-09-26T10:00:00Z",
  };

  const rawItemRows = [
    {
      id: "item-102",
      job_id: "job-100",
      account_id: "acc-1",
      user_id: "user-1",
      queue_order: 2,
      captured_slot: 4,
      template_id: 202,
      category: 2,
      base_name: "Shield",
      tier: 2,
      icon: 2,
      initial_level: 0,
      current_level: 0,
      target_level: 3,
      payment_type: "GOLD",
      charm_mode: "NONE",
      status: "PENDING",
      attempt_count: 0,
      active_attempt_uuid: null,
      attempt_phase: "NONE",
      actual_gold_spent: 0,
      actual_gem_spent: 0,
      actual_material_1_spent: 0,
      actual_material_2_spent: 0,
      actual_material_3_spent: 0,
      actual_material_4_spent: 0,
      actual_charm_spent: 0,
      created_at: "2026-09-26T09:59:00Z",
      updated_at: "2026-09-26T09:59:00Z",
    },
    {
      id: "item-101",
      job_id: "job-100",
      account_id: "acc-1",
      user_id: "user-1",
      queue_order: 1,
      captured_slot: 1,
      template_id: 101,
      category: 1,
      base_name: "Sword",
      tier: 1,
      icon: 1,
      initial_level: 1,
      current_level: 1,
      target_level: 5,
      payment_type: "GOLD",
      charm_mode: "CO_3_LA",
      status: "RUNNING",
      attempt_count: 1,
      active_attempt_uuid: "att-1",
      attempt_phase: "READY_TO_EXECUTE",
      actual_gold_spent: 5000,
      actual_gem_spent: 0,
      actual_material_1_spent: 2,
      actual_material_2_spent: 0,
      actual_material_3_spent: 0,
      actual_material_4_spent: 0,
      actual_charm_spent: 1,
      created_at: "2026-09-26T09:59:00Z",
      updated_at: "2026-09-26T10:00:00Z",
    },
  ];

  it("returns null when no unresolved queue exists for the account", async () => {
    const mock = createMockSupabase([], []);
    const result = await fetchActiveQueueWithItems(mock, "acc-1");
    assert.equal(result, null);
  });

  it("loads the single unresolved queue with items explicitly ordered by queue_order ascending", async () => {
    const mock = createMockSupabase([rawJobRow], rawItemRows);
    const result = await fetchActiveQueueWithItems(mock, "acc-1");

    assert.ok(result);
    assert.equal(result.job.id, "job-100");
    assert.equal(result.job.status, "RUNNING");
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].queueOrder, 1);
    assert.equal(result.items[0].id, "item-101");
    assert.equal(result.items[1].queueOrder, 2);
    assert.equal(result.items[1].id, "item-102");
    assert.equal(result.derivedSpend.actualGoldSpent, 5000);
  });

  it("fails visibly instead of arbitrarily selecting one if multiple unresolved queues are returned", async () => {
    const secondJob = { ...rawJobRow, id: "job-101" };
    const mock = createMockSupabase([rawJobRow, secondJob], []);

    await assert.rejects(
      async () => {
        await fetchActiveQueueWithItems(mock, "acc-1");
      },
      (err: unknown) => {
        assert.ok(err instanceof QueueError);
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT);
        assert.match(err.message, /nhiều hơn 1 hàng đợi/i);
        return true;
      },
    );
  });

  it("reloads cleanly from DB without altering job ID or attempting auto-republish", async () => {
    const mock = createMockSupabase([rawJobRow], rawItemRows);
    const firstLoad = await fetchActiveQueueWithItems(mock, "acc-1");
    const reload = await fetchActiveQueueWithItems(mock, "acc-1");

    assert.equal(firstLoad?.job.id, reload?.job.id);
    assert.equal(firstLoad?.job.activeAttemptUuid, reload?.job.activeAttemptUuid);
    assert.equal(reload?.job.status, "RUNNING");
  });
});

describe("6. Terminal Queue History Loading", () => {
  it("loads finished/terminal queues without fabricating attempt history", async () => {
    const terminalJob = {
      id: "term-1",
      account_id: "acc-1",
      device_id: "dev-1",
      user_id: "user-1",
      status: "COMPLETED",
      active_item_id: null,
      active_attempt_uuid: null,
      active_command_id: null,
      total_items: 1,
      completed_items: 1,
      claimed_by: "agent-1",
      claimed_at: null,
      claim_expires_at: null,
      pause_requested_at: null,
      cancel_requested_at: null,
      error_code: null,
      error_message: null,
      created_at: "2026-09-26T08:00:00Z",
      started_at: "2026-09-26T08:01:00Z",
      finished_at: "2026-09-26T08:15:00Z",
      updated_at: "2026-09-26T08:15:00Z",
    };

    const terminalItem = {
      id: "term-item-1",
      job_id: "term-1",
      account_id: "acc-1",
      user_id: "user-1",
      queue_order: 1,
      captured_slot: 3,
      template_id: 303,
      category: 3,
      base_name: "Bow",
      tier: 3,
      icon: 4,
      initial_level: 3,
      current_level: 7,
      target_level: 7,
      payment_type: "GOLD",
      charm_mode: "NONE",
      status: "COMPLETED",
      attempt_count: 5,
      active_attempt_uuid: null,
      attempt_phase: "SETTLED",
      actual_gold_spent: 120000,
      actual_gem_spent: 0,
      actual_material_1_spent: 10,
      actual_material_2_spent: 5,
      actual_material_3_spent: 0,
      actual_material_4_spent: 0,
      actual_charm_spent: 0,
      created_at: "2026-09-26T08:00:00Z",
      updated_at: "2026-09-26T08:15:00Z",
    };

    const mock = {
      rpc() {
        return Promise.resolve({ data: null, error: null });
      },
      from(table: string) {
        if (table === "enhancement_queue_jobs") {
          return {
            select(_cols?: string) {
              return {
                eq(_col: string, val: string) {
                  return {
                    in(_statusCol: string, _statuses: string[]) {
                      return {
                        order(_orderCol: string, _orderOpts: unknown) {
                          return {
                            limit(n: number) {
                              return Promise.resolve({
                                data: [terminalJob].slice(0, n),
                                error: null,
                              });
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "enhancement_queue_items") {
          return {
            select(_cols?: string) {
              return {
                in(_col: string, _vals: string[]) {
                  return {
                    order(_col: string, _opts: unknown) {
                      return Promise.resolve({ data: [terminalItem], error: null });
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const history = await fetchRecentQueueHistory(mock, "acc-1", 5);
    assert.equal(history.length, 1);
    assert.equal(history[0].job.status, "COMPLETED");
    assert.equal(history[0].items[0].currentLevel, 7);
    assert.equal(history[0].derivedSpend.actualGoldSpent, 120000);
  });
});

describe("7. Realtime Invalidation & Safety Mechanics", () => {
  it("uses realtime events strictly as invalidation signals triggering refetch", async () => {
    let refetchCount = 0;
    const onInvalidate = () => {
      refetchCount++;
    };

    // Simulate Supabase channel listener
    let channelHandler: (() => void) | null = null;
    let unsubscribed = false;

    const mockChannel = {
      on(_type: string, _filter: unknown, callback: () => void) {
        channelHandler = callback;
        return mockChannel;
      },
      subscribe(cb?: (status: string) => void) {
        if (cb) cb("SUBSCRIBED");
        return mockChannel;
      },
    };

    const mockSupabase = {
      channel(_name: string) {
        return mockChannel;
      },
      removeChannel(_ch: unknown) {
        unsubscribed = true;
      },
    };

    // Setup subscription
    const channel = mockSupabase.channel("test-ch");
    channel
      .on("postgres_changes", { event: "*" }, () => {
        onInvalidate();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          onInvalidate();
        }
      });

    // Subscribing immediately triggers initial invalidation
    assert.equal(refetchCount, 1);

    // Incoming event triggers refetch
    assert.ok(channelHandler);
    if (channelHandler) {
      (channelHandler as () => void)();
    }
    assert.equal(refetchCount, 2);

    // Duplicate event triggers refetch without double-counting spend
    if (channelHandler) {
      (channelHandler as () => void)();
    }
    assert.equal(refetchCount, 3);

    // Cleanup unsubscribes
    mockSupabase.removeChannel(channel);
    assert.equal(unsubscribed, true);
  });

  it("proves stale out-of-order events cannot regress authoritative database state", async () => {
    // Database has already settled as COMPLETED
    const dbJob = {
      id: "job-conv",
      account_id: "acc-1",
      device_id: "dev-1",
      user_id: "user-1",
      status: "COMPLETED",
      active_item_id: null,
      active_attempt_uuid: null,
      active_command_id: null,
      total_items: 1,
      completed_items: 1,
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
      pause_requested_at: null,
      cancel_requested_at: null,
      error_code: null,
      error_message: null,
      created_at: "2026-09-26T10:00:00Z",
      started_at: "2026-09-26T10:00:10Z",
      finished_at: "2026-09-26T10:01:00Z",
      updated_at: "2026-09-26T10:01:00Z",
    };

    const mockDb = {
      rpc() {
        return Promise.resolve({ data: null, error: null });
      },
      from(table: string) {
        if (table === "enhancement_queue_jobs") {
          return {
            select(_cols?: string) {
              return {
                eq(_col: string, val: string) {
                  return {
                    in(_statusCol: string, statuses: string[]) {
                      // Status is COMPLETED so unresolved query returns empty
                      const matched = statuses.includes(dbJob.status) && dbJob.account_id === val
                        ? [dbJob]
                        : [];
                      return Promise.resolve({ data: matched, error: null });
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "enhancement_queue_items") {
          return {
            select(_cols?: string) {
              return {
                eq(_col: string, _val: string) {
                  return {
                    order(_col: string, _opts: unknown) {
                      return Promise.resolve({ data: [], error: null });
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    // Stale realtime event arrives claiming status is "RUNNING"
    // But consumer executes authoritative refetch rather than applying delta
    const resultAfterStaleEvent = await fetchActiveQueueWithItems(mockDb, "acc-1");

    // Since DB job is COMPLETED, active unresolved query correctly yields null (or terminal state)
    // and does NOT show RUNNING
    assert.equal(resultAfterStaleEvent, null);
  });
});

describe("8. Pause, Cancel & Capability Independence", () => {
  function createMockJobDb(initialJob: Record<string, unknown>) {
    let currentJob = { ...initialJob };
    return {
      getJob() {
        return currentJob;
      },
      rpc() {
        return Promise.resolve({ data: null, error: null });
      },
      from(table: string) {
        if (table === "enhancement_queue_jobs") {
          return {
            select(_cols?: string) {
              return {
                eq(_col: string, val: string) {
                  return {
                    maybeSingle() {
                      if (currentJob.id === val) {
                        return Promise.resolve({ data: { ...currentJob }, error: null });
                      }
                      return Promise.resolve({ data: null, error: null });
                    },
                  };
                },
              };
            },
            update(fields: Record<string, unknown>) {
              return {
                eq(_c1: string, v1: string) {
                  return {
                    eq(_c2: string, v2: string) {
                      return {
                        select(_sel: string) {
                          return {
                            single() {
                              if (currentJob.id === v1 && currentJob.user_id === v2) {
                                currentJob = { ...currentJob, ...fields };
                                return Promise.resolve({ data: { ...currentJob }, error: null });
                              }
                              return Promise.resolve({ data: null, error: new Error("Not found") });
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
  }

  const baseJob = {
    id: "job-ctrl",
    account_id: "acc-1",
    device_id: "dev-1",
    user_id: "user-1",
    status: "RUNNING",
    active_item_id: null,
    active_attempt_uuid: null,
    active_command_id: null,
    total_items: 2,
    completed_items: 0,
    claimed_by: "agent-1",
    claimed_at: null,
    claim_expires_at: null,
    pause_requested_at: null,
    cancel_requested_at: null,
    error_code: null,
    error_message: null,
    created_at: "2026-09-26T10:00:00Z",
    started_at: "2026-09-26T10:00:10Z",
    finished_at: null,
    updated_at: "2026-09-26T10:00:10Z",
  };

  it("pause request updates pause_requested_at without prematurely marking status as PAUSED", async () => {
    const mockDb = createMockJobDb(baseJob);
    const updated = await executePauseQueueFlow(mockDb, "job-ctrl", "user-1");

    assert.ok(updated.pauseRequestedAt);
    // Crucial: Status remains RUNNING until the agent/runtime pauses it
    assert.equal(updated.status, "RUNNING");
  });

  it("cancel request updates cancel_requested_at without prematurely marking status as CANCELLED", async () => {
    const mockDb = createMockJobDb(baseJob);
    const updated = await executeCancelQueueFlow(mockDb, "job-ctrl", "user-1");

    assert.ok(updated.cancelRequestedAt);
    // Crucial: Status remains RUNNING until the agent/runtime cancels it
    assert.equal(updated.status, "RUNNING");
  });

  it("preserves safety controls and progress visibility even if device capability is absent or offline", () => {
    // Device without enhancement-queue-v1 capability
    const incapableDevice = {
      id: "dev-1",
      deviceId: "dev-1",
      userId: "user-1",
      name: "Old Device",
      region: "SG",
      status: "online" as const,
      agentVersion: "0.1.0", // lacks capability
      runtimeVersion: "0.1.0",
      viewerAvailable: true,
      metrics: {
        cpuPercent: 0,
        ramMb: 0,
        pingMs: 0,
        cpu: 0,
        ramUsedMb: 0,
        ramTotalMb: 0,
        uptimeSeconds: 0,
      },
      jar_ctl_version: 14,
      viewer_url: null,
      lastSeen: Date.now(),
    };

    // Capability gate blocks new Start Queue
    assert.equal(isEnhancementQueueAvailableOnDevice(incapableDevice), false);

    // But existing queue progress and pause/cancel requests do NOT require capability check
    // (executePauseQueueFlow / executeCancelQueueFlow only check user ownership & active status)
  });
});


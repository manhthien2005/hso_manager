/**
 * Comprehensive Unit and Integration Tests for Enhancement Queue Web Dispatch
 * Task: ENHANCE-05D-WEB-QUEUE-DISPATCH
 *
 * Covers:
 * 1. Capability Gate (Token parsing, old runtime disabled, fail closed, freshness)
 * 2. Identity Validation (Unique O+u, duplicate O+u blocked, missing blocked, fingerprint)
 * 3. Draft Validation (Emptiness, bounds, target > initial, payment & charm allowlists)
 * 4. Atomic Publish (DRAFT state during insert, cleanup on item failure, capability recheck, publish to QUEUED)
 * 5. Double Submit & Exclusivity (Concurrent start requests, single executable queue, deterministic error)
 * 6. Field Ownership (No writing of runtime-owned attempt, claim, settlement, or spend fields)
 * 7. Pause & Cancel (Request-only semantics, safety control capability policy, cross-user block)
 * 8. Browser Independence (No browser-side attempt sequencing, timers, or direct mutation dispatch)
 */

import { register } from "node:module";
import { test, describe } from "node:test";
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
  ENHANCEMENT_QUEUE_CAPABILITY_TOKEN,
  hasEnhancementQueueCapability,
  isEnhancementQueueAvailableOnDevice,
} = await import("../../src/lib/capabilities");

const {
  QUEUE_ERROR_CODES,
  buildLiveInventoryTargetMap,
  validateWireIdentity,
  validateQueueDraft,
  draftToSubmissionPayload,
} = await import("../../src/lib/queue");

const {
  addQueueEntry,
  removeQueueEntry,
  reorderQueueEntry,
  updateQueueEntryTargetLevel,
  updateQueueEntryPaymentType,
  updateQueueEntryCharmMode,
} = await import("../../src/lib/inventory");

const {
  executeStartQueueFlow,
  executePauseQueueFlow,
  executeCancelQueueFlow,
  QueueError,
} = await import("../../src/services/queue-service");

import type { Device } from "../../src/lib/types";
import type {
  EnhancementQueueEntry,
  InventoryCatalogPayload,
  InventoryItemCatalog,
  SelectedItemReference,
} from "../../src/lib/inventory";
import type { QueueItemSubmissionPayload } from "../../src/lib/queue";

function createMockDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-01",
    deviceId: "dev-01",
    userId: "user-01",
    name: "VPS-01",
    region: "Railway",
    status: "online",
    runtimeVersion: "1.0.0",
    viewerAvailable: false,
    viewer_url: null,
    jar_ctl_version: 14,
    jar_sha256: null,
    agentVersion: "0.1.0+enhancement-queue-v1",
    lastSeen: Date.now(),
    metrics: { cpu: 10, ramUsedMb: 500, ramTotalMb: 2048, uptimeSeconds: 3600 },
    ...overrides,
  };
}

function createSampleInventory(items: Partial<InventoryItemCatalog>[]): InventoryCatalogPayload {
  return {
    version: 1,
    bag_capacity: 42,
    items: items.map((it, idx) => ({
      slot: it.slot ?? idx,
      template_id: it.template_id ?? 101,
      category: it.category ?? 1,
      base_name: it.base_name ?? "Kiếm Sắt",
      display_name: it.display_name ?? `${it.base_name ?? "Kiếm Sắt"} +${it.level ?? 0}`,
      level: it.level ?? 0,
      tier: it.tier ?? 1,
      count: it.count ?? 1,
      durability: null,
      bind: null,
      icon: it.icon ?? 1001,
      candidate_for_enhancement: it.candidate_for_enhancement ?? true,
    })),
  };
}

// ── Mock Database Client for Service Contract Tests ─────────────────────────

interface MockDatabaseState {
  accounts: any[];
  devices: any[];
  accountRuntime: any[];
  jobs: any[];
  items: any[];
  rpcLog: Array<{ fn: string; args: any }>;
  insertLog: Array<{ table: string; rows: any[] }>;
  updateLog: Array<{ table: string; patch: any; filter: any }>;
  deleteLog: Array<{ table: string; filter: any }>;
  failItemInsert?: boolean;
  failPublish?: boolean;
  simulateActiveQueueConflictOnPublish?: boolean;
}

function createMockSupabaseClient(initialState: Partial<MockDatabaseState> = {}) {
  const state: MockDatabaseState = {
    accounts: initialState.accounts ?? [],
    devices: initialState.devices ?? [],
    accountRuntime: initialState.accountRuntime ?? [],
    jobs: initialState.jobs ?? [],
    items: initialState.items ?? [],
    rpcLog: [],
    insertLog: [],
    updateLog: [],
    deleteLog: [],
    failItemInsert: initialState.failItemInsert ?? false,
    failPublish: initialState.failPublish ?? false,
    simulateActiveQueueConflictOnPublish: initialState.simulateActiveQueueConflictOnPublish ?? false,
  };

  const client = {
    _state: state,
    from(table: string) {
      const currentTable = table;
      const filters: Record<string, any> = {};
      const inFilters: Record<string, any[]> = {};

      const queryBuilder = {
        select(_cols: string = "*") {
          return queryBuilder;
        },
        eq(col: string, val: any) {
          filters[col] = val;
          return queryBuilder;
        },
        in(col: string, vals: any[]) {
          inFilters[col] = vals;
          return queryBuilder;
        },
        async maybeSingle() {
          const list = getTableData(currentTable);
          const filtered = list.filter((row: any) => matchRow(row, filters, inFilters));
          return { data: filtered[0] ?? null, error: null };
        },
        async single() {
          const list = getTableData(currentTable);
          const filtered = list.filter((row: any) => matchRow(row, filters, inFilters));
          if (filtered.length === 0) {
            return { data: null, error: { message: "Row not found" } };
          }
          return { data: filtered[0], error: null };
        },
        insert(data: any) {
          const rows = Array.isArray(data) ? data : [data];
          state.insertLog.push({ table: currentTable, rows });

          if (currentTable === "enhancement_queue_items" && state.failItemInsert) {
            const errorResult = { data: null, error: { message: "Item insert failed deliberately" } };
            const errorBuilder = {
              select(_cols?: string) {
                return {
                  ...errorResult,
                  single() {
                    return Promise.resolve(errorResult);
                  },
                  then(resolve: any, reject?: any) {
                    return Promise.resolve(errorResult).then(resolve, reject);
                  },
                };
              },
              single() {
                return Promise.resolve(errorResult);
              },
              then(resolve: any, reject?: any) {
                return Promise.resolve(errorResult).then(resolve, reject);
              },
            };
            return errorBuilder;
          }

          const insertedRows = rows.map((r: any) => {
            const rowWithId = {
              id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...r,
            };
            if (currentTable === "enhancement_queue_jobs") state.jobs.push(rowWithId);
            if (currentTable === "enhancement_queue_items") state.items.push(rowWithId);
            return rowWithId;
          });

          const successResult = {
            data: Array.isArray(data) ? insertedRows : insertedRows[0],
            error: null,
          };

          const insertBuilder = {
            select(_cols?: string) {
              return {
                ...successResult,
                single() {
                  return Promise.resolve({ data: insertedRows[0], error: null });
                },
                then(resolve: any, reject?: any) {
                  return Promise.resolve(successResult).then(resolve, reject);
                },
              };
            },
            single() {
              return Promise.resolve({ data: insertedRows[0], error: null });
            },
            then(resolve: any, reject?: any) {
              return Promise.resolve(successResult).then(resolve, reject);
            },
          };

          return insertBuilder;
        },
        update(patch: any) {
          state.updateLog.push({ table: currentTable, patch, filter: { ...filters } });
          return {
            eq(col: string, val: any) {
              filters[col] = val;
              return this;
            },
            select() {
              return {
                single() {
                  const list = getTableData(currentTable);
                  const row = list.find((r: any) => matchRow(r, filters, inFilters));
                  if (!row) return Promise.resolve({ data: null, error: { message: "Row not found" } });
                  Object.assign(row, patch, { updated_at: new Date().toISOString() });
                  return Promise.resolve({ data: row, error: null });
                },
              };
            },
          };
        },
        delete() {
          const deleteFilters: Record<string, any> = { ...filters };
          const deleteEntry = { table: currentTable, filter: deleteFilters };
          state.deleteLog.push(deleteEntry);
          const deleteBuilder = {
            eq(col: string, val: any) {
              deleteFilters[col] = val;
              return deleteBuilder;
            },
            then(resolve: any, reject?: any) {
              if (currentTable === "enhancement_queue_jobs") {
                state.jobs = state.jobs.filter((j: any) => !matchRow(j, deleteFilters, inFilters));
              }
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return deleteBuilder;
        },
      };

      function getTableData(tbl: string) {
        if (tbl === "accounts") return state.accounts;
        if (tbl === "devices") return state.devices;
        if (tbl === "account_runtime") return state.accountRuntime;
        if (tbl === "enhancement_queue_jobs") return state.jobs;
        if (tbl === "enhancement_queue_items") return state.items;
        return [];
      }

      function matchRow(row: any, f: Record<string, any>, inF: Record<string, any[]>) {
        for (const [k, v] of Object.entries(f)) {
          if (row[k] !== v) return false;
        }
        for (const [k, vals] of Object.entries(inF)) {
          if (!vals.includes(row[k])) return false;
        }
        return true;
      }

      return queryBuilder;
    },

    async rpc(fn: string, args: Record<string, unknown>) {
      state.rpcLog.push({ fn, args });

      if (fn === "publish_enhancement_queue_job") {
        if (state.failPublish) {
          return { data: null, error: { message: "RPC publish execution error" } };
        }

        const jobId = args.p_job_id as string;
        const job = state.jobs.find((j: any) => j.id === jobId);
        if (!job) {
          return { data: null, error: { message: "job not found" } };
        }

        if (state.simulateActiveQueueConflictOnPublish) {
          return {
            data: null,
            error: { message: `account ${job.account_id} already has an active or unresolved enhancement queue` },
          };
        }

        // Exclusivity check on account
        const otherActive = state.jobs.find(
          (j: any) =>
            j.account_id === job.account_id &&
            j.id !== jobId &&
            ["QUEUED", "RUNNING", "PAUSING", "PAUSED", "MANUAL_REVIEW_REQUIRED"].includes(j.status),
        );
        if (otherActive) {
          return {
            data: null,
            error: { message: `account ${job.account_id} already has an active or unresolved enhancement queue` },
          };
        }

        const jobItems = state.items.filter((it: any) => it.job_id === jobId);
        if (jobItems.length === 0) {
          return { data: null, error: { message: "cannot publish enhancement queue job with 0 items" } };
        }

        job.status = "QUEUED";
        job.total_items = jobItems.length;
        job.updated_at = new Date().toISOString();
        return { data: job, error: null };
      }

      return { data: null, error: { message: `Unknown RPC ${fn}` } };
    },
  };

  return client;
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe("1. Enhancement Queue Capability Gate", () => {
  test("token is exactly enhancement-queue-v1", () => {
    assert.equal(ENHANCEMENT_QUEUE_CAPABILITY_TOKEN, "enhancement-queue-v1");
  });

  test("detects exact enhancement-queue-v1 token in build metadata", () => {
    assert.equal(hasEnhancementQueueCapability("0.1.0+enhancement-queue-v1"), true);
    assert.equal(hasEnhancementQueueCapability("0.1.0+sha.abcd.enhancement-queue-v1"), true);
    assert.equal(hasEnhancementQueueCapability("0.1.0+character-slot-v1.enhancement-queue-v1"), true);
  });

  test("rejects versions without build metadata or missing token", () => {
    assert.equal(hasEnhancementQueueCapability("0.1.0"), false);
    assert.equal(hasEnhancementQueueCapability("0.1.0+visual-qol-v1"), false);
    assert.equal(hasEnhancementQueueCapability("0.1.0+character-slot-v1"), false);
    assert.equal(hasEnhancementQueueCapability("0.1.0+enhancement-queue-v2"), false);
    assert.equal(hasEnhancementQueueCapability("0.1.0+enhancement-queue-v10"), false);
    assert.equal(hasEnhancementQueueCapability("0.1.0+pre-enhancement-queue-v1"), false);
  });

  test("fails closed for null, undefined, empty, or unknown version", () => {
    assert.equal(hasEnhancementQueueCapability(null), false);
    assert.equal(hasEnhancementQueueCapability(undefined), false);
    assert.equal(hasEnhancementQueueCapability(""), false);
    assert.equal(hasEnhancementQueueCapability("   "), false);
    assert.equal(hasEnhancementQueueCapability("unknown"), false);
  });

  test("isEnhancementQueueAvailableOnDevice passes for fresh capable online device", () => {
    const dev = createMockDevice();
    assert.equal(isEnhancementQueueAvailableOnDevice(dev), true);
  });

  test("isEnhancementQueueAvailableOnDevice fails closed for offline or stale device", () => {
    const offlineDev = createMockDevice({ status: "offline" });
    assert.equal(isEnhancementQueueAvailableOnDevice(offlineDev), false);

    const staleDev = createMockDevice({ lastSeen: Date.now() - 6 * 60 * 1000 });
    assert.equal(isEnhancementQueueAvailableOnDevice(staleDev), false);

    const noSeenDev = createMockDevice({ lastSeen: null as unknown as number });
    assert.equal(isEnhancementQueueAvailableOnDevice(noSeenDev), false);

    const nullDev = null;
    assert.equal(isEnhancementQueueAvailableOnDevice(nullDev), false);
  });

  test("isEnhancementQueueAvailableOnDevice fails closed for device lacking capability token", () => {
    const oldDev = createMockDevice({ agentVersion: "0.1.0+visual-qol-v1" });
    assert.equal(isEnhancementQueueAvailableOnDevice(oldDev), false);
  });
});

describe("2. Wire Identity & Live Candidate Validation", () => {
  test("unique O+u item in live inventory is valid", () => {
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
      { slot: 1, template_id: 202, category: 2, base_name: "Áo Giáp", level: 0, tier: 1, icon: 60 },
    ]);

    const ref: SelectedItemReference = {
      captured_slot: 0,
      template_id: 101,
      category: 1,
      base_name: "Kiếm Thần",
      tier: 2,
      icon: 50,
      expected_level: 3,
      captured_display_name: "Kiếm Thần +3",
    };

    const result = validateWireIdentity(ref, inv);
    assert.equal(result.valid, true);
  });

  test("duplicate O+u candidate in live inventory is blocked with AMBIGUOUS_WIRE_TARGET", () => {
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Sắt", level: 3, tier: 1, icon: 50 },
      { slot: 5, template_id: 101, category: 1, base_name: "Kiếm Sắt", level: 0, tier: 1, icon: 50 },
    ]);

    const ref: SelectedItemReference = {
      captured_slot: 0,
      template_id: 101,
      category: 1,
      base_name: "Kiếm Sắt",
      tier: 1,
      icon: 50,
      expected_level: 3,
      captured_display_name: "Kiếm Sắt +3",
    };

    const result = validateWireIdentity(ref, inv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.AMBIGUOUS_WIRE_TARGET);
    assert.match(result.message!, /có 2 bản sao cùng loại/);
  });

  test("item missing from live inventory is blocked with ITEM_MISSING_OR_CHANGED", () => {
    const inv = createSampleInventory([
      { slot: 1, template_id: 202, category: 2, base_name: "Áo Giáp", level: 0, tier: 1, icon: 60 },
    ]);

    const ref: SelectedItemReference = {
      captured_slot: 0,
      template_id: 101,
      category: 1,
      base_name: "Kiếm Thần",
      tier: 2,
      icon: 50,
      expected_level: 3,
      captured_display_name: "Kiếm Thần +3",
    };

    const result = validateWireIdentity(ref, inv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED);
  });

  test("slot movement alone does not rebind identity; empty slot blocked", () => {
    const inv = createSampleInventory([
      { slot: 4, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
    ]);

    const ref: SelectedItemReference = {
      captured_slot: 0,
      template_id: 101,
      category: 1,
      base_name: "Kiếm Thần",
      tier: 2,
      icon: 50,
      expected_level: 3,
      captured_display_name: "Kiếm Thần +3",
    };

    const result = validateWireIdentity(ref, inv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED);
    assert.match(result.message!, /Không tự động ánh xạ lại ô khác/);
  });

  test("fingerprint or level mismatch blocked with ITEM_MISSING_OR_CHANGED", () => {
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 4, tier: 2, icon: 50 },
    ]);

    const ref: SelectedItemReference = {
      captured_slot: 0,
      template_id: 101,
      category: 1,
      base_name: "Kiếm Thần",
      tier: 2,
      icon: 50,
      expected_level: 3,
      captured_display_name: "Kiếm Thần +3",
    };

    const result = validateWireIdentity(ref, inv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED);
  });
});

describe("3. Queue Draft Validation", () => {
  const sampleInv = createSampleInventory([
    { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
    { slot: 1, template_id: 202, category: 2, base_name: "Áo Giáp", level: 0, tier: 1, icon: 60 },
  ]);

  test("rejects empty queue draft with QUEUE_EMPTY", () => {
    const result = validateQueueDraft([], sampleInv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.QUEUE_EMPTY);
  });

  test("accepts valid queue draft", () => {
    const queue: EnhancementQueueEntry[] = [
      {
        id: "entry-1",
        reference: {
          captured_slot: 0,
          template_id: 101,
          category: 1,
          base_name: "Kiếm Thần",
          tier: 2,
          icon: 50,
          expected_level: 3,
          captured_display_name: "Kiếm Thần +3",
        },
        target_level: 5,
        payment_type: "GOLD",
        charm_mode: "NONE",
        status: "VALID",
      },
    ];

    const result = validateQueueDraft(queue, sampleInv);
    assert.equal(result.valid, true);
  });

  test("rejects target_level <= initial_level with QUEUE_ITEM_INVALID", () => {
    const queue: EnhancementQueueEntry[] = [
      {
        id: "entry-1",
        reference: {
          captured_slot: 0,
          template_id: 101,
          category: 1,
          base_name: "Kiếm Thần",
          tier: 2,
          icon: 50,
          expected_level: 3,
          captured_display_name: "Kiếm Thần +3",
        },
        target_level: 3,
        payment_type: "GOLD",
        charm_mode: "NONE",
        status: "VALID",
      },
    ];

    const result = validateQueueDraft(queue, sampleInv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID);
  });

  test("rejects out-of-range levels (target > 15, initial > 14)", () => {
    const queue: EnhancementQueueEntry[] = [
      {
        id: "entry-1",
        reference: {
          captured_slot: 0,
          template_id: 101,
          category: 1,
          base_name: "Kiếm Thần",
          tier: 2,
          icon: 50,
          expected_level: 3,
          captured_display_name: "Kiếm Thần +3",
        },
        target_level: 16,
        payment_type: "GOLD",
        charm_mode: "NONE",
        status: "VALID",
      },
    ];

    const result = validateQueueDraft(queue, sampleInv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID);
  });

  test("rejects invalid payment_type or charm_mode", () => {
    const queue: EnhancementQueueEntry[] = [
      {
        id: "entry-1",
        reference: {
          captured_slot: 0,
          template_id: 101,
          category: 1,
          base_name: "Kiếm Thần",
          tier: 2,
          icon: 50,
          expected_level: 3,
          captured_display_name: "Kiếm Thần +3",
        },
        target_level: 5,
        payment_type: "BITCOIN" as unknown as "GOLD",
        charm_mode: "NONE",
        status: "VALID",
      },
    ];

    const result = validateQueueDraft(queue, sampleInv);
    assert.equal(result.valid, false);
    assert.equal(result.code, QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID);
  });

  test("draftToSubmissionPayload maps draft correctly and assigns 1-based queue_order", () => {
    const queue: EnhancementQueueEntry[] = [
      {
        id: "entry-1",
        reference: {
          captured_slot: 0,
          template_id: 101,
          category: 1,
          base_name: "Kiếm Thần",
          tier: 2,
          icon: 50,
          expected_level: 3,
          captured_display_name: "Kiếm Thần +3",
        },
        target_level: 5,
        payment_type: "GOLD",
        charm_mode: "CO_3_LA",
        status: "VALID",
      },
      {
        id: "entry-2",
        reference: {
          captured_slot: 1,
          template_id: 202,
          category: 2,
          base_name: "Áo Giáp",
          tier: 1,
          icon: 60,
          expected_level: 0,
          captured_display_name: "Áo Giáp +0",
        },
        target_level: 4,
        payment_type: "GEMS",
        charm_mode: "AUTO_POLICY",
        status: "VALID",
      },
    ];

    const payload = draftToSubmissionPayload(queue);
    assert.equal(payload.length, 2);
    assert.equal(payload[0].queueOrder, 1);
    assert.equal(payload[0].templateId, 101);
    assert.equal(payload[0].initialLevel, 3);
    assert.equal(payload[0].targetLevel, 5);
    assert.equal(payload[0].paymentType, "GOLD");
    assert.equal(payload[0].charmMode, "CO_3_LA");

    assert.equal(payload[1].queueOrder, 2);
    assert.equal(payload[1].templateId, 202);
    assert.equal(payload[1].initialLevel, 0);
    assert.equal(payload[1].targetLevel, 4);
    assert.equal(payload[1].paymentType, "GEMS");
    assert.equal(payload[1].charmMode, "AUTO_POLICY");
  });
});

describe("4. Atomic Publish & Partial Creation Safety", () => {
  const setupDb = (overrides: Partial<MockDatabaseState> = {}) => {
    const account = { id: "acc-1", user_id: "user-1", device_id: "dev-1", name: "Acc 1" };
    const device = {
      id: "dev-1",
      user_id: "user-1",
      status: "online",
      agent_version: "0.1.0+enhancement-queue-v1",
      last_seen: new Date().toISOString(),
    };
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
    ]);
    const runtime = { account_id: "acc-1", snapshot: { inventory: inv }, process_state: "running" };

    return createMockSupabaseClient({
      accounts: [account],
      devices: [device],
      accountRuntime: [runtime],
      ...overrides,
    });
  };

  const sampleItems: QueueItemSubmissionPayload[] = [
    {
      queueOrder: 1,
      capturedSlot: 0,
      templateId: 101,
      category: 1,
      baseName: "Kiếm Thần",
      tier: 2,
      icon: 50,
      initialLevel: 3,
      targetLevel: 5,
      paymentType: "GOLD",
      charmMode: "NONE",
    },
  ];

  test("job is created in DRAFT and published to QUEUED atomically", async () => {
    const client = setupDb();
    const result = await executeStartQueueFlow(
      client as any,
      { accountId: "acc-1", items: sampleItems },
      { userId: "user-1" },
    );

    assert.equal(result.status, "QUEUED");
    assert.equal(result.totalItems, 1);

    // Verify insert log: Job inserted as DRAFT first
    const jobInsert = client._state.insertLog.find((entry) => entry.table === "enhancement_queue_jobs");
    assert.ok(jobInsert);
    assert.equal(jobInsert.rows[0].status, "DRAFT");

    // Verify RPC was called with draft job ID
    const rpcCall = client._state.rpcLog.find((r) => r.fn === "publish_enhancement_queue_job");
    assert.ok(rpcCall);
    assert.equal(rpcCall.args.p_job_id, result.id);
  });

  test("if item insert fails, publish RPC is NOT called and draft is cleaned up", async () => {
    const client = setupDb({ failItemInsert: true });

    await assert.rejects(
      async () => {
        await executeStartQueueFlow(
          client as any,
          { accountId: "acc-1", items: sampleItems },
          { userId: "user-1" },
        );
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_DRAFT_WRITE_FAILED);
        return true;
      },
    );

    // Publish RPC must NOT have been called
    const rpcCall = client._state.rpcLog.find((r) => r.fn === "publish_enhancement_queue_job");
    assert.equal(rpcCall, undefined);

    // Draft job cleanup must have been called
    const deleteEntry = client._state.deleteLog.find((d) => d.table === "enhancement_queue_jobs");
    assert.ok(deleteEntry);
    assert.equal(deleteEntry.filter.status, "DRAFT");

    // No executable jobs in DB
    assert.equal(client._state.jobs.length, 0);
  });

  test("if capability is missing on server re-check, publish is NOT called", async () => {
    const client = setupDb();
    // Simulate runtime downgrading before publish
    client._state.devices[0].agent_version = "0.1.0+visual-qol-v1";

    await assert.rejects(
      async () => {
        await executeStartQueueFlow(
          client as any,
          { accountId: "acc-1", items: sampleItems },
          { userId: "user-1" },
        );
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_RUNTIME_UNSUPPORTED);
        return true;
      },
    );

    // RPC publish never called
    const rpcCall = client._state.rpcLog.find((r) => r.fn === "publish_enhancement_queue_job");
    assert.equal(rpcCall, undefined);
  });
});

describe("5. Double Submit & Unresolved Exclusivity Contract", () => {
  const sampleItems: QueueItemSubmissionPayload[] = [
    {
      queueOrder: 1,
      capturedSlot: 0,
      templateId: 101,
      category: 1,
      baseName: "Kiếm Thần",
      tier: 2,
      icon: 50,
      initialLevel: 3,
      targetLevel: 5,
      paymentType: "GOLD",
      charmMode: "NONE",
    },
  ];

  test("pre-check blocks Start Queue if active queue already exists", async () => {
    const account = { id: "acc-1", user_id: "user-1", device_id: "dev-1" };
    const device = {
      id: "dev-1",
      user_id: "user-1",
      status: "online",
      agent_version: "0.1.0+enhancement-queue-v1",
      last_seen: new Date().toISOString(),
    };
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
    ]);
    const runtime = { account_id: "acc-1", snapshot: { inventory: inv }, process_state: "running" };

    const client = createMockSupabaseClient({
      accounts: [account],
      devices: [device],
      accountRuntime: [runtime],
      jobs: [
        { id: "existing-job-1", account_id: "acc-1", user_id: "user-1", status: "RUNNING" },
      ],
    });

    await assert.rejects(
      async () => {
        await executeStartQueueFlow(
          client as any,
          { accountId: "acc-1", items: sampleItems },
          { userId: "user-1" },
        );
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_ALREADY_ACTIVE);
        assert.match(err.message, /Tài khoản đã có hàng đợi cường hóa đang hoạt động/);
        return true;
      },
    );
  });

  test("concurrent publication race handles exclusivity conflict deterministically", async () => {
    const account = { id: "acc-1", user_id: "user-1", device_id: "dev-1" };
    const device = {
      id: "dev-1",
      user_id: "user-1",
      status: "online",
      agent_version: "0.1.0+enhancement-queue-v1",
      last_seen: new Date().toISOString(),
    };
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
    ]);
    const runtime = { account_id: "acc-1", snapshot: { inventory: inv }, process_state: "running" };

    const client = createMockSupabaseClient({
      accounts: [account],
      devices: [device],
      accountRuntime: [runtime],
      simulateActiveQueueConflictOnPublish: true, // Simulates DB unique index collision on publish
    });

    await assert.rejects(
      async () => {
        await executeStartQueueFlow(
          client as any,
          { accountId: "acc-1", items: sampleItems },
          { userId: "user-1" },
        );
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_ALREADY_ACTIVE);
        assert.match(err.message, /Xung đột phát hành/);
        return true;
      },
    );
  });
});

describe("6. Field Ownership & Non-Write of Runtime Fields", () => {
  const sampleItems: QueueItemSubmissionPayload[] = [
    {
      queueOrder: 1,
      capturedSlot: 0,
      templateId: 101,
      category: 1,
      baseName: "Kiếm Thần",
      tier: 2,
      icon: 50,
      initialLevel: 3,
      targetLevel: 5,
      paymentType: "GOLD",
      charmMode: "NONE",
    },
  ];

  test("submission never writes runtime-owned fields on jobs or items", async () => {
    const account = { id: "acc-1", user_id: "user-1", device_id: "dev-1" };
    const device = {
      id: "dev-1",
      user_id: "user-1",
      status: "online",
      agent_version: "0.1.0+enhancement-queue-v1",
      last_seen: new Date().toISOString(),
    };
    const inv = createSampleInventory([
      { slot: 0, template_id: 101, category: 1, base_name: "Kiếm Thần", level: 3, tier: 2, icon: 50 },
    ]);
    const runtime = { account_id: "acc-1", snapshot: { inventory: inv }, process_state: "running" };

    const client = createMockSupabaseClient({
      accounts: [account],
      devices: [device],
      accountRuntime: [runtime],
    });

    await executeStartQueueFlow(
      client as any,
      { accountId: "acc-1", items: sampleItems },
      { userId: "user-1" },
    );

    // Inspect Job Insert
    const jobInsert = client._state.insertLog.find((entry) => entry.table === "enhancement_queue_jobs");
    assert.ok(jobInsert);
    const jobRow = jobInsert.rows[0];

    const forbiddenJobFields = [
      "claimed_by",
      "claimed_at",
      "claim_expires_at",
      "active_item_id",
      "active_attempt_uuid",
      "active_command_id",
      "completed_items",
      "started_at",
      "finished_at",
      "error_code",
      "error_message",
    ];
    for (const field of forbiddenJobFields) {
      assert.equal(jobRow[field], undefined, `Web must never write runtime job field: ${field}`);
    }

    // Inspect Item Insert
    const itemInsert = client._state.insertLog.find((entry) => entry.table === "enhancement_queue_items");
    assert.ok(itemInsert);
    const itemRow = itemInsert.rows[0];

    const forbiddenItemFields = [
      "active_attempt_uuid",
      "attempt_phase",
      "attempt_expected_level",
      "attempt_target_level",
      "attempt_started_at",
      "execute_may_have_been_sent_at",
      "attempt_settled_at",
      "last_result_code",
      "actual_gold_spent",
      "actual_gem_spent",
      "actual_material_1_spent",
      "actual_material_2_spent",
      "actual_material_3_spent",
      "actual_material_4_spent",
      "actual_charm_spent",
      "attempt_count",
      "error_code",
      "error_message",
      "started_at",
      "finished_at",
    ];
    for (const field of forbiddenItemFields) {
      assert.equal(itemRow[field], undefined, `Web must never write runtime item field: ${field}`);
    }
  });
});

describe("7. Pause & Cancel Safety & Authorization", () => {
  test("pause sets pause_requested_at without mutating status or active attempts", async () => {
    const job = { id: "job-1", account_id: "acc-1", user_id: "user-1", status: "RUNNING" };
    const client = createMockSupabaseClient({ jobs: [job] });

    const updated = await executePauseQueueFlow(client as any, "job-1", "user-1");
    assert.ok(updated.pauseRequestedAt);
    assert.equal(updated.status, "RUNNING"); // Status untouched!

    const updateLog = client._state.updateLog.find((u) => u.table === "enhancement_queue_jobs");
    assert.ok(updateLog);
    assert.ok(updateLog.patch.pause_requested_at);
    assert.equal(updateLog.patch.status, undefined);
  });

  test("cancel sets cancel_requested_at without mutating status or active attempts", async () => {
    const job = { id: "job-1", account_id: "acc-1", user_id: "user-1", status: "RUNNING" };
    const client = createMockSupabaseClient({ jobs: [job] });

    const updated = await executeCancelQueueFlow(client as any, "job-1", "user-1");
    assert.ok(updated.cancelRequestedAt);
    assert.equal(updated.status, "RUNNING"); // Status untouched!

    const updateLog = client._state.updateLog.find((u) => u.table === "enhancement_queue_jobs");
    assert.ok(updateLog);
    assert.ok(updateLog.patch.cancel_requested_at);
    assert.equal(updateLog.patch.status, undefined);
  });

  test("cross-user pause or cancel is rejected with QUEUE_NOT_OWNED", async () => {
    const job = { id: "job-1", account_id: "acc-1", user_id: "user-2", status: "RUNNING" };
    const client = createMockSupabaseClient({ jobs: [job] });

    await assert.rejects(
      async () => {
        await executePauseQueueFlow(client as any, "job-1", "user-1"); // User 1 tries to pause user 2's job
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_NOT_OWNED);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await executeCancelQueueFlow(client as any, "job-1", "user-1");
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_NOT_OWNED);
        return true;
      },
    );
  });

  test("pause or cancel on terminal job rejected with QUEUE_STATE_CONFLICT", async () => {
    const job = { id: "job-1", account_id: "acc-1", user_id: "user-1", status: "COMPLETED" };
    const client = createMockSupabaseClient({ jobs: [job] });

    await assert.rejects(
      async () => {
        await executePauseQueueFlow(client as any, "job-1", "user-1");
      },
      (err: any) => {
        assert.equal(err.code, QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT);
        return true;
      },
    );
  });
});

describe("8. Browser Lifetime Independence & No Browser Sequencing", () => {
  test("no React timers or effects sequence enhancement attempts in web/src", () => {
    const srcDir = path.resolve(process.cwd(), "src");

    function scanDir(dir: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanDir(fullPath));
        } else if (
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
          !entry.name.endsWith(".types.ts") &&
          entry.name !== "types.ts"
        ) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const executableSrcFiles = scanDir(srcDir);
    for (const file of executableSrcFiles) {
      const content = fs.readFileSync(file, "utf-8");
      // Assert no file attempts to run enhancement execution loops or timers
      assert.doesNotMatch(content, /setInterval\([^)]*enhance/i, `Forbidden enhancement setInterval in ${file}`);
      assert.doesNotMatch(content, /setTimeout\([^)]*enhance.*attempt/i, `Forbidden enhancement setTimeout in ${file}`);
      assert.doesNotMatch(content, /attempt_phase\s*[:=]\s*["']EXECUTE/i, `Forbidden attempt phase mutation in ${file}`);
      assert.doesNotMatch(content, /actual_gold_spent\s*[:=]\s*\d+/i, `Forbidden actual spend mutation in ${file}`);
    }
  });
});

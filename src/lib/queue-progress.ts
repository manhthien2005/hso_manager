/**
 * Enhancement Queue Progress, Attempt Phase Presentation & Authoritative Spend Derivation
 * Task: ENHANCE-05E-WEB-QUEUE-PROGRESS
 *
 * Implements:
 * 1. Authoritative attempt phase mapping to human-readable presentation.
 * 2. Unresolved vs Terminal status classification matching migration 013 partial index.
 * 3. Pure derived queue-wide actual spend aggregation (zero client-side incremental drift).
 * 4. Item progression sequencing & stop-on-failure detection.
 * 5. Full attempt history classification as NOT_SUPPORTED_BY_CURRENT_SCHEMA.
 */

import type {
  EnhancementAttemptPhase,
  EnhancementQueueItem,
  EnhancementQueueItemStatus,
  EnhancementQueueJob,
  EnhancementPaymentType,
  EnhancementCharmMode,
} from "./types";

/**
 * Migration 013 schema audit classification:
 * Migration 013 persists only item-level cumulative spend and latest attempt phase.
 * It does NOT contain an enhancement_queue_attempts history table.
 */
export const FULL_ATTEMPT_HISTORY_SUPPORTED = false;
export const HISTORY_CLASSIFICATION = "NOT_SUPPORTED_BY_CURRENT_SCHEMA" as const;

/**
 * Exact unresolved statuses enforced by migration 013 unique index:
 * idx_enhancement_queue_jobs_account_unresolved_exclusivity
 */
export const UNRESOLVED_QUEUE_STATUSES = [
  "QUEUED",
  "RUNNING",
  "PAUSING",
  "PAUSED",
  "MANUAL_REVIEW_REQUIRED",
] as const;

export type UnresolvedQueueStatus = (typeof UNRESOLVED_QUEUE_STATUSES)[number];

export function isUnresolvedQueueStatus(status: string): status is UnresolvedQueueStatus {
  return (UNRESOLVED_QUEUE_STATUSES as readonly string[]).includes(status);
}

/**
 * Terminal statuses where job execution has completed, failed, or was cancelled.
 */
export const TERMINAL_QUEUE_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type TerminalQueueStatus = (typeof TERMINAL_QUEUE_STATUSES)[number];

export function isTerminalQueueStatus(status: string): status is TerminalQueueStatus {
  return (TERMINAL_QUEUE_STATUSES as readonly string[]).includes(status);
}

export interface AttemptPhasePresentation {
  label: string;
  description: string;
  isExecutionStarted: boolean;
  isSensitive: boolean;
  impliesSuccess: boolean;
}

/**
 * Authoritative presentation mapping for the 7 durable attempt phases defined in migration 013.
 */
export const ATTEMPT_PHASE_INFO: Record<
  EnhancementAttemptPhase,
  AttemptPhasePresentation
> = {
  NONE: {
    label: "Chưa bắt đầu",
    description: "Chưa có lượt cường hóa nào được thực hiện.",
    isExecutionStarted: false,
    isSensitive: false,
    impliesSuccess: false,
  },
  PREPARING: {
    label: "Đang chuẩn bị",
    description: "Đang kiểm tra túi đồ và chuẩn bị tham số cường hóa.",
    isExecutionStarted: true,
    isSensitive: false,
    impliesSuccess: false,
  },
  READY_TO_EXECUTE: {
    label: "Sẵn sàng gửi lệnh",
    description: "Đã chuẩn bị xong dữ liệu, chuẩn bị gửi lệnh tới game.",
    isExecutionStarted: true,
    isSensitive: false,
    impliesSuccess: false,
  },
  EXECUTE_MAY_HAVE_BEEN_SENT: {
    label: "Đang gửi lệnh (Nhạy cảm)",
    description:
      "Lệnh cường hóa có thể đã gửi tới server game. Không can thiệp lúc này để bảo đảm an toàn.",
    isExecutionStarted: true,
    isSensitive: true,
    impliesSuccess: false,
  },
  WAITING_RESULT: {
    label: "Chờ kết quả",
    description: "Đang chờ kết quả phản hồi từ máy chủ game.",
    isExecutionStarted: true,
    isSensitive: true,
    impliesSuccess: false,
  },
  WAITING_SETTLEMENT: {
    label: "Chờ chốt kết quả",
    description: "Đã có phản hồi, đang chờ chốt hạch toán tài nguyên.",
    isExecutionStarted: true,
    isSensitive: true,
    impliesSuccess: false,
  },
  SETTLED: {
    label: "Đã chốt kết quả",
    description: "Lượt cường hóa đã được hạch toán đầy đủ trong cơ sở dữ liệu.",
    isExecutionStarted: true,
    isSensitive: false,
    impliesSuccess: false,
  },
};

export interface DerivedQueueSpend {
  actualGoldSpent: number;
  actualGemSpent: number;
  actualMaterial1Spent: number;
  actualMaterial2Spent: number;
  actualMaterial3Spent: number;
  actualMaterial4Spent: number;
  actualCharmSpent: number;
  totalAttemptCount: number;
}

/**
 * Pure derivation of queue-wide actual spend from authoritative item rows.
 * Prevents double-counting, ignores routing gold, and never mutates client state.
 */
export function deriveQueueSpend(items: readonly EnhancementQueueItem[]): DerivedQueueSpend {
  let actualGoldSpent = 0;
  let actualGemSpent = 0;
  let actualMaterial1Spent = 0;
  let actualMaterial2Spent = 0;
  let actualMaterial3Spent = 0;
  let actualMaterial4Spent = 0;
  let actualCharmSpent = 0;
  let totalAttemptCount = 0;

  for (const item of items) {
    actualGoldSpent += Number(item.actualGoldSpent) || 0;
    actualGemSpent += Number(item.actualGemSpent) || 0;
    actualMaterial1Spent += Number(item.actualMaterial1Spent) || 0;
    actualMaterial2Spent += Number(item.actualMaterial2Spent) || 0;
    actualMaterial3Spent += Number(item.actualMaterial3Spent) || 0;
    actualMaterial4Spent += Number(item.actualMaterial4Spent) || 0;
    actualCharmSpent += Number(item.actualCharmSpent) || 0;
    totalAttemptCount += Number(item.attemptCount) || 0;
  }

  return {
    actualGoldSpent,
    actualGemSpent,
    actualMaterial1Spent,
    actualMaterial2Spent,
    actualMaterial3Spent,
    actualMaterial4Spent,
    actualCharmSpent,
    totalAttemptCount,
  };
}

/**
 * Sorts items strictly by queueOrder ascending.
 * Never relies on DB insertion order.
 */
export function orderQueueItems(
  items: readonly EnhancementQueueItem[],
): EnhancementQueueItem[] {
  return [...items].sort((a, b) => a.queueOrder - b.queueOrder);
}

export interface ItemProgressState {
  item: EnhancementQueueItem;
  isUnexecutedDueToPriorFailure: boolean;
  displayStatus: EnhancementQueueItemStatus | "SKIPPED_AFTER_FAILURE";
}

/**
 * Determines progression state for each item in the ordered queue,
 * explicitly identifying unexecuted items when a previous item stopped due to failure.
 */
export function determineItemProgressState(
  items: readonly EnhancementQueueItem[],
): ItemProgressState[] {
  const ordered = orderQueueItems(items);
  let priorFailureEncountered = false;

  return ordered.map((item) => {
    if (priorFailureEncountered) {
      return {
        item,
        isUnexecutedDueToPriorFailure: true,
        displayStatus: "SKIPPED_AFTER_FAILURE",
      };
    }

    if (item.status === "FAILED" || item.status === "CANCELLED" || item.status === "MANUAL_REVIEW_REQUIRED") {
      priorFailureEncountered = true;
    }

    return {
      item,
      isUnexecutedDueToPriorFailure: false,
      displayStatus: item.status,
    };
  });
}

/**
 * Maps raw snake_case database row from enhancement_queue_items to camelCase EnhancementQueueItem.
 */
export function mapQueueItemRow(row: Record<string, unknown>): EnhancementQueueItem {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    accountId: String(row.account_id),
    userId: String(row.user_id),
    queueOrder: typeof row.queue_order === "number" ? row.queue_order : 1,
    capturedSlot: typeof row.captured_slot === "number" ? row.captured_slot : 0,
    templateId: typeof row.template_id === "number" ? row.template_id : 0,
    category: typeof row.category === "number" ? row.category : 0,
    baseName: String(row.base_name ?? ""),
    tier: typeof row.tier === "number" ? row.tier : 0,
    icon: typeof row.icon === "number" ? row.icon : null,
    initialLevel: typeof row.initial_level === "number" ? row.initial_level : 0,
    currentLevel: typeof row.current_level === "number" ? row.current_level : 0,
    targetLevel: typeof row.target_level === "number" ? row.target_level : 1,
    paymentType: (row.payment_type as EnhancementPaymentType) ?? "GOLD",
    charmMode: (row.charm_mode as EnhancementCharmMode) ?? "NONE",
    status: (row.status as EnhancementQueueItemStatus) ?? "PENDING",
    attemptCount: typeof row.attempt_count === "number" ? row.attempt_count : 0,
    activeAttemptUuid: (row.active_attempt_uuid as string | null) ?? null,
    attemptPhase: (row.attempt_phase as EnhancementAttemptPhase) ?? "NONE",
    attemptExpectedLevel:
      typeof row.attempt_expected_level === "number" ? row.attempt_expected_level : null,
    attemptTargetLevel:
      typeof row.attempt_target_level === "number" ? row.attempt_target_level : null,
    attemptStartedAt: (row.attempt_started_at as string | null) ?? null,
    executeMayHaveBeenSentAt:
      (row.execute_may_have_been_sent_at as string | null) ?? null,
    attemptSettledAt: (row.attempt_settled_at as string | null) ?? null,
    lastResultCode: (row.last_result_code as string | null) ?? null,
    actualGoldSpent: Number(row.actual_gold_spent) || 0,
    actualGemSpent: Number(row.actual_gem_spent) || 0,
    actualMaterial1Spent: Number(row.actual_material_1_spent) || 0,
    actualMaterial2Spent: Number(row.actual_material_2_spent) || 0,
    actualMaterial3Spent: Number(row.actual_material_3_spent) || 0,
    actualMaterial4Spent: Number(row.actual_material_4_spent) || 0,
    actualCharmSpent: Number(row.actual_charm_spent) || 0,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

export interface AuthoritativeQueueWithItems {
  job: EnhancementQueueJob;
  items: EnhancementQueueItem[];
  derivedSpend: DerivedQueueSpend;
}

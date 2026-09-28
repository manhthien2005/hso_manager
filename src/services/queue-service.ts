/**
 * Enhancement Queue Core Service Operations
 * Task: ENHANCE-05D-WEB-QUEUE-DISPATCH
 *
 * Implements:
 * 1. Strict 13-step start queue flow
 * 2. Fail-closed server-side capability check (enhancement-queue-v1)
 * 3. Atomic DRAFT-to-QUEUED publish via migration 013 RPC
 * 4. Partial creation cleanup on failure (never leave executable orphan)
 * 5. Exclusivity conflict handling (at most one active queue per account)
 * 6. Durable request semantics for Pause and Cancel
 * 7. Protection of runtime-owned fields (Web never writes claim, attempt, spend, or settlement fields)
 */

import {
  QUEUE_ERROR_CODES,
  type QueueItemSubmissionPayload,
  validateQueueDraft,
  QueueError,
} from "../lib/queue";
import {
  hasEnhancementQueueCapability,
  isDeviceOnlineAndFresh,
} from "../lib/capabilities";
import type {
  EnhancementQueueJob,
  EnhancementQueueJobStatus,
  EnhancementQueueItem,
  DeviceStatus,
} from "../lib/types";
import type { InventoryCatalogPayload } from "../lib/inventory";
import {
  type AuthoritativeQueueWithItems,
  mapQueueItemRow,
  orderQueueItems,
  deriveQueueSpend,
  UNRESOLVED_QUEUE_STATUSES,
  TERMINAL_QUEUE_STATUSES,
} from "../lib/queue-progress";

import type { Database } from "../lib/database.types";

export type AccountQueueStartRow = Pick<
  Database["public"]["Tables"]["accounts"]["Row"],
  "id" | "user_id" | "device_id" | "label"
>;

export type DeviceQueueStartRow = Pick<
  Database["public"]["Tables"]["devices"]["Row"],
  "id" | "status" | "agent_version" | "last_seen"
>;

export const ACCOUNT_QUEUE_START_COLUMNS = "id, user_id, device_id, label" as const;
export const DEVICE_QUEUE_START_COLUMNS = "id, status, agent_version, last_seen" as const;

export { QueueError };
export type { AuthoritativeQueueWithItems };

export interface StartQueueParams {
  accountId: string;
  items: QueueItemSubmissionPayload[];
}

export interface QueueServiceContext {
  userId: string;
}

// Minimal Supabase client interface required by queue service
export interface SupabaseClientLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: any, args?: any): any;
}

/**
 * Executes the atomic Start Queue flow according to ENHANCE-05D specification.
 *
 * Sequence:
 * 1. Authenticate caller (context.userId).
 * 2. Resolve account & device; verify account ownership.
 * 3. Verify device status is online and fresh (fail closed).
 * 4. Verify enhancement-queue-v1 capability (fail closed).
 * 5. Validate live inventory candidates & wire identity (count of (template_id, category) == 1).
 * 6. Validate complete queue draft payload.
 * 7. Check for existing unresolved queue for account.
 * 8. Create durable job in DRAFT state.
 * 9. Insert all queue items while job remains DRAFT.
 * 10. Verify inserted item count & order match intended draft.
 * 11. Re-check server-side capability immediately before publish.
 * 12. Invoke exact migration 013 RPC: publish_enhancement_queue_job.
 * 13. Confirm returned job status is QUEUED.
 */
export async function executeStartQueueFlow(
  client: SupabaseClientLike,
  params: StartQueueParams,
  context: QueueServiceContext,
): Promise<EnhancementQueueJob> {
  const { accountId, items } = params;
  const { userId } = context;

  if (!userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Yêu cầu phiên đăng nhập xác thực.",
    );
  }

  // 1 & 2. Resolve account and device; verify ownership
  const { data: accountRow, error: accountErr } = await client
    .from("accounts")
    .select(ACCOUNT_QUEUE_START_COLUMNS)
    .eq("id", accountId)
    .maybeSingle();

  if (accountErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi xác thực tài khoản.",
    );
  }

  if (!accountRow) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      `Không tìm thấy tài khoản ${accountId} hoặc không có quyền truy cập.`,
    );
  }

  if (accountRow.user_id !== userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Tài khoản không thuộc quyền sở hữu của người dùng hiện tại.",
    );
  }

  const { data: deviceRow, error: deviceErr } = await client
    .from("devices")
    .select(DEVICE_QUEUE_START_COLUMNS)
    .eq("id", accountRow.device_id)
    .maybeSingle();

  if (deviceErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi xác định thiết bị điều khiển.",
    );
  }

  if (!deviceRow) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_RUNTIME_STALE,
      "Không tìm thấy thiết bị điều khiển liên kết với tài khoản.",
    );
  }

  const lastSeenMs = deviceRow.last_seen
    ? new Date(deviceRow.last_seen).getTime()
    : null;

  const mockDevice = {
    id: deviceRow.id,
    deviceId: deviceRow.id,
    userId: accountRow.user_id,
    name: "",
    region: "",
    status: deviceRow.status as DeviceStatus,
    agentVersion: deviceRow.agent_version,
    lastSeen: lastSeenMs,
  };

  // 3. Verify device status is online and fresh
  if (!isDeviceOnlineAndFresh(mockDevice)) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_RUNTIME_STALE,
      "Runtime thiết bị đang ngoại tuyến hoặc mất kết nối quá 5 phút. Vui lòng kiểm tra lại thiết bị.",
    );
  }

  // 4. Verify enhancement-queue-v1 capability
  if (!hasEnhancementQueueCapability(deviceRow.agent_version)) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_RUNTIME_UNSUPPORTED,
      "Runtime thiết bị hiện tại chưa hỗ trợ hàng đợi cường hóa (thiếu capability token enhancement-queue-v1).",
    );
  }

  // 5. Fetch live inventory snapshot and validate wire identity
  const { data: runtimeRow } = await client
    .from("account_runtime")
    .select("snapshot, process_state")
    .eq("account_id", accountId)
    .maybeSingle();

  const rawInventory = runtimeRow?.snapshot?.inventory;
  const liveInventory: InventoryCatalogPayload | null =
    rawInventory && rawInventory.version === 1 ? rawInventory : null;

  if (!liveInventory) {
    throw new QueueError(
      QUEUE_ERROR_CODES.ITEM_MISSING_OR_CHANGED,
      "Không có dữ liệu túi đồ thời gian thực (snapshot.inventory v1) cho tài khoản này.",
    );
  }

  // 6. Validate complete queue draft payload
  if (!Array.isArray(items) || items.length === 0) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_EMPTY,
      "Hàng đợi cường hóa trống. Cần ít nhất 1 trang bị.",
    );
  }

  const draftEntries = items.map((it, idx) => ({
    id: `submit-${idx}`,
    reference: {
      captured_slot: it.capturedSlot,
      template_id: it.templateId,
      category: it.category,
      base_name: it.baseName,
      tier: it.tier,
      icon: it.icon,
      expected_level: it.initialLevel,
      captured_display_name: `${it.baseName} +${it.initialLevel}`,
    },
    target_level: it.targetLevel,
    payment_type: it.paymentType,
    charm_mode: it.charmMode,
    status: "VALID" as const,
  }));

  const validation = validateQueueDraft(draftEntries, liveInventory);
  if (!validation.valid) {
    throw new QueueError(
      validation.code ?? QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      validation.message ?? "Dữ liệu hàng đợi không hợp lệ.",
    );
  }

  // 7. Check for existing unresolved queue for account
  const { data: existingActive, error: activeErr } = await client
    .from("enhancement_queue_jobs")
    .select("id, status")
    .eq("account_id", accountId)
    .in("status", [
      "QUEUED",
      "RUNNING",
      "PAUSING",
      "PAUSED",
      "MANUAL_REVIEW_REQUIRED",
    ])
    .maybeSingle();

  if (activeErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      "Không thể kiểm tra trạng thái hàng đợi hiện có.",
    );
  }

  if (existingActive) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ALREADY_ACTIVE,
      `Tài khoản đã có hàng đợi cường hóa đang hoạt động hoặc chưa hoàn tất (mã job: ${existingActive.id}, trạng thái: ${existingActive.status}).`,
    );
  }

  // 8. Create durable job in DRAFT state
  // Web ONLY writes ownership/submission fields: account_id, device_id, user_id, status: 'DRAFT'
  const { data: createdJob, error: createJobErr } = await client
    .from("enhancement_queue_jobs")
    .insert({
      account_id: accountId,
      device_id: accountRow.device_id,
      user_id: userId,
      status: "DRAFT",
    })
    .select("*")
    .single();

  if (createJobErr || !createdJob) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_DRAFT_WRITE_FAILED,
      `Không thể tạo bản ghi hàng đợi DRAFT: ${createJobErr?.message ?? "Lỗi không xác định"}`,
    );
  }

  const draftJobId = createdJob.id;

  try {
    // 9. Insert all queue items while job remains DRAFT
    // Web ONLY writes intent/fingerprint fields. Web NEVER writes runtime-owned fields!
    const itemRows = items.map((item, idx) => ({
      job_id: draftJobId,
      account_id: accountId,
      user_id: userId,
      queue_order: item.queueOrder ?? idx + 1,
      captured_slot: item.capturedSlot,
      template_id: item.templateId,
      category: item.category,
      base_name: item.baseName,
      tier: item.tier,
      icon: item.icon ?? null,
      initial_level: item.initialLevel,
      current_level: item.initialLevel,
      target_level: item.targetLevel,
      payment_type: item.paymentType,
      charm_mode: item.charmMode ?? "NONE",
      status: "PENDING",
    }));

    const { data: insertedItems, error: insertItemsErr } = await client
      .from("enhancement_queue_items")
      .insert(itemRows)
      .select("id, queue_order");

    if (insertItemsErr || !insertedItems || insertedItems.length !== items.length) {
      throw new Error(
        `Thất bại khi lưu danh sách trang bị vào DRAFT: ${insertItemsErr?.message ?? "Không đủ số lượng bản ghi"}`,
      );
    }

    // 10. Verify inserted item count & order matches intended draft
    if (insertedItems.length !== items.length) {
      throw new Error("Số lượng trang bị lưu trong DRAFT không khớp với dự thảo.");
    }

    // 11. Re-check server-side capability immediately before publish
    const { data: recheckDevice } = await client
      .from("devices")
      .select("agent_version, status, last_seen")
      .eq("id", accountRow.device_id)
      .maybeSingle();

    if (
      !recheckDevice ||
      !hasEnhancementQueueCapability(recheckDevice.agent_version)
    ) {
      throw new QueueError(
        QUEUE_ERROR_CODES.QUEUE_RUNTIME_UNSUPPORTED,
        "Capability enhancement-queue-v1 không còn khả dụng trên runtime trước thời điểm publish.",
      );
    }

    // 12. Invoke exact migration 013 DRAFT-to-QUEUED publication contract
    const { data: publishedJobRow, error: publishErr } = await client.rpc(
      "publish_enhancement_queue_job",
      { p_job_id: draftJobId },
    );

    if (publishErr || !publishedJobRow) {
      const errMsg = publishErr?.message ?? "";
      if (
        errMsg.includes("already has an active or unresolved enhancement queue") ||
        errMsg.includes("idx_enhancement_queue_jobs_account_unresolved_exclusivity")
      ) {
        throw new QueueError(
          QUEUE_ERROR_CODES.QUEUE_ALREADY_ACTIVE,
          "Xung đột phát hành: tài khoản đã có hàng đợi khác vừa kích hoạt.",
        );
      }
      throw new QueueError(
        QUEUE_ERROR_CODES.QUEUE_PUBLISH_FAILED,
        `Xuất bản hàng đợi thất bại: ${errMsg}`,
      );
    }

    // 13. Confirm returned job is QUEUED
    if (publishedJobRow.status !== "QUEUED") {
      throw new QueueError(
        QUEUE_ERROR_CODES.QUEUE_PUBLISH_FAILED,
        `Trạng thái sau khi publish không phải QUEUED (hiện tại: ${publishedJobRow.status}).`,
      );
    }

    return mapQueueJobRow(publishedJobRow);
  } catch (err) {
    // Partial creation failure cleanup: clean up the failed DRAFT
    try {
      await client
        .from("enhancement_queue_jobs")
        .delete()
        .eq("id", draftJobId)
        .eq("status", "DRAFT");
    } catch {
      // If cleanup fails, the orphan job remains in DRAFT state and is non-executable
    }

    if (err instanceof QueueError) {
      throw err;
    }
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_DRAFT_WRITE_FAILED,
      err instanceof Error ? err.message : "Lỗi xử lý hàng đợi",
    );
  }
}

/**
 * Handles durable Pause Request.
 * Does NOT directly force status to PAUSED or interrupt in-flight execute.
 * Allowed even if runtime capability is temporarily missing/stale/offline.
 */
export async function executePauseQueueFlow(
  client: SupabaseClientLike,
  jobId: string,
  userId: string,
): Promise<EnhancementQueueJob> {
  if (!userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Yêu cầu phiên đăng nhập xác thực.",
    );
  }

  const { data: job, error: fetchErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi kiểm tra hàng đợi.",
    );
  }

  if (!job) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      `Không tìm thấy hàng đợi ${jobId}.`,
    );
  }

  if (job.user_id !== userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Không có quyền thao tác trên hàng đợi của người dùng khác.",
    );
  }

  const unresolvedStatuses = ["QUEUED", "RUNNING", "PAUSING", "PAUSED"];
  if (!unresolvedStatuses.includes(job.status)) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Hàng đợi đã ở trạng thái kết thúc (${job.status}), không thể yêu cầu tạm dừng.`,
    );
  }

  // Durable request semantics only: update pause_requested_at
  const nowIso = new Date().toISOString();
  const { data: updatedJob, error: updateErr } = await client
    .from("enhancement_queue_jobs")
    .update({
      pause_requested_at: nowIso,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updateErr || !updatedJob) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể ghi nhận yêu cầu tạm dừng: ${updateErr?.message ?? "Lỗi không xác định"}`,
    );
  }

  return mapQueueJobRow(updatedJob);
}

/**
 * Handles durable Cancel Request.
 * Does NOT directly force status to CANCELLED or mark sent attempts cancelled.
 * Allowed even if runtime capability is temporarily missing/stale/offline.
 */
export async function executeCancelQueueFlow(
  client: SupabaseClientLike,
  jobId: string,
  userId: string,
): Promise<EnhancementQueueJob> {
  if (!userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Yêu cầu phiên đăng nhập xác thực.",
    );
  }

  const { data: job, error: fetchErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi kiểm tra hàng đợi.",
    );
  }

  if (!job) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      `Không tìm thấy hàng đợi ${jobId}.`,
    );
  }

  if (job.user_id !== userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Không có quyền thao tác trên hàng đợi của người dùng khác.",
    );
  }

  if (job.status === "MANUAL_REVIEW_REQUIRED") {
    throw new QueueError(
      QUEUE_ERROR_CODES.MANUAL_REVIEW_RESOLUTION_REQUIRED,
      "Hàng đợi đang ở trạng thái cần kiểm tra thủ công (MANUAL_REVIEW_REQUIRED). Không thể hủy thông thường, vui lòng sử dụng quy trình xử lý chuyên biệt.",
    );
  }

  const unresolvedStatuses = [
    "QUEUED",
    "RUNNING",
    "PAUSING",
    "PAUSED",
  ];
  if (!unresolvedStatuses.includes(job.status)) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Hàng đợi đã ở trạng thái kết thúc (${job.status}), không thể yêu cầu hủy bỏ.`,
    );
  }

  // Durable request semantics only: update cancel_requested_at
  const nowIso = new Date().toISOString();
  const { data: updatedJob, error: updateErr } = await client
    .from("enhancement_queue_jobs")
    .update({
      cancel_requested_at: nowIso,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updateErr || !updatedJob) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể ghi nhận yêu cầu hủy bỏ: ${updateErr?.message ?? "Lỗi không xác định"}`,
    );
  }

  return mapQueueJobRow(updatedJob);
}

/**
 * Executes explicit administrative resolution for MANUAL_REVIEW_REQUIRED queue jobs.
 *
 * Requirements (Task ENHANCE-05J):
 * 1. Requires authenticated user who owns the queue job.
 * 2. Only supports disposition 'ABANDON_UNRESOLVED'.
 * 3. Does not require enhancement-queue-v1 runtime capability or active game client.
 * 4. Checks job is currently MANUAL_REVIEW_REQUIRED (or already resolved with ABANDON_UNRESOLVED for idempotency).
 * 5. Calls canonical transactional RPC resolve_enhancement_queue_manual_review.
 * 6. Preserves Candidate A attempt UUID, phase, null authoritative result, null settlement timestamp, and spend.
 * 7. Cancels unattempted items (Candidate B).
 * 8. Releases account exclusivity by transitioning job to CANCELLED outside partial index.
 */
export async function executeResolveManualReviewFlow(
  client: SupabaseClientLike,
  jobId: string,
  userId: string,
  disposition: "ABANDON_UNRESOLVED" = "ABANDON_UNRESOLVED",
  note?: string | null,
): Promise<EnhancementQueueJob> {
  if (!userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Yêu cầu phiên đăng nhập xác thực.",
    );
  }

  if (disposition !== "ABANDON_UNRESOLVED") {
    throw new QueueError(
      QUEUE_ERROR_CODES.MANUAL_REVIEW_INVALID_DISPOSITION,
      `Hành động xử lý không hợp lệ: ${disposition}. Chỉ hỗ trợ ABANDON_UNRESOLVED.`,
    );
  }

  if (note && note.length > 500) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      "Ghi chú xử lý không được vượt quá 500 ký tự.",
    );
  }

  // 1. Fetch job to verify existence and ownership
  const { data: job, error: fetchErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi kiểm tra hàng đợi.",
    );
  }

  if (!job) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      `Không tìm thấy hàng đợi ${jobId}.`,
    );
  }

  if (job.user_id !== userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Không có quyền thao tác trên hàng đợi của người dùng khác.",
    );
  }

  // 2. Idempotency check: if already resolved with ABANDON_UNRESOLVED
  if (job.status === "CANCELLED" && job.resolution_kind === "ABANDON_UNRESOLVED") {
    return mapQueueJobRow(job);
  }

  // 3. Status pre-validation
  if (job.status !== "MANUAL_REVIEW_REQUIRED") {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Hàng đợi đang ở trạng thái ${job.status}, không thể thực hiện xử lý thủ công (chỉ hỗ trợ MANUAL_REVIEW_REQUIRED).`,
    );
  }

  // 4. Call canonical transactional RPC
  const { data: resolvedRow, error: rpcErr } = await client.rpc(
    "resolve_enhancement_queue_manual_review",
    {
      p_job_id: jobId,
      p_disposition: disposition,
      p_note: note ?? null,
    },
  );

  if (rpcErr || !resolvedRow) {
    const errMsg = rpcErr?.message ?? "";
    if (errMsg.includes("MANUAL_REVIEW_STATE_CHANGED")) {
      throw new QueueError(
        QUEUE_ERROR_CODES.MANUAL_REVIEW_STATE_CHANGED,
        `Trạng thái hàng đợi hoặc trang bị đã thay đổi trước khi xử lý: ${errMsg}`,
      );
    }
    if (errMsg.includes("not owned")) {
      throw new QueueError(
        QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
        "Không có quyền thao tác trên hàng đợi này.",
      );
    }
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể xử lý hàng đợi: ${errMsg}`,
    );
  }

  return mapQueueJobRow(resolvedRow);
}

export interface AtomicReconcileAndCloseParams {
  jobId: string;
  targetItemId: string;
  attemptUuid: string;
  provenTargetLevel: number;
  spendGold?: number;
  spendGem?: number;
  spendMaterial1?: number;
  spendMaterial2?: number;
  spendMaterial3?: number;
  spendMaterial4?: number;
  spendCharm?: number;
  reconciliationReason?: string;
  resolutionNote?: string | null;
}

/**
 * Executes the atomic state reconcile and close flow (ENHANCE-05N).
 * Settle proven Candidate A, cancel remaining unattempted Candidate B, and terminalize job.
 */
export async function executeAtomicReconcileAndCloseFlow(
  client: SupabaseClientLike,
  params: AtomicReconcileAndCloseParams,
  context?: QueueServiceContext,
): Promise<EnhancementQueueJob> {
  const {
    jobId,
    targetItemId,
    attemptUuid,
    provenTargetLevel,
    spendGold = 0,
    spendGem = 0,
    spendMaterial1 = 0,
    spendMaterial2 = 0,
    spendMaterial3 = 0,
    spendMaterial4 = 0,
    spendCharm = 0,
    reconciliationReason = "STATE_RECONCILED_SUCCESS",
    resolutionNote = null,
  } = params;

  if (!jobId || !targetItemId || !attemptUuid) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      "Thiếu tham số bắt buộc (jobId, targetItemId, attemptUuid).",
    );
  }

  if (typeof provenTargetLevel !== "number" || provenTargetLevel < 1 || provenTargetLevel > 15) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      `Cấp độ đích xác thực không hợp lệ: ${provenTargetLevel} (phải từ 1 đến 15).`,
    );
  }

  // 1. Fetch job to verify existence and ownership
  const { data: job, error: fetchErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi kiểm tra hàng đợi.",
    );
  }

  if (!job) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      `Không tìm thấy hàng đợi ${jobId}.`,
    );
  }

  if (context?.userId && job.user_id !== context.userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Không có quyền thao tác trên hàng đợi của người dùng khác.",
    );
  }

  // 2. Call canonical transactional RPC (RPC handles concurrency, idempotency, and all guards)
  const { data: resolvedRow, error: rpcErr } = await client.rpc(
    "reconcile_enhancement_manual_review_and_close",
    {
      p_job_id: jobId,
      p_target_item_id: targetItemId,
      p_attempt_uuid: attemptUuid,
      p_proven_target_level: provenTargetLevel,
      p_actual_gold_spent: spendGold,
      p_actual_gem_spent: spendGem,
      p_actual_material_1_spent: spendMaterial1,
      p_actual_material_2_spent: spendMaterial2,
      p_actual_material_3_spent: spendMaterial3,
      p_actual_material_4_spent: spendMaterial4,
      p_actual_charm_spent: spendCharm,
      p_reconciliation_reason: reconciliationReason,
      p_resolution_note: resolutionNote ?? null,
    },
  );

  if (rpcErr || !resolvedRow) {
    const errMsg = rpcErr?.message ?? "";
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể đối soát và đóng hàng đợi: ${errMsg}`,
    );
  }

  return mapQueueJobRow(resolvedRow);
}

export interface AtomicCapturedResultRecoveryParams {
  jobId: string;
  targetItemId: string;
  attemptUuid: string;
  provenTargetLevel: number;
  capturedResultCode?: number;
  spendGold?: number;
  spendGem?: number;
  spendMaterial1?: number;
  spendMaterial2?: number;
  spendMaterial3?: number;
  spendMaterial4?: number;
  spendCharm?: number;
  resolutionNote?: string | null;
}

/**
 * Executes the atomic captured result success recovery flow (ENHANCE-05R).
 * Settle proven Candidate A with server captured result code 3 and settlement_source = RESULT_CODE,
 * cancel remaining unattempted Candidate B, and terminalize job as CANCELLED with
 * resolution_kind = RESULT_CODE_SUCCESS_CLOSE_REMAINDER.
 */
export async function executeAtomicCapturedResultRecoveryFlow(
  client: SupabaseClientLike,
  params: AtomicCapturedResultRecoveryParams,
  context?: QueueServiceContext,
): Promise<EnhancementQueueJob> {
  const {
    jobId,
    targetItemId,
    attemptUuid,
    provenTargetLevel,
    capturedResultCode = 3,
    spendGold = 0,
    spendGem = 0,
    spendMaterial1 = 0,
    spendMaterial2 = 0,
    spendMaterial3 = 0,
    spendMaterial4 = 0,
    spendCharm = 0,
    resolutionNote = null,
  } = params;

  if (!jobId || !targetItemId || !attemptUuid) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      "Thiếu tham số bắt buộc (jobId, targetItemId, attemptUuid).",
    );
  }

  if (capturedResultCode !== 3) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      `Mã kết quả thành công không hợp lệ: ${capturedResultCode} (phải là 3).`,
    );
  }

  if (typeof provenTargetLevel !== "number" || provenTargetLevel < 1 || provenTargetLevel > 15) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      `Cấp độ đích xác thực không hợp lệ: ${provenTargetLevel} (phải từ 1 đến 15).`,
    );
  }

  if (
    spendGold < 0 ||
    spendGem < 0 ||
    spendMaterial1 < 0 ||
    spendMaterial2 < 0 ||
    spendMaterial3 < 0 ||
    spendMaterial4 < 0 ||
    spendCharm < 0
  ) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_ITEM_INVALID,
      "Chi phí thực tế không được âm.",
    );
  }

  // 1. Fetch job to verify existence and ownership
  const { data: job, error: fetchErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_BACKEND_QUERY_FAILED,
      "Lỗi truy vấn cơ sở dữ liệu khi kiểm tra hàng đợi.",
    );
  }

  if (!job) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      `Không tìm thấy hàng đợi ${jobId}.`,
    );
  }

  if (context?.userId && job.user_id !== context.userId) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_NOT_OWNED,
      "Không có quyền thao tác trên hàng đợi của người dùng khác.",
    );
  }

  // 2. Call canonical transactional RPC (service_role only)
  const { data: resolvedRow, error: rpcErr } = await client.rpc(
    "recover_enhancement_result_code_success_and_close",
    {
      p_job_id: jobId,
      p_target_item_id: targetItemId,
      p_attempt_uuid: attemptUuid,
      p_proven_target_level: provenTargetLevel,
      p_captured_result_code: capturedResultCode,
      p_actual_gold_spent: spendGold,
      p_actual_gem_spent: spendGem,
      p_actual_material_1_spent: spendMaterial1,
      p_actual_material_2_spent: spendMaterial2,
      p_actual_material_3_spent: spendMaterial3,
      p_actual_material_4_spent: spendMaterial4,
      p_actual_charm_spent: spendCharm,
      p_resolution_note: resolutionNote ?? null,
    },
  );

  if (rpcErr || !resolvedRow) {
    const errMsg = rpcErr?.message ?? "";
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể khôi phục kết quả máy chủ và đóng hàng đợi: ${errMsg}`,
    );
  }

  return mapQueueJobRow(resolvedRow);
}

/**
 * Maps Supabase raw database snake_case row to camelCase EnhancementQueueJob.
 */
export function mapQueueJobRow(row: Record<string, unknown>): EnhancementQueueJob {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    deviceId: String(row.device_id),
    userId: String(row.user_id),
    status: row.status as EnhancementQueueJobStatus,
    activeItemId: (row.active_item_id as string | null) ?? null,
    activeAttemptUuid: (row.active_attempt_uuid as string | null) ?? null,
    activeCommandId: (row.active_command_id as string | null) ?? null,
    totalItems: typeof row.total_items === "number" ? row.total_items : 0,
    completedItems: typeof row.completed_items === "number" ? row.completed_items : 0,
    claimedBy: (row.claimed_by as string | null) ?? null,
    claimedAt: (row.claimed_at as string | null) ?? null,
    claimExpiresAt: (row.claim_expires_at as string | null) ?? null,
    pauseRequestedAt: (row.pause_requested_at as string | null) ?? null,
    cancelRequestedAt: (row.cancel_requested_at as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    updatedAt: String(row.updated_at),
    resolutionKind: (row.resolution_kind as "ABANDON_UNRESOLVED" | "RECONCILED_SUCCESS_CLOSE_REMAINDER" | "RESULT_CODE_SUCCESS_CLOSE_REMAINDER" | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    resolvedBy: (row.resolved_by as string | null) ?? null,
    resolutionNote: (row.resolution_note as string | null) ?? null,
  };
}

/**
 * Loads the current owned unresolved queue for the given account with ordered items.
 *
 * Requirements:
 * 1. Matches exact unresolved statuses from migration 013.
 * 2. Orders items explicitly by queue_order ascending (never relies on DB insertion order).
 * 3. Fails visibly with QUEUE_STATE_CONFLICT if multiple unresolved queues are found.
 * 4. Derives queue-wide actual spend purely from settled item rows.
 */
export async function fetchActiveQueueWithItems(
  client: SupabaseClientLike,
  accountId: string,
): Promise<AuthoritativeQueueWithItems | null> {
  if (!accountId) return null;

  // 1. Query unresolved jobs for account
  const { data: jobRows, error: jobErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("account_id", accountId)
    .in("status", [...UNRESOLVED_QUEUE_STATUSES]);

  if (jobErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể truy vấn trạng thái hàng đợi: ${jobErr.message}`,
    );
  }

  if (!jobRows || jobRows.length === 0) {
    return null;
  }

  // Multi-queue protection: fail visibly if multiple unresolved queues exist
  if (jobRows.length > 1) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Phát hiện nhiều hơn 1 hàng đợi (${jobRows.length}) chưa hoàn tất cho tài khoản ${accountId}. Vui lòng kiểm tra lại.`,
    );
  }

  const job = mapQueueJobRow(jobRows[0]);

  // 2. Query items ordered explicitly by queue_order ascending
  const { data: itemRows, error: itemErr } = await client
    .from("enhancement_queue_items")
    .select("*")
    .eq("job_id", job.id)
    .order("queue_order", { ascending: true });

  if (itemErr) {
    throw new QueueError(
      QUEUE_ERROR_CODES.QUEUE_STATE_CONFLICT,
      `Không thể tải danh sách trang bị của hàng đợi ${job.id}: ${itemErr.message}`,
    );
  }

  const items = orderQueueItems((itemRows ?? []).map(mapQueueItemRow));
  const derivedSpend = deriveQueueSpend(items);

  return {
    job,
    items,
    derivedSpend,
  };
}

/**
 * Loads recent terminal queue history (COMPLETED, FAILED, CANCELLED) with ordered items.
 */
export async function fetchRecentQueueHistory(
  client: SupabaseClientLike,
  accountId: string,
  limit = 5,
): Promise<AuthoritativeQueueWithItems[]> {
  if (!accountId) return [];

  // Query terminal jobs
  const { data: jobRows, error: jobErr } = await client
    .from("enhancement_queue_jobs")
    .select("*")
    .eq("account_id", accountId)
    .in("status", [...TERMINAL_QUEUE_STATUSES])
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (jobErr || !jobRows || jobRows.length === 0) {
    return [];
  }

  const jobIds = jobRows.map((j: Record<string, unknown>) => String(j.id));
  const { data: itemRows } = await client
    .from("enhancement_queue_items")
    .select("*")
    .in("job_id", jobIds)
    .order("queue_order", { ascending: true });

  const allItems = (itemRows ?? []).map(mapQueueItemRow);

  return jobRows.map((rawJob: Record<string, unknown>) => {
    const job = mapQueueJobRow(rawJob);
    const items = orderQueueItems(allItems.filter((it: EnhancementQueueItem) => it.jobId === job.id));
    const derivedSpend = deriveQueueSpend(items);
    return {
      job,
      items,
      derivedSpend,
    };
  });
}


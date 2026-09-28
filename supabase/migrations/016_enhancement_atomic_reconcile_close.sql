-- =============================================================================
-- Migration 016: Enhancement Queue Atomic State Reconcile and Close
-- Task: ENHANCE-05N-ATOMIC-RECONCILE-CLOSE-CORRECTIVE
--
-- Features:
-- 1. Extend resolution_kind check constraint on public.enhancement_queue_jobs:
--    - Adds 'RECONCILED_SUCCESS_CLOSE_REMAINDER' alongside 'ABANDON_UNRESOLVED'
--
-- 2. Transactional Canonical RPC public.reconcile_enhancement_manual_review_and_close:
--    - Locks target job row FOR UPDATE
--    - Locks all queue item rows FOR UPDATE in deterministic queue_order
--    - Requires job currently MANUAL_REVIEW_REQUIRED
--    - Validates target item is currently MANUAL_REVIEW_REQUIRED with exact active_attempt_uuid
--    - Validates attempt_phase is post-fence (EXECUTE_MAY_HAVE_BEEN_SENT, WAITING_RESULT, WAITING_SETTLEMENT)
--    - Validates last_result_code IS NULL, attempt_settled_at IS NULL, settlement_source IS NULL
--    - Validates proven target level equals queued target_level
--    - Validates all remaining items are never attempted (attempt_uuid NULL, attempt_count 0, zero spend)
--    - Atomically settles Candidate A as COMPLETED with settlement_source = 'STATE_RECONCILED'
--      and preserves last_result_code = NULL
--    - Atomically cancels all remaining unattempted items (Candidate B, etc.)
--    - Atomically terminalizes job as CANCELLED with resolution_kind = 'RECONCILED_SUCCESS_CLOSE_REMAINDER'
--    - Prevents any transient intermediate state where Candidate B is executable
--    - Idempotent on repeated calls with identical recovery evidence; fails closed on conflicting parameters
--    - Restricted execution: service_role only (revoked from anon/authenticated)
-- =============================================================================

-- ── 1. Safely Extend Resolution Kind Check Constraint ────────────────────────

DO $$
BEGIN
  ALTER TABLE public.enhancement_queue_jobs
    DROP CONSTRAINT IF EXISTS enhancement_queue_jobs_resolution_kind_check;

  ALTER TABLE public.enhancement_queue_jobs
    ADD CONSTRAINT enhancement_queue_jobs_resolution_kind_check
    CHECK (resolution_kind IS NULL OR resolution_kind IN ('ABANDON_UNRESOLVED', 'RECONCILED_SUCCESS_CLOSE_REMAINDER'));
END $$;

-- ── 2. Canonical RPC: reconcile_enhancement_manual_review_and_close ──────────

CREATE OR REPLACE FUNCTION public.reconcile_enhancement_manual_review_and_close(
  p_job_id uuid,
  p_target_item_id uuid,
  p_attempt_uuid uuid,
  p_proven_target_level integer,
  p_actual_gold_spent bigint DEFAULT 0,
  p_actual_gem_spent bigint DEFAULT 0,
  p_actual_material_1_spent bigint DEFAULT 0,
  p_actual_material_2_spent bigint DEFAULT 0,
  p_actual_material_3_spent bigint DEFAULT 0,
  p_actual_material_4_spent bigint DEFAULT 0,
  p_actual_charm_spent bigint DEFAULT 0,
  p_reconciliation_reason text DEFAULT 'STATE_RECONCILED_SUCCESS',
  p_resolution_note text DEFAULT NULL
)
RETURNS public.enhancement_queue_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.enhancement_queue_jobs%ROWTYPE;
  v_target_item public.enhancement_queue_items%ROWTYPE;
  v_mr_items_count integer;
  v_invalid_remaining_count integer;
  v_user_id uuid;
BEGIN
  -- 1. Input Validation
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'job_id cannot be null';
  END IF;

  IF p_target_item_id IS NULL THEN
    RAISE EXCEPTION 'target_item_id cannot be null';
  END IF;

  IF p_attempt_uuid IS NULL THEN
    RAISE EXCEPTION 'attempt_uuid cannot be null';
  END IF;

  IF p_proven_target_level IS NULL OR p_proven_target_level < 1 OR p_proven_target_level > 15 THEN
    RAISE EXCEPTION 'invalid proven target level: % (must be between 1 and 15)', p_proven_target_level;
  END IF;

  IF p_actual_gold_spent < 0 OR p_actual_gem_spent < 0 OR
     p_actual_material_1_spent < 0 OR p_actual_material_2_spent < 0 OR
     p_actual_material_3_spent < 0 OR p_actual_material_4_spent < 0 OR
     p_actual_charm_spent < 0 THEN
    RAISE EXCEPTION 'actual spend amounts must be non-negative';
  END IF;

  IF p_reconciliation_reason IS NOT NULL AND char_length(p_reconciliation_reason) > 500 THEN
    RAISE EXCEPTION 'reconciliation reason exceeds maximum length of 500 characters';
  END IF;

  IF p_resolution_note IS NOT NULL AND char_length(p_resolution_note) > 500 THEN
    RAISE EXCEPTION 'resolution note exceeds maximum length of 500 characters';
  END IF;

  -- 2. Lock target job row for update
  SELECT * INTO v_job
  FROM public.enhancement_queue_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enhancement queue job % not found', p_job_id;
  END IF;

  -- 3. Lock all queue item rows for that job in deterministic order
  PERFORM id
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
  ORDER BY queue_order ASC
  FOR UPDATE;

  -- 4. Idempotency Check:
  -- If already resolved with RECONCILED_SUCCESS_CLOSE_REMAINDER and CANCELLED
  IF v_job.status = 'CANCELLED' AND v_job.resolution_kind = 'RECONCILED_SUCCESS_CLOSE_REMAINDER' THEN
    SELECT * INTO v_target_item
    FROM public.enhancement_queue_items
    WHERE id = p_target_item_id AND job_id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONFLICTING_RECOVERY: target item % not found on job %', p_target_item_id, p_job_id;
    END IF;

    -- Verify identical recovery evidence
    IF v_target_item.status = 'COMPLETED'
       AND v_target_item.settlement_source = 'STATE_RECONCILED'
       AND v_target_item.active_attempt_uuid = p_attempt_uuid
       AND v_target_item.current_level = p_proven_target_level
       AND v_target_item.actual_gold_spent = p_actual_gold_spent
       AND v_target_item.actual_gem_spent = p_actual_gem_spent
       AND v_target_item.actual_material_1_spent = p_actual_material_1_spent
       AND v_target_item.actual_material_2_spent = p_actual_material_2_spent
       AND v_target_item.actual_material_3_spent = p_actual_material_3_spent
       AND v_target_item.actual_material_4_spent = p_actual_material_4_spent
       AND v_target_item.actual_charm_spent = p_actual_charm_spent
    THEN
      RETURN v_job;
    ELSE
      RAISE EXCEPTION 'CONFLICTING_RECOVERY: job % already reconciled with different parameters or evidence', p_job_id;
    END IF;
  END IF;

  -- 5. Job Status Requirement
  IF v_job.status <> 'MANUAL_REVIEW_REQUIRED' THEN
    RAISE EXCEPTION 'job % cannot be reconciled: current status is % (must be MANUAL_REVIEW_REQUIRED)', p_job_id, v_job.status;
  END IF;

  -- 6. Require exactly one MANUAL_REVIEW_REQUIRED item on this job
  SELECT count(*) INTO v_mr_items_count
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id AND status = 'MANUAL_REVIEW_REQUIRED';

  IF v_mr_items_count <> 1 THEN
    RAISE EXCEPTION 'INVALID_RECOVERY_TARGET: job % must have exactly 1 MANUAL_REVIEW_REQUIRED item, found %', p_job_id, v_mr_items_count;
  END IF;

  -- 7. Load and validate target item
  SELECT * INTO v_target_item
  FROM public.enhancement_queue_items
  WHERE id = p_target_item_id AND job_id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation target item % not found in job %', p_target_item_id, p_job_id;
  END IF;

  IF v_target_item.status <> 'MANUAL_REVIEW_REQUIRED' THEN
    RAISE EXCEPTION 'target item status is % (must be MANUAL_REVIEW_REQUIRED)', v_target_item.status;
  END IF;

  -- 8. Guard: active attempt UUID match
  IF v_target_item.active_attempt_uuid IS NULL OR v_target_item.active_attempt_uuid <> p_attempt_uuid THEN
    RAISE EXCEPTION 'ATTEMPT_UUID_MISMATCH: item active_attempt_uuid % does not match recovery attempt_uuid %',
      v_target_item.active_attempt_uuid, p_attempt_uuid;
  END IF;

  -- 9. Guard: attempt_phase must be post-fence (definitely sent to runtime)
  IF v_target_item.attempt_phase NOT IN ('EXECUTE_MAY_HAVE_BEEN_SENT', 'WAITING_RESULT', 'WAITING_SETTLEMENT') THEN
    RAISE EXCEPTION 'INVALID_ATTEMPT_PHASE: target item attempt_phase % is not a definitely-sent post-fence phase',
      v_target_item.attempt_phase;
  END IF;

  -- 10. Guard: authoritative result code must be NULL (no fabricated result code)
  IF v_target_item.last_result_code IS NOT NULL THEN
    RAISE EXCEPTION 'AUTHORITATIVE_RESULT_ALREADY_EXISTS: target item already has result code %',
      v_target_item.last_result_code;
  END IF;

  -- 11. Guard: settlement must be unsettled
  IF v_target_item.attempt_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ITEM_ALREADY_SETTLED: target item already has attempt_settled_at %',
      v_target_item.attempt_settled_at;
  END IF;

  IF v_target_item.settlement_source IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_SOURCE_CONFLICT: target item already has settlement_source %',
      v_target_item.settlement_source;
  END IF;

  -- 12. Guard: proven target level matches item target_level
  IF v_target_item.target_level <> p_proven_target_level THEN
    RAISE EXCEPTION 'TARGET_LEVEL_MISMATCH: proven target level % does not match item target_level %',
      p_proven_target_level, v_target_item.target_level;
  END IF;

  -- 13. Guard: all remaining items must be never attempted
  SELECT count(*) INTO v_invalid_remaining_count
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
    AND id <> p_target_item_id
    AND (
      status <> 'PENDING'
      OR active_attempt_uuid IS NOT NULL
      OR attempt_count > 0
      OR attempt_phase <> 'NONE'
      OR attempt_settled_at IS NOT NULL
      OR last_result_code IS NOT NULL
      OR actual_gold_spent > 0
      OR actual_gem_spent > 0
      OR actual_material_1_spent > 0
      OR actual_material_2_spent > 0
      OR actual_material_3_spent > 0
      OR actual_material_4_spent > 0
      OR actual_charm_spent > 0
    );

  IF v_invalid_remaining_count > 0 THEN
    RAISE EXCEPTION 'REMAINING_ITEM_EXECUTION_DETECTED: found % remaining items that have begun execution, have attempt history, or have spend',
      v_invalid_remaining_count;
  END IF;

  -- 14. Mutation 1: Settle Candidate A (state-reconciled success, preserve last_result_code NULL)
  UPDATE public.enhancement_queue_items
  SET status = 'COMPLETED',
      current_level = p_proven_target_level,
      settlement_source = 'STATE_RECONCILED',
      reconciled_at = now(),
      reconciliation_reason = p_reconciliation_reason,
      actual_gold_spent = p_actual_gold_spent,
      actual_gem_spent = p_actual_gem_spent,
      actual_material_1_spent = p_actual_material_1_spent,
      actual_material_2_spent = p_actual_material_2_spent,
      actual_material_3_spent = p_actual_material_3_spent,
      actual_material_4_spent = p_actual_material_4_spent,
      actual_charm_spent = p_actual_charm_spent,
      attempt_settled_at = now(),
      attempt_phase = 'SETTLED',
      finished_at = now(),
      updated_at = now()
  WHERE id = p_target_item_id;

  -- 15. Mutation 2: Cancel all remaining never-attempted items in the same transaction
  UPDATE public.enhancement_queue_items
  SET status = 'CANCELLED',
      finished_at = now(),
      updated_at = now()
  WHERE job_id = p_job_id
    AND id <> p_target_item_id;

  -- 16. Mutation 3: Terminalize the job to CANCELLED in the same transaction
  v_user_id := COALESCE(auth.uid(), v_job.user_id);

  UPDATE public.enhancement_queue_jobs
  SET status = 'CANCELLED',
      resolution_kind = 'RECONCILED_SUCCESS_CLOSE_REMAINDER',
      resolved_at = now(),
      resolved_by = v_user_id,
      resolution_note = p_resolution_note,
      completed_items = 1,
      finished_at = COALESCE(finished_at, now()),
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  -- Account exclusivity is atomically released because CANCELLED is outside
  -- idx_enhancement_queue_jobs_account_unresolved_exclusivity partial index.

  RETURN v_job;
END;
$$;

-- ── 3. Role Security & Grants ────────────────────────────────────────────────
-- Strictly enforce trusted evidence boundary:
-- Browser client (anon / authenticated) must not invoke directly.
-- Only service_role (server-side recovery agent) is authorized.

REVOKE ALL ON FUNCTION public.reconcile_enhancement_manual_review_and_close(
  uuid, uuid, uuid, integer, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_enhancement_manual_review_and_close(
  uuid, uuid, uuid, integer, bigint, bigint, bigint, bigint, bigint, bigint, bigint, text, text
) TO service_role;

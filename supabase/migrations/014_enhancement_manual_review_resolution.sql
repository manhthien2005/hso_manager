-- =============================================================================
-- Migration 014: Enhancement Queue Manual Review Administrative Resolution
-- Task: ENHANCE-05J-RESOLUTION-CONTRACT-CORRECTIVE
--
-- Features:
-- 1. Administrative resolution metadata columns on public.enhancement_queue_jobs:
--    - resolution_kind text: 'ABANDON_UNRESOLVED'
--    - resolved_at timestamptz
--    - resolved_by uuid REFERENCES auth.users(id)
--    - resolution_note text (max 500 chars)
--
-- 2. Transactional Canonical RPC public.resolve_enhancement_queue_manual_review:
--    - Locks target job row FOR UPDATE
--    - Enforces authenticated ownership
--    - Idempotent on repeated calls with ABANDON_UNRESOLVED
--    - Enforces current status is MANUAL_REVIEW_REQUIRED
--    - Late-state guards: verifies Candidate A remains MANUAL_REVIEW_REQUIRED,
--      unsettled, with no fabricated results
--    - Permanently transitions unattempted PENDING items (Candidate B) to CANCELLED
--    - Transitions job to terminal CANCELLED state with resolution metadata
--    - Atomically releases account exclusivity without mutating migration 013 index
-- =============================================================================

-- ── 1. Add Resolution Metadata Columns ───────────────────────────────────────

ALTER TABLE public.enhancement_queue_jobs
  ADD COLUMN IF NOT EXISTS resolution_kind text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enhancement_queue_jobs_resolution_kind_check'
  ) THEN
    ALTER TABLE public.enhancement_queue_jobs
      ADD CONSTRAINT enhancement_queue_jobs_resolution_kind_check
      CHECK (resolution_kind IS NULL OR resolution_kind IN ('ABANDON_UNRESOLVED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enhancement_queue_jobs_resolution_note_length_check'
  ) THEN
    ALTER TABLE public.enhancement_queue_jobs
      ADD CONSTRAINT enhancement_queue_jobs_resolution_note_length_check
      CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500);
  END IF;
END $$;

-- ── 2. Update Derived Summary View ──────────────────────────────────────────

CREATE OR REPLACE VIEW public.enhancement_queue_job_summaries
WITH (security_invoker = true)
AS
SELECT
  j.id,
  j.account_id,
  j.device_id,
  j.user_id,
  j.status,
  j.active_item_id,
  j.active_attempt_uuid,
  j.active_command_id,
  j.total_items,
  j.completed_items,
  j.claimed_by,
  j.claimed_at,
  j.claim_expires_at,
  j.pause_requested_at,
  j.cancel_requested_at,
  j.error_code,
  j.error_message,
  j.created_at,
  j.started_at,
  j.finished_at,
  j.updated_at,
  COALESCE(SUM(i.actual_gold_spent), 0)::bigint AS actual_gold_spent,
  COALESCE(SUM(i.actual_gem_spent), 0)::bigint AS actual_gem_spent,
  COALESCE(SUM(i.actual_material_1_spent), 0)::bigint AS actual_material_1_spent,
  COALESCE(SUM(i.actual_material_2_spent), 0)::bigint AS actual_material_2_spent,
  COALESCE(SUM(i.actual_material_3_spent), 0)::bigint AS actual_material_3_spent,
  COALESCE(SUM(i.actual_material_4_spent), 0)::bigint AS actual_material_4_spent,
  COALESCE(SUM(i.actual_charm_spent), 0)::bigint AS actual_charm_spent,
  COALESCE(SUM(i.attempt_count), 0)::integer AS total_attempt_count,
  j.resolution_kind,
  j.resolved_at,
  j.resolved_by,
  j.resolution_note
FROM public.enhancement_queue_jobs j
LEFT JOIN public.enhancement_queue_items i ON i.job_id = j.id
GROUP BY j.id;

REVOKE ALL ON TABLE public.enhancement_queue_job_summaries FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.enhancement_queue_job_summaries TO authenticated;

-- ── 3. Canonical RPC: resolve_enhancement_queue_manual_review ────────────────

CREATE OR REPLACE FUNCTION public.resolve_enhancement_queue_manual_review(
  p_job_id uuid,
  p_disposition text DEFAULT 'ABANDON_UNRESOLVED',
  p_note text DEFAULT NULL
)
RETURNS public.enhancement_queue_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.enhancement_queue_jobs%ROWTYPE;
  v_user_id uuid;
  v_running_items integer;
  v_settled_attempt_items integer;
  v_invalid_attempt_items integer;
BEGIN
  -- 1. Validate disposition
  IF p_disposition IS NULL OR p_disposition <> 'ABANDON_UNRESOLVED' THEN
    RAISE EXCEPTION 'unsupported or invalid disposition: % (only ABANDON_UNRESOLVED is supported)', p_disposition;
  END IF;

  -- 2. Validate note bounds (max 500 chars)
  IF p_note IS NOT NULL AND char_length(p_note) > 500 THEN
    RAISE EXCEPTION 'resolution note exceeds maximum length of 500 characters';
  END IF;

  -- 3. Lock target job row for update
  SELECT * INTO v_job
  FROM public.enhancement_queue_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enhancement queue job % not found', p_job_id;
  END IF;

  -- 4. Ownership verification if auth.uid() is available
  IF auth.uid() IS NOT NULL AND v_job.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'enhancement queue job % not owned by caller', p_job_id;
  END IF;

  -- 5. Idempotency check:
  -- If already resolved with ABANDON_UNRESOLVED and CANCELLED, return existing record
  IF v_job.status = 'CANCELLED' AND v_job.resolution_kind = 'ABANDON_UNRESOLVED' THEN
    RETURN v_job;
  END IF;

  -- 6. Require job status to currently be MANUAL_REVIEW_REQUIRED
  IF v_job.status <> 'MANUAL_REVIEW_REQUIRED' THEN
    RAISE EXCEPTION 'job % cannot be resolved: current status is % (must be MANUAL_REVIEW_REQUIRED)', p_job_id, v_job.status;
  END IF;

  -- 7. Late State Change Guards & Item Audits:
  -- Guard 7a: Require no currently RUNNING item
  SELECT count(*) INTO v_running_items
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id AND status = 'RUNNING';

  IF v_running_items > 0 THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_STATE_CHANGED: queue has running items';
  END IF;

  -- Guard 7b: Unresolved attempted item check (Candidate A)
  -- Any attempted item (active_attempt_uuid IS NOT NULL or attempt_count > 0)
  -- MUST have status = 'MANUAL_REVIEW_REQUIRED'
  SELECT count(*) INTO v_invalid_attempt_items
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
    AND (active_attempt_uuid IS NOT NULL OR attempt_count > 0)
    AND status <> 'MANUAL_REVIEW_REQUIRED';

  IF v_invalid_attempt_items > 0 THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_STATE_CHANGED: attempted item is no longer in MANUAL_REVIEW_REQUIRED status';
  END IF;

  -- Guard 7c: Attempted item must NOT have gained authoritative settlement or result
  SELECT count(*) INTO v_settled_attempt_items
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
    AND status = 'MANUAL_REVIEW_REQUIRED'
    AND (attempt_settled_at IS NOT NULL OR last_result_code IS NOT NULL);

  IF v_settled_attempt_items > 0 THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_STATE_CHANGED: attempted item has gained authoritative settlement or result';
  END IF;

  -- Guard 7d: Unattempted items (Candidate B, etc.) must NOT have attempt history
  -- Items in PENDING must have attempt_count = 0 and active_attempt_uuid IS NULL
  SELECT count(*) INTO v_invalid_attempt_items
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
    AND status = 'PENDING'
    AND (attempt_count > 0 OR active_attempt_uuid IS NOT NULL);

  IF v_invalid_attempt_items > 0 THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_STATE_CHANGED: unattempted item unexpectedly has attempt history';
  END IF;

  -- 8. Mutation: Permanently transition unattempted PENDING items to CANCELLED
  UPDATE public.enhancement_queue_items
  SET status = 'CANCELLED',
      updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'PENDING';

  -- 9. Mutation: Terminalize the job to CANCELLED with resolution metadata
  -- Original attempt UUID, error_code, error_message, etc. are NOT overwritten
  v_user_id := COALESCE(auth.uid(), v_job.user_id);

  UPDATE public.enhancement_queue_jobs
  SET status = 'CANCELLED',
      resolution_kind = 'ABANDON_UNRESOLVED',
      resolved_at = now(),
      resolved_by = v_user_id,
      resolution_note = p_note,
      finished_at = COALESCE(finished_at, now()),
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  -- Exclusivity is atomically released because 'CANCELLED' is outside
  -- idx_enhancement_queue_jobs_account_unresolved_exclusivity partial index.

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_enhancement_queue_manual_review(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_enhancement_queue_manual_review(uuid, text, text) TO authenticated;

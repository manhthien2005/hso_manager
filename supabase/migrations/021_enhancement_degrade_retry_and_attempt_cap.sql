-- =============================================================================
-- Migration 021: Support Enhancement Degradation Retry and Configurable Attempt Cap
-- Task: ENHANCE-06H5-DEGRADE-RETRY-AND-ATTEMPT-CAP-CORRECTIVE
--
-- Features:
-- 1. Schema enhancement for public.enhancement_queue_items:
--    - Adds max_attempts integer NOT NULL DEFAULT 10
--    - Enforces CHECK constraint: max_attempts >= 1 AND max_attempts <= 100
--    - Guarantees backward compatibility for existing records defaulting to 10.
--
-- 2. Hardened publish_enhancement_queue_job RPC:
--    - Supersedes migration 020 publish_enhancement_queue_job.
--    - Preserves all fail-closed gates: caller auth, DRAFT state lock, non-empty items,
--      account exclusivity, online device, and 5-minute heartbeat freshness.
--    - Enforces max_attempts bounds on all queue items: (max_attempts BETWEEN 1 AND 100).
--    - Every enhancement queue publication strictly requires authoritative device capability
--      token 'enhancement-degrade-retry-v1' (in addition to 'enhancement-queue-v2').
--    - Multi-level enhancement (target_level > initial_level + 1) additionally requires
--      token 'enhancement-multilevel-v1'.
--    - Fails closed on older runtimes (e.g. f205947 or earlier) that do not support
--      the retry-through-degradation contract.
-- =============================================================================

-- ── 1. Add max_attempts column with bounds check ──────────────────────────────

ALTER TABLE public.enhancement_queue_items
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'enhancement_queue_items_max_attempts_check'
  ) THEN
    ALTER TABLE public.enhancement_queue_items
      ADD CONSTRAINT enhancement_queue_items_max_attempts_check
      CHECK (max_attempts >= 1 AND max_attempts <= 100);
  END IF;
END $$;

-- ── 2. Hardened publish_enhancement_queue_job RPC (v2 + degrade-retry gate) ────

CREATE OR REPLACE FUNCTION public.publish_enhancement_queue_job(p_job_id uuid)
RETURNS public.enhancement_queue_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.enhancement_queue_jobs%ROWTYPE;
  v_item_count integer;
  v_invalid_cap_count integer;
  v_has_multilevel boolean;
  v_device record;
  v_agent_version text;
  v_now timestamptz := now();
  v_freshness_threshold interval := interval '5 minutes';
  v_build_meta text;
  v_has_queue_v2_token boolean := false;
  v_has_multilevel_token boolean := false;
  v_has_degrade_retry_token boolean := false;
  v_token text;
BEGIN
  -- 1. Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 2. Lock target job for update
  SELECT * INTO v_job
  FROM public.enhancement_queue_jobs
  WHERE id = p_job_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enhancement queue job % not found or not owned by caller', p_job_id;
  END IF;

  IF v_job.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'job % cannot be published: current status is % (must be DRAFT)', p_job_id, v_job.status;
  END IF;

  -- 3. Validate items exist
  SELECT count(*) INTO v_item_count
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job % with 0 items', p_job_id;
  END IF;

  -- 3b. Validate max_attempts bounds on items
  SELECT count(*) INTO v_invalid_cap_count
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
    AND (max_attempts IS NULL OR max_attempts < 1 OR max_attempts > 100);

  IF v_invalid_cap_count > 0 THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: found % items with max_attempts out of bounds (1..100)',
      p_job_id, v_invalid_cap_count;
  END IF;

  -- 4. Check for active/unresolved queue exclusivity
  IF EXISTS (
    SELECT 1 FROM public.enhancement_queue_jobs
    WHERE account_id = v_job.account_id
      AND id <> p_job_id
      AND status IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'MANUAL_REVIEW_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'account % already has an active or unresolved enhancement queue', v_job.account_id;
  END IF;

  -- 5. Authoritative device capability and freshness gating (Migration 021)
  SELECT d.id, d.agent_version, d.last_seen, d.status
  INTO v_device
  FROM public.accounts a
  JOIN public.devices d ON d.id = a.device_id
  WHERE a.id = v_job.account_id;

  IF NOT FOUND OR v_device.id IS NULL THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: target device not found for account %',
      p_job_id, v_job.account_id;
  END IF;

  -- Require device to be strictly online
  IF v_device.status IS NULL OR v_device.status <> 'online' THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % is not online (status: %)',
      p_job_id, v_device.id, COALESCE(v_device.status, 'null');
  END IF;

  -- Require fresh heartbeat (within 5 minutes)
  IF v_device.last_seen IS NULL THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % has never reported a heartbeat',
      p_job_id, v_device.id;
  END IF;

  IF v_device.last_seen < (v_now - v_freshness_threshold) OR v_device.last_seen > (v_now + interval '1 minute') THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % heartbeat is stale (last_seen: %)',
      p_job_id, v_device.id, v_device.last_seen;
  END IF;

  -- Validate agent_version build metadata
  v_agent_version := trim(COALESCE(v_device.agent_version, ''));
  IF v_agent_version = '' OR lower(v_agent_version) = 'unknown' THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % agent_version is missing or unknown',
      p_job_id, v_device.id;
  END IF;

  -- Parse build metadata after the single '+'
  IF position('+' in v_agent_version) = 0 THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % agent_version % lacks build metadata',
      p_job_id, v_device.id, v_agent_version;
  END IF;

  -- Ensure only one '+'
  IF length(v_agent_version) - length(replace(v_agent_version, '+', '')) <> 1 THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % agent_version % has malformed metadata',
      p_job_id, v_device.id, v_agent_version;
  END IF;

  v_build_meta := split_part(v_agent_version, '+', 2);
  FOREACH v_token IN ARRAY string_to_array(v_build_meta, '.') LOOP
    IF trim(v_token) = 'enhancement-queue-v2' THEN
      v_has_queue_v2_token := true;
    ELSIF trim(v_token) = 'enhancement-multilevel-v1' THEN
      v_has_multilevel_token := true;
    ELSIF trim(v_token) = 'enhancement-degrade-retry-v1' THEN
      v_has_degrade_retry_token := true;
    END IF;
  END LOOP;

  -- ALL enhancement queues require enhancement-queue-v2 capability
  IF NOT v_has_queue_v2_token THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % lacks capability enhancement-queue-v2',
      p_job_id, v_device.id;
  END IF;

  -- ALL new enhancement queues require enhancement-degrade-retry-v1 capability (ENHANCE-06H5)
  IF NOT v_has_degrade_retry_token THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % lacks capability enhancement-degrade-retry-v1',
      p_job_id, v_device.id;
  END IF;

  -- Multi-level enhancement (target_level > initial_level + 1) additionally requires enhancement-multilevel-v1
  SELECT EXISTS (
    SELECT 1 FROM public.enhancement_queue_items
    WHERE job_id = p_job_id
      AND target_level > initial_level + 1
  ) INTO v_has_multilevel;

  IF v_has_multilevel AND NOT v_has_multilevel_token THEN
    RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % lacks capability enhancement-multilevel-v1',
      p_job_id, v_device.id;
  END IF;

  -- 6. Atomically transition to QUEUED
  UPDATE public.enhancement_queue_jobs
  SET status = 'QUEUED',
      total_items = v_item_count,
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_enhancement_queue_job(uuid) TO authenticated;

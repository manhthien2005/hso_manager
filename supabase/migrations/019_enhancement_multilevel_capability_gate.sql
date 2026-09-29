-- =============================================================================
-- Migration 019: Multi-Level Capability Gating for Queue Publication
-- Task: ENHANCE-06F2-MULTI-LEVEL-CAPABILITY-GATE-CORRECTIVE
--
-- Features:
-- 1. Hardened publish_enhancement_queue_job RPC:
--    - Preserves all existing migration 013-018 publication guards.
--    - Single-level enhancement (target_level <= initial_level + 1) preserves
--      full backward compatibility under enhancement-queue-v1.
--    - Multi-level enhancement (target_level > initial_level + 1) enforces
--      fail-closed capability gating against trusted public.devices records:
--        * Target device must exist and be bound to the account.
--        * Device must be strictly online (status = 'online').
--        * Device heartbeat must be fresh within 5 minutes (last_seen).
--        * Device agent_version build metadata must advertise exact token
--          'enhancement-multilevel-v1' proving 06F Rust continuation contract.
--    - Never trusts caller-supplied capability parameters.
--    - Preserves atomic DRAFT -> QUEUED state transition and account exclusivity.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.publish_enhancement_queue_job(p_job_id uuid)
RETURNS public.enhancement_queue_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.enhancement_queue_jobs%ROWTYPE;
  v_item_count integer;
  v_has_multilevel boolean;
  v_device record;
  v_agent_version text;
  v_now timestamptz := now();
  v_freshness_threshold interval := interval '5 minutes';
  v_build_meta text;
  v_has_multilevel_token boolean := false;
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

  -- 4. Check for active/unresolved queue exclusivity
  IF EXISTS (
    SELECT 1 FROM public.enhancement_queue_jobs
    WHERE account_id = v_job.account_id
      AND id <> p_job_id
      AND status IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'MANUAL_REVIEW_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'account % already has an active or unresolved enhancement queue', v_job.account_id;
  END IF;

  -- 5. Multi-level capability & freshness gating (ENHANCE-06F2 / Migration 019)
  -- Detect whether any item requires multi-level continuation (target_level > initial_level + 1)
  SELECT EXISTS (
    SELECT 1 FROM public.enhancement_queue_items
    WHERE job_id = p_job_id
      AND target_level > initial_level + 1
  ) INTO v_has_multilevel;

  IF v_has_multilevel THEN
    -- Derive target device strictly from trusted account binding (never trust caller input)
    SELECT d.id, d.agent_version, d.last_seen, d.status
    INTO v_device
    FROM public.accounts a
    JOIN public.devices d ON d.id = a.device_id
    WHERE a.id = v_job.account_id;

    IF NOT FOUND OR v_device.id IS NULL THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: target device not found for account %',
        p_job_id, v_job.account_id;
    END IF;

    -- Require device to be strictly online
    IF v_device.status IS NULL OR v_device.status <> 'online' THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % is not online (status: %)',
        p_job_id, v_device.id, COALESCE(v_device.status, 'null');
    END IF;

    -- Require fresh heartbeat (within 5 minutes)
    IF v_device.last_seen IS NULL THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % has never reported a heartbeat',
        p_job_id, v_device.id;
    END IF;

    IF v_device.last_seen < (v_now - v_freshness_threshold) OR v_device.last_seen > (v_now + interval '1 minute') THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % heartbeat is stale (last_seen: %)',
        p_job_id, v_device.id, v_device.last_seen;
    END IF;

    -- Validate agent_version build metadata contains exact token 'enhancement-multilevel-v1'
    v_agent_version := trim(COALESCE(v_device.agent_version, ''));
    IF v_agent_version = '' OR lower(v_agent_version) = 'unknown' THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % agent_version is missing or unknown',
        p_job_id, v_device.id;
    END IF;

    -- Parse build metadata after the single '+'
    IF position('+' in v_agent_version) = 0 THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % agent_version % lacks build metadata',
        p_job_id, v_device.id, v_agent_version;
    END IF;

    -- Ensure only one '+'
    IF length(v_agent_version) - length(replace(v_agent_version, '+', '')) <> 1 THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % agent_version % has malformed metadata',
        p_job_id, v_device.id, v_agent_version;
    END IF;

    v_build_meta := split_part(v_agent_version, '+', 2);
    FOREACH v_token IN ARRAY string_to_array(v_build_meta, '.') LOOP
      IF trim(v_token) = 'enhancement-multilevel-v1' THEN
        v_has_multilevel_token := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_has_multilevel_token THEN
      RAISE EXCEPTION 'cannot publish multi-level enhancement queue job %: device % lacks capability enhancement-multilevel-v1',
        p_job_id, v_device.id;
    END IF;
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

-- =============================================================================
-- Migration 020: Enhancement Queue v2 Lifecycle, Safe Ledger & Capability Contract
-- Task: ENHANCE-06H-ATTEMPT-LEDGER-RLS-LIFECYCLE-AND-FRESHNESS-CORRECTIVE
--
-- Features:
-- 1. Device-Authenticated Mutation Contract for enhancement_queue_item_attempts:
--    - Grants restricted INSERT and UPDATE privileges to authenticated (never ALL, never DELETE).
--    - Strict RLS policies ensuring the calling device JWT owns the target account/device/job/item.
--    - Trigger public.enhancement_queue_item_attempts_before_write hardening:
--        * Strict device-account ownership validation on write.
--        * Monotonic sequential attempt_number validation (attempt_number = max + 1).
--        * Immutable identity columns (attempt_uuid, item_id, job_id, account_id, user_id,
--          attempt_number, expected_level, step_target_level, queue_item_final_target_level).
--        * Monotonic attempt_phase progression (no phase regression).
--        * Permanently immutable terminal settled attempt rows (cannot be rewritten or reopened).
--        * Exactly-once settlement validation with fail-closed rejection on conflict.
--
-- 2. Hardened publish_enhancement_queue_job RPC:
--    - Supersedes migration 019 publish_enhancement_queue_job without modifying 019 in place.
--    - Every enhancement queue publication strictly requires authoritative device capability
--      token 'enhancement-queue-v2' and fresh heartbeat within 5 minutes.
--    - Multi-level enhancement (target_level > initial_level + 1) additionally requires
--      token 'enhancement-multilevel-v1'.
--    - Prevents rollback to defective agents (7d532 or earlier) from publishing new queues.
--
-- 3. Administrative Pre-Fence Recovery RPC:
--    - public.admin_recover_stranded_prefence_job(p_job_id uuid):
--        * Narrowly-scoped service_role recovery RPC for stranded pre-fence jobs.
--        * Requires: cancel_requested_at present, zero mutation fence, zero spend,
--          no post-fence attempt rows, and eligible pre-fence phase.
--        * Atomically cancels item/job and releases account exclusivity without game mutation.
--        * Never fabricates result_code, settlement_source, or spend.
-- =============================================================================

-- ── 1. Update RLS & Grants for enhancement_queue_item_attempts ────────────────

-- Minimum required grants: INSERT and UPDATE only (strictly NO DELETE, NO ALL)
GRANT INSERT, UPDATE ON TABLE public.enhancement_queue_item_attempts TO authenticated;

-- RLS Insert Policy: Authenticated device must own the account bound to this queue item
DROP POLICY IF EXISTS device_enhancement_queue_item_attempts_insert ON public.enhancement_queue_item_attempts;
CREATE POLICY device_enhancement_queue_item_attempts_insert ON public.enhancement_queue_item_attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.accounts a
      JOIN public.devices d ON d.id = a.device_id
      JOIN public.enhancement_queue_items i ON i.id = enhancement_queue_item_attempts.item_id AND i.account_id = a.id
      JOIN public.enhancement_queue_jobs j ON j.id = i.job_id AND j.account_id = a.id
      WHERE a.id = enhancement_queue_item_attempts.account_id
        AND d.device_auth_id = auth.uid()
        AND j.status = 'RUNNING'
    )
  );

-- RLS Update Policy: Authenticated device must own the account bound to this attempt
DROP POLICY IF EXISTS device_enhancement_queue_item_attempts_update ON public.enhancement_queue_item_attempts;
CREATE POLICY device_enhancement_queue_item_attempts_update ON public.enhancement_queue_item_attempts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.accounts a
      JOIN public.devices d ON d.id = a.device_id
      WHERE a.id = enhancement_queue_item_attempts.account_id
        AND d.device_auth_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.accounts a
      JOIN public.devices d ON d.id = a.device_id
      WHERE a.id = enhancement_queue_item_attempts.account_id
        AND d.device_auth_id = auth.uid()
    )
  );

-- ── 2. Hardened Trigger: public.enhancement_queue_item_attempts_before_write ───

CREATE OR REPLACE FUNCTION public.enhancement_queue_item_attempts_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_expected_attempt_number integer;
  v_old_rank integer;
  v_new_rank integer;

BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 1. Verify parent item exists and inherit trusted bindings
    SELECT job_id, account_id, user_id, target_level, status INTO v_item
    FROM public.enhancement_queue_items
    WHERE id = NEW.item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent enhancement queue item % does not exist', NEW.item_id;
    END IF;

    -- Device authentication validation: if caller is authenticated role,
    -- verify caller device owns the account through trusted database relations.
    IF auth.role() = 'authenticated' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.devices d ON d.id = a.device_id
        WHERE a.id = v_item.account_id
          AND d.device_auth_id = auth.uid()
      ) THEN
        RAISE EXCEPTION 'Device % is not authorized to create attempt ledger for account %',
          auth.uid(), v_item.account_id;
      END IF;
    END IF;

    -- Canonical parent bindings
    IF NEW.job_id IS NULL THEN
      NEW.job_id := v_item.job_id;
    ELSIF NEW.job_id <> v_item.job_id THEN
      RAISE EXCEPTION 'job_id % does not match parent item job %', NEW.job_id, v_item.job_id;
    END IF;

    IF NEW.account_id IS NULL THEN
      NEW.account_id := v_item.account_id;
    ELSIF NEW.account_id <> v_item.account_id THEN
      RAISE EXCEPTION 'account_id % does not match parent item account %', NEW.account_id, v_item.account_id;
    END IF;

    IF NEW.user_id IS NULL THEN
      NEW.user_id := v_item.user_id;
    ELSIF NEW.user_id <> v_item.user_id THEN
      RAISE EXCEPTION 'user_id % does not match parent item user %', NEW.user_id, v_item.user_id;
    END IF;

    IF NEW.queue_item_final_target_level IS NULL THEN
      NEW.queue_item_final_target_level := v_item.target_level;
    ELSIF NEW.queue_item_final_target_level <> v_item.target_level THEN
      RAISE EXCEPTION 'queue_item_final_target_level % does not match parent item target_level %',
        NEW.queue_item_final_target_level, v_item.target_level;
    END IF;

    -- 2. Monotonic sequence validation
    SELECT COALESCE(max(attempt_number), 0) + 1 INTO v_expected_attempt_number
    FROM public.enhancement_queue_item_attempts
    WHERE item_id = NEW.item_id;

    IF NEW.attempt_number <> v_expected_attempt_number THEN
      RAISE EXCEPTION 'Invalid attempt_number % for item %: expected %',
        NEW.attempt_number, NEW.item_id, v_expected_attempt_number;
    END IF;

    -- 3. Initial phase check: must start in NONE or PREPARING
    IF NEW.attempt_phase NOT IN ('NONE', 'PREPARING') THEN
      RAISE EXCEPTION 'New attempt % must start in NONE or PREPARING phase (got %)',
        NEW.attempt_uuid, NEW.attempt_phase;
    END IF;

    -- 4. Initial spend must be zero at creation
    NEW.actual_gold_spent := 0;
    NEW.actual_gem_spent := 0;
    NEW.actual_material_1_spent := 0;
    NEW.actual_material_2_spent := 0;
    NEW.actual_material_3_spent := 0;
    NEW.actual_material_4_spent := 0;
    NEW.actual_charm_spent := 0;

    -- 5. Timestamps and settlement invariants
    NEW.execute_may_have_been_sent_at := NULL;
    NEW.result_received_at := NULL;
    NEW.attempt_settled_at := NULL;
    NEW.result_code := NULL;
    NEW.settlement_source := NULL;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Device authentication validation on update
    IF auth.role() = 'authenticated' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.accounts a
        JOIN public.devices d ON d.id = a.device_id
        WHERE a.id = OLD.account_id
          AND d.device_auth_id = auth.uid()
      ) THEN
        RAISE EXCEPTION 'Device % is not authorized to update attempt ledger for account %',
          auth.uid(), OLD.account_id;
      END IF;
    END IF;

    -- Immutable identity & binding columns:
    IF NEW.attempt_uuid <> OLD.attempt_uuid THEN
      RAISE EXCEPTION 'attempt_uuid is immutable';
    END IF;
    IF NEW.item_id <> OLD.item_id THEN
      RAISE EXCEPTION 'item_id is immutable';
    END IF;
    IF NEW.job_id <> OLD.job_id THEN
      RAISE EXCEPTION 'job_id is immutable';
    END IF;
    IF NEW.account_id <> OLD.account_id THEN
      RAISE EXCEPTION 'account_id is immutable';
    END IF;
    IF NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'user_id is immutable';
    END IF;
    IF NEW.attempt_number <> OLD.attempt_number THEN
      RAISE EXCEPTION 'attempt_number is immutable';
    END IF;
    IF NEW.expected_level <> OLD.expected_level THEN
      RAISE EXCEPTION 'expected_level is immutable';
    END IF;
    IF NEW.step_target_level <> OLD.step_target_level THEN
      RAISE EXCEPTION 'step_target_level is immutable';
    END IF;
    IF NEW.queue_item_final_target_level <> OLD.queue_item_final_target_level THEN
      RAISE EXCEPTION 'queue_item_final_target_level is immutable';
    END IF;

    -- Permanently settled attempt guard:
    -- Once an attempt reaches SETTLED, its terminal outcomes cannot be modified or reopened.
    IF OLD.attempt_phase = 'SETTLED' THEN
      IF NEW.attempt_phase <> 'SETTLED'
         OR NEW.actual_gold_spent <> OLD.actual_gold_spent
         OR NEW.actual_gem_spent <> OLD.actual_gem_spent
         OR NEW.actual_material_1_spent <> OLD.actual_material_1_spent
         OR NEW.actual_material_2_spent <> OLD.actual_material_2_spent
         OR NEW.actual_material_3_spent <> OLD.actual_material_3_spent
         OR NEW.actual_material_4_spent <> OLD.actual_material_4_spent
         OR NEW.actual_charm_spent <> OLD.actual_charm_spent
         OR COALESCE(NEW.result_code, '') <> COALESCE(OLD.result_code, '')
         OR COALESCE(NEW.settlement_source, '') <> COALESCE(OLD.settlement_source, '')
         OR NEW.attempt_settled_at <> OLD.attempt_settled_at
      THEN
        RAISE EXCEPTION 'Settled attempt % is permanently immutable and cannot be rewritten or reopened', OLD.attempt_uuid;
      END IF;
    END IF;

    -- Monotonic attempt phase transitions:
    -- NONE (0), PREPARING (1), READY_TO_EXECUTE (2), EXECUTE_MAY_HAVE_BEEN_SENT (3),
    -- WAITING_RESULT (4), WAITING_SETTLEMENT (5), SETTLED (6)
    v_old_rank := CASE OLD.attempt_phase
      WHEN 'NONE' THEN 0
      WHEN 'PREPARING' THEN 1
      WHEN 'READY_TO_EXECUTE' THEN 2
      WHEN 'EXECUTE_MAY_HAVE_BEEN_SENT' THEN 3
      WHEN 'WAITING_RESULT' THEN 4
      WHEN 'WAITING_SETTLEMENT' THEN 5
      WHEN 'SETTLED' THEN 6
      ELSE -1
    END;

    v_new_rank := CASE NEW.attempt_phase
      WHEN 'NONE' THEN 0
      WHEN 'PREPARING' THEN 1
      WHEN 'READY_TO_EXECUTE' THEN 2
      WHEN 'EXECUTE_MAY_HAVE_BEEN_SENT' THEN 3
      WHEN 'WAITING_RESULT' THEN 4
      WHEN 'WAITING_SETTLEMENT' THEN 5
      WHEN 'SETTLED' THEN 6
      ELSE -1
    END;

    IF v_new_rank < v_old_rank THEN
      RAISE EXCEPTION 'Monotonic phase violation: cannot transition attempt % from % to %',
        OLD.attempt_uuid, OLD.attempt_phase, NEW.attempt_phase;
    END IF;

    -- Exactly-once settlement validation
    IF NEW.attempt_phase = 'SETTLED' THEN
      IF NEW.settlement_source IS NULL OR NEW.settlement_source NOT IN ('RESULT_CODE', 'STATE_RECONCILED') THEN
        RAISE EXCEPTION 'Settled attempt % must declare settlement_source as RESULT_CODE or STATE_RECONCILED',
          NEW.attempt_uuid;
      END IF;

      IF NEW.attempt_settled_at IS NULL THEN
        NEW.attempt_settled_at := now();
      END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enhancement_queue_item_attempts_before_write ON public.enhancement_queue_item_attempts;
CREATE TRIGGER trg_enhancement_queue_item_attempts_before_write
  BEFORE INSERT OR UPDATE ON public.enhancement_queue_item_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.enhancement_queue_item_attempts_before_write();

-- ── 3. Hardened publish_enhancement_queue_job RPC (v2 gate) ───────────────────

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
  v_has_queue_v2_token boolean := false;
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

  -- 5. Authoritative device capability and freshness gating (Migration 020)
  -- Derive target device strictly from trusted account binding (never trust caller input)
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
    END IF;
  END LOOP;

  -- ALL enhancement queues require enhancement-queue-v2 capability
  IF NOT v_has_queue_v2_token THEN
    RAISE EXCEPTION 'cannot publish enhancement queue job %: device % lacks capability enhancement-queue-v2',
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

-- ── 4. Administrative Pre-Fence Recovery RPC ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_recover_stranded_prefence_job(p_job_id uuid)
RETURNS public.enhancement_queue_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.enhancement_queue_jobs%ROWTYPE;
  v_fenced_items integer;
  v_postfence_attempts integer;
  v_total_spend bigint;
  v_now timestamptz := now();
BEGIN
  -- 1. Lock target job for update
  SELECT * INTO v_job
  FROM public.enhancement_queue_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enhancement queue job % not found', p_job_id;
  END IF;

  -- 2. Validate prerequisites for safe pre-fence recovery
  IF v_job.cancel_requested_at IS NULL THEN
    RAISE EXCEPTION 'cannot recover job %: cancel_requested_at is not present', p_job_id;
  END IF;

  IF v_job.status NOT IN ('RUNNING', 'PAUSING', 'PAUSED') THEN
    RAISE EXCEPTION 'cannot recover job %: current status is % (must be RUNNING, PAUSING, or PAUSED)',
      p_job_id, v_job.status;
  END IF;

  -- 3. Verify zero mutation fence across all items
  SELECT count(*) INTO v_fenced_items
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id
    AND (
      execute_may_have_been_sent_at IS NOT NULL
      OR attempt_phase NOT IN ('NONE', 'PREPARING')
    );

  IF v_fenced_items > 0 THEN
    RAISE EXCEPTION 'cannot recover job %: % item(s) have committed mutation fence or post-fence phase',
      p_job_id, v_fenced_items;
  END IF;

  -- 4. Verify zero post-fence or settled attempt ledger rows
  SELECT count(*) INTO v_postfence_attempts
  FROM public.enhancement_queue_item_attempts
  WHERE job_id = p_job_id
    AND (
      attempt_phase NOT IN ('NONE', 'PREPARING')
      OR execute_may_have_been_sent_at IS NOT NULL
    );

  IF v_postfence_attempts > 0 THEN
    RAISE EXCEPTION 'cannot recover job %: % attempt ledger row(s) are post-fence',
      p_job_id, v_postfence_attempts;
  END IF;

  -- 5. Verify zero spend across all items
  SELECT COALESCE(SUM(actual_gold_spent + actual_gem_spent + actual_material_1_spent +
                      actual_material_2_spent + actual_material_3_spent + actual_material_4_spent +
                      actual_charm_spent), 0) INTO v_total_spend
  FROM public.enhancement_queue_items
  WHERE job_id = p_job_id;

  IF v_total_spend > 0 THEN
    RAISE EXCEPTION 'cannot recover job %: non-zero spend detected (% spend)', p_job_id, v_total_spend;
  END IF;

  -- 6. Atomically cancel items and job, releasing exclusivity
  UPDATE public.enhancement_queue_items
  SET status = 'CANCELLED',
      finished_at = v_now,
      updated_at = v_now
  WHERE job_id = p_job_id
    AND status IN ('PENDING', 'RUNNING');

  UPDATE public.enhancement_queue_jobs
  SET status = 'CANCELLED',
      finished_at = v_now,
      cancel_requested_at = NULL,
      updated_at = v_now
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

-- Restrict administrative recovery RPC to service_role only
REVOKE ALL ON FUNCTION public.admin_recover_stranded_prefence_job(uuid) FROM anon, PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recover_stranded_prefence_job(uuid) TO service_role;

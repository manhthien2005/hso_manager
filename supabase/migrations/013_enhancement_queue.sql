-- =============================================================================
-- Migration 013: Enhancement Queue Schema Contract (ENHANCE-05A)
--
-- Features:
-- 1. public.enhancement_queue_jobs:
--    - Durable queue jobs table for Enhancement Queue v1.
--    - Bound canonically to accounts(id), devices(id), and auth.users(id).
--    - Lifecycle states: DRAFT, QUEUED, RUNNING, PAUSING, PAUSED, COMPLETED,
--      FAILED, CANCELLED, MANUAL_REVIEW_REQUIRED.
--    - DRAFT ensures partially created jobs are never executed.
--    - Atomic agent claiming support via claimed_by, claimed_at, claim_expires_at.
--    - Cooperative pause/cancel request tracking (pause_requested_at, cancel_requested_at).
--    - Database-enforced unresolved queue exclusivity per account via partial unique index:
--      Only one job per account in ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'MANUAL_REVIEW_REQUIRED').
--
-- 2. public.enhancement_queue_items:
--    - Ordered queue items with deterministic unique queue_order per job (1-based).
--    - Target level > initial level constraint (valid ranges: initial 0..14, target 1..15).
--    - Constrained payment_type ('GOLD', 'GEMS') and charm_mode allowlist.
--    - Restart-safe durable attempt phases:
--      'NONE', 'PREPARING', 'READY_TO_EXECUTE', 'EXECUTE_MAY_HAVE_BEEN_SENT',
--      'WAITING_RESULT', 'WAITING_SETTLEMENT', 'SETTLED'.
--    - Explicit execute_may_have_been_sent_at and active_attempt_uuid per attempt.
--    - Authoritative item-level actual spend storage (gold, gem, materials 1..4, charm).
--    - Non-negative constraints on spend, attempt count, and levels.
--
-- 3. public.enhancement_queue_job_summaries:
--    - Security-invoker derived view providing authoritative job-level spend aggregation
--      without double-count risk or second-source-of-truth drift.
--
-- 4. public.publish_enhancement_queue_job:
--    - Atomic publish RPC transitioning complete DRAFT jobs to QUEUED.
--
-- 5. Row Level Security & Grants:
--    - RLS enabled on jobs and items.
--    - Strict policies for owner (user_id = auth.uid()) and agent (via device_auth_id).
--    - Prevents cross-user job and item access.
-- =============================================================================

-- ── 1. Table public.enhancement_queue_jobs ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enhancement_queue_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  device_id           uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'DRAFT',
  active_item_id      uuid, -- Foreign key constraint added after enhancement_queue_items table creation
  active_attempt_uuid uuid,
  active_command_id   uuid REFERENCES public.commands(id) ON DELETE SET NULL,
  total_items         integer NOT NULL DEFAULT 0,
  completed_items     integer NOT NULL DEFAULT 0,
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  pause_requested_at  timestamptz,
  cancel_requested_at timestamptz,
  error_code          text,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT enhancement_queue_jobs_status_check CHECK (
    status IN (
      'DRAFT',
      'QUEUED',
      'RUNNING',
      'PAUSING',
      'PAUSED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'MANUAL_REVIEW_REQUIRED'
    )
  ),
  CONSTRAINT enhancement_queue_jobs_total_items_non_negative CHECK (total_items >= 0),
  CONSTRAINT enhancement_queue_jobs_completed_items_non_negative CHECK (completed_items >= 0)
);

-- ── 2. Table public.enhancement_queue_items ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enhancement_queue_items (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                        uuid NOT NULL REFERENCES public.enhancement_queue_jobs(id) ON DELETE CASCADE,
  account_id                    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id                       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  queue_order                   integer NOT NULL,
  captured_slot                 integer NOT NULL,
  template_id                   integer NOT NULL,
  category                      integer NOT NULL,
  base_name                     text NOT NULL,
  tier                          integer NOT NULL,
  icon                          integer,
  initial_level                 integer NOT NULL,
  current_level                 integer NOT NULL,
  target_level                  integer NOT NULL,
  payment_type                  text NOT NULL,
  charm_mode                    text NOT NULL DEFAULT 'NONE',
  status                        text NOT NULL DEFAULT 'PENDING',
  attempt_count                 integer NOT NULL DEFAULT 0,

  -- Durable attempt phase tracking for crash safety & restart recovery
  active_attempt_uuid           uuid,
  attempt_phase                 text NOT NULL DEFAULT 'NONE',
  attempt_expected_level        integer,
  attempt_target_level          integer,
  attempt_started_at            timestamptz,
  execute_may_have_been_sent_at timestamptz,
  attempt_settled_at            timestamptz,
  last_result_code              text,

  -- Authoritative item-level actual spend (only written on settled real attempts)
  actual_gold_spent             bigint NOT NULL DEFAULT 0,
  actual_gem_spent              bigint NOT NULL DEFAULT 0,
  actual_material_1_spent       bigint NOT NULL DEFAULT 0,
  actual_material_2_spent       bigint NOT NULL DEFAULT 0,
  actual_material_3_spent       bigint NOT NULL DEFAULT 0,
  actual_material_4_spent       bigint NOT NULL DEFAULT 0,
  actual_charm_spent            bigint NOT NULL DEFAULT 0,

  error_code                    text,
  error_message                 text,
  started_at                    timestamptz,
  finished_at                   timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- Structural constraints
  CONSTRAINT enhancement_queue_items_queue_order_positive CHECK (queue_order >= 1),
  CONSTRAINT enhancement_queue_items_job_order_unique UNIQUE (job_id, queue_order),
  CONSTRAINT enhancement_queue_items_captured_slot_non_negative CHECK (captured_slot >= 0),
  CONSTRAINT enhancement_queue_items_base_name_not_empty CHECK (char_length(btrim(base_name)) >= 1),
  CONSTRAINT enhancement_queue_items_category_valid CHECK (category >= 0),
  CONSTRAINT enhancement_queue_items_tier_non_negative CHECK (tier >= 0),

  -- Level boundaries & invariants
  CONSTRAINT enhancement_queue_items_initial_level_range CHECK (initial_level >= 0 AND initial_level <= 14),
  CONSTRAINT enhancement_queue_items_current_level_range CHECK (current_level >= 0 AND current_level <= 15),
  CONSTRAINT enhancement_queue_items_target_level_range CHECK (target_level >= 1 AND target_level <= 15),
  CONSTRAINT enhancement_queue_items_target_higher_than_initial CHECK (target_level > initial_level),

  -- Payment & Charm allowlists
  CONSTRAINT enhancement_queue_items_payment_type_check CHECK (payment_type IN ('GOLD', 'GEMS')),
  CONSTRAINT enhancement_queue_items_charm_mode_check CHECK (
    charm_mode IN ('NONE', 'CO_3_LA', 'CO_4_LA', 'AUTO_POLICY', 'THREE_LEAF', 'FOUR_LEAF')
  ),

  -- Item status allowlist
  CONSTRAINT enhancement_queue_items_status_check CHECK (
    status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'MANUAL_REVIEW_REQUIRED')
  ),

  -- Attempt counter & phase allowlist
  CONSTRAINT enhancement_queue_items_attempt_count_non_negative CHECK (attempt_count >= 0),
  CONSTRAINT enhancement_queue_items_attempt_phase_check CHECK (
    attempt_phase IN (
      'NONE',
      'PREPARING',
      'READY_TO_EXECUTE',
      'EXECUTE_MAY_HAVE_BEEN_SENT',
      'WAITING_RESULT',
      'WAITING_SETTLEMENT',
      'SETTLED'
    )
  ),
  CONSTRAINT enhancement_queue_items_attempt_expected_level_range CHECK (
    attempt_expected_level IS NULL OR (attempt_expected_level >= 0 AND attempt_expected_level <= 14)
  ),
  CONSTRAINT enhancement_queue_items_attempt_target_level_range CHECK (
    attempt_target_level IS NULL OR (attempt_target_level >= 1 AND attempt_target_level <= 15)
  ),

  -- Non-negative spend invariants
  CONSTRAINT enhancement_queue_items_gold_spent_non_negative CHECK (actual_gold_spent >= 0),
  CONSTRAINT enhancement_queue_items_gem_spent_non_negative CHECK (actual_gem_spent >= 0),
  CONSTRAINT enhancement_queue_items_mat1_spent_non_negative CHECK (actual_material_1_spent >= 0),
  CONSTRAINT enhancement_queue_items_mat2_spent_non_negative CHECK (actual_material_2_spent >= 0),
  CONSTRAINT enhancement_queue_items_mat3_spent_non_negative CHECK (actual_material_3_spent >= 0),
  CONSTRAINT enhancement_queue_items_mat4_spent_non_negative CHECK (actual_material_4_spent >= 0),
  CONSTRAINT enhancement_queue_items_charm_spent_non_negative CHECK (actual_charm_spent >= 0)
);

-- ── 3. Add FK from jobs.active_item_id to items.id ───────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enhancement_queue_jobs_active_item_id_fkey'
  ) THEN
    ALTER TABLE public.enhancement_queue_jobs
      ADD CONSTRAINT enhancement_queue_jobs_active_item_id_fkey
      FOREIGN KEY (active_item_id) REFERENCES public.enhancement_queue_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────

-- Unresolved Queue Exclusivity per Account:
-- Database-enforced rule guaranteeing at most one active/unresolved queue per account.
-- QUEUED, RUNNING, PAUSING, PAUSED, and MANUAL_REVIEW_REQUIRED all conflict.
-- Terminal states (COMPLETED, FAILED, CANCELLED) and non-executable DRAFT do not conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_enhancement_queue_jobs_account_unresolved_exclusivity
  ON public.enhancement_queue_jobs (account_id)
  WHERE status IN ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED', 'MANUAL_REVIEW_REQUIRED');

-- Lookup & polling indexes
CREATE INDEX IF NOT EXISTS idx_enhancement_queue_jobs_account_status
  ON public.enhancement_queue_jobs (account_id, status);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_jobs_device_status
  ON public.enhancement_queue_jobs (device_id, status);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_jobs_user_status
  ON public.enhancement_queue_jobs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_items_job_order
  ON public.enhancement_queue_items (job_id, queue_order ASC);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_items_account_status
  ON public.enhancement_queue_items (account_id, status);

-- ── 5. Authoritative Derived Spend View ───────────────────────────────────────
-- Authoritative spend lives on settled queue items. Queue totals are derived dynamically
-- with SQL aggregation, eliminating aggregate double-count risk upon restarts or retries.

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
  COALESCE(SUM(i.attempt_count), 0)::integer AS total_attempt_count
FROM public.enhancement_queue_jobs j
LEFT JOIN public.enhancement_queue_items i ON i.job_id = j.id
GROUP BY j.id;

-- ── 6. Triggers ─────────────────────────────────────────────────────────────

-- 6.1 Job before-write trigger
CREATE OR REPLACE FUNCTION public.enhancement_queue_jobs_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account RECORD;
  v_count integer;
BEGIN
  -- Lookup account to validate ownership and mirror user_id / device_id
  SELECT user_id, device_id INTO v_account
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target account % does not exist', NEW.account_id;
  END IF;

  -- Maintain ownership integrity: sync or verify user_id & device_id
  IF NEW.user_id IS NULL THEN
    NEW.user_id := v_account.user_id;
  ELSIF NEW.user_id <> v_account.user_id THEN
    RAISE EXCEPTION 'user_id % does not match account owner %', NEW.user_id, v_account.user_id;
  END IF;

  IF NEW.device_id IS NULL THEN
    NEW.device_id := v_account.device_id;
  ELSIF NEW.device_id <> v_account.device_id THEN
    RAISE EXCEPTION 'device_id % does not match account device %', NEW.device_id, v_account.device_id;
  END IF;

  -- Atomic publication check: when transitioning DRAFT -> QUEUED
  IF TG_OP = 'UPDATE' AND OLD.status = 'DRAFT' AND NEW.status = 'QUEUED' THEN
    SELECT count(*) INTO v_count
    FROM public.enhancement_queue_items
    WHERE job_id = NEW.id;

    IF v_count = 0 THEN
      RAISE EXCEPTION 'Cannot publish enhancement queue job %: no items queued', NEW.id;
    END IF;

    -- Authoritative total_items alignment
    NEW.total_items := v_count;
  END IF;

  -- Maintain updated_at authority
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enhancement_queue_jobs_before_write ON public.enhancement_queue_jobs;

CREATE TRIGGER trg_enhancement_queue_jobs_before_write
  BEFORE INSERT OR UPDATE ON public.enhancement_queue_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enhancement_queue_jobs_before_write();

-- 6.2 Item before-write trigger
CREATE OR REPLACE FUNCTION public.enhancement_queue_items_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
BEGIN
  -- Lookup parent job
  SELECT user_id, account_id, status INTO v_job
  FROM public.enhancement_queue_jobs
  WHERE id = NEW.job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent enhancement queue job % does not exist', NEW.job_id;
  END IF;

  -- Inherit/synchronize ownership strictly from parent job
  IF NEW.user_id IS NULL THEN
    NEW.user_id := v_job.user_id;
  ELSIF NEW.user_id <> v_job.user_id THEN
    RAISE EXCEPTION 'Item user_id % does not match parent job owner %', NEW.user_id, v_job.user_id;
  END IF;

  IF NEW.account_id IS NULL THEN
    NEW.account_id := v_job.account_id;
  ELSIF NEW.account_id <> v_job.account_id THEN
    RAISE EXCEPTION 'Item account_id % does not match parent job account %', NEW.account_id, v_job.account_id;
  END IF;

  -- Items can only be added to a job while in DRAFT state
  IF TG_OP = 'INSERT' AND v_job.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Cannot add items to enhancement queue job % in state % (must be DRAFT)', NEW.job_id, v_job.status;
  END IF;

  -- Maintain updated_at authority
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enhancement_queue_items_before_write ON public.enhancement_queue_items;

CREATE TRIGGER trg_enhancement_queue_items_before_write
  BEFORE INSERT OR UPDATE ON public.enhancement_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enhancement_queue_items_before_write();

-- 6.3 Item before-delete trigger
CREATE OR REPLACE FUNCTION public.enhancement_queue_items_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.enhancement_queue_jobs
  WHERE id = OLD.job_id;

  -- Prevent deleting items while a queue is active
  IF FOUND AND v_status NOT IN ('DRAFT', 'CANCELLED', 'FAILED', 'COMPLETED') THEN
    RAISE EXCEPTION 'Cannot delete item from enhancement queue job % with active status %', OLD.job_id, v_status;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enhancement_queue_items_before_delete ON public.enhancement_queue_items;

CREATE TRIGGER trg_enhancement_queue_items_before_delete
  BEFORE DELETE ON public.enhancement_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enhancement_queue_items_before_delete();

-- ── 7. RPC: publish_enhancement_queue_job ─────────────────────────────────────
-- Atomically publishes a DRAFT queue job and transitions it to QUEUED.
-- Validates:
--   - Caller ownership (auth.uid() = job.user_id)
--   - Status must be DRAFT
--   - At least 1 item exists in enhancement_queue_items
--   - No conflicting unresolved queue exists for the account

CREATE OR REPLACE FUNCTION public.publish_enhancement_queue_job(p_job_id uuid)
RETURNS public.enhancement_queue_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_job public.enhancement_queue_jobs%ROWTYPE;
  v_item_count integer;
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

  -- 5. Atomically transition to QUEUED
  UPDATE public.enhancement_queue_jobs
  SET status = 'QUEUED',
      total_items = v_item_count,
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

-- ── 8. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.enhancement_queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enhancement_queue_items ENABLE ROW LEVEL SECURITY;

-- 8.1 enhancement_queue_jobs RLS policies
DROP POLICY IF EXISTS own_enhancement_queue_jobs_select ON public.enhancement_queue_jobs;
CREATE POLICY own_enhancement_queue_jobs_select ON public.enhancement_queue_jobs
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR device_id = (SELECT id FROM public.devices WHERE device_auth_id = auth.uid())
  );

DROP POLICY IF EXISTS own_enhancement_queue_jobs_insert ON public.enhancement_queue_jobs;
CREATE POLICY own_enhancement_queue_jobs_insert ON public.enhancement_queue_jobs
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = account_id
        AND a.user_id = auth.uid()
        AND a.device_id = device_id
    )
  );

DROP POLICY IF EXISTS own_enhancement_queue_jobs_update ON public.enhancement_queue_jobs;
CREATE POLICY own_enhancement_queue_jobs_update ON public.enhancement_queue_jobs
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR device_id = (SELECT id FROM public.devices WHERE device_auth_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR device_id = (SELECT id FROM public.devices WHERE device_auth_id = auth.uid())
  );

DROP POLICY IF EXISTS own_enhancement_queue_jobs_delete ON public.enhancement_queue_jobs;
CREATE POLICY own_enhancement_queue_jobs_delete ON public.enhancement_queue_jobs
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND status IN ('DRAFT', 'CANCELLED', 'COMPLETED', 'FAILED')
  );

-- 8.2 enhancement_queue_items RLS policies
DROP POLICY IF EXISTS own_enhancement_queue_items_select ON public.enhancement_queue_items;
CREATE POLICY own_enhancement_queue_items_select ON public.enhancement_queue_items
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR account_id IN (
      SELECT id FROM public.accounts WHERE device_id = (
        SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS own_enhancement_queue_items_insert ON public.enhancement_queue_items;
CREATE POLICY own_enhancement_queue_items_insert ON public.enhancement_queue_items
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.enhancement_queue_jobs j
      WHERE j.id = job_id
        AND j.user_id = auth.uid()
        AND j.status = 'DRAFT'
    )
  );

DROP POLICY IF EXISTS own_enhancement_queue_items_update ON public.enhancement_queue_items;
CREATE POLICY own_enhancement_queue_items_update ON public.enhancement_queue_items
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR account_id IN (
      SELECT id FROM public.accounts WHERE device_id = (
        SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR account_id IN (
      SELECT id FROM public.accounts WHERE device_id = (
        SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS own_enhancement_queue_items_delete ON public.enhancement_queue_items;
CREATE POLICY own_enhancement_queue_items_delete ON public.enhancement_queue_items
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.enhancement_queue_jobs j
      WHERE j.id = job_id
        AND j.user_id = auth.uid()
        AND j.status = 'DRAFT'
    )
  );

-- ── 9. Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON TABLE public.enhancement_queue_jobs FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enhancement_queue_jobs TO authenticated;

REVOKE ALL ON TABLE public.enhancement_queue_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.enhancement_queue_items TO authenticated;

REVOKE ALL ON TABLE public.enhancement_queue_job_summaries FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.enhancement_queue_job_summaries TO authenticated;

REVOKE EXECUTE ON FUNCTION public.enhancement_queue_jobs_before_write() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.enhancement_queue_jobs_before_write() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.enhancement_queue_items_before_write() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.enhancement_queue_items_before_write() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.enhancement_queue_items_before_delete() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.enhancement_queue_items_before_delete() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.publish_enhancement_queue_job(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_enhancement_queue_job(uuid) TO authenticated;

-- ── 10. Realtime ────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.enhancement_queue_jobs;

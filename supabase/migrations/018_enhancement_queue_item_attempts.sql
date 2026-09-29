-- =============================================================================
-- Migration 018: Enhancement Queue Item Attempts Append-Only Ledger
-- Task: ENHANCE-06F-MULTI-LEVEL-QUEUE-ORCHESTRATION-CORRECTIVE
--
-- Features:
-- 1. public.enhancement_queue_item_attempts:
--    - Append-only row per level attempt to preserve complete multi-level history.
--    - Bound canonically to enhancement_queue_items, enhancement_queue_jobs,
--      accounts, and auth.users.
--    - Enforces exact attempt_uuid uniqueness across the entire system.
--    - Enforces sequential attempt_number >= 1 unique per item.
--    - Enforces strict one-level step contract: step_target_level = expected_level + 1.
--    - Preserves queue_item_final_target_level (target_level of the item).
--    - Stores attempt_phase ('NONE' through 'SETTLED').
--    - Stores authoritative result_code and settlement_source ('RESULT_CODE' | 'STATE_RECONCILED').
--    - Stores authoritative quoted gold, gems, material recipe, and charm mode.
--    - Stores exact actual spend (gold, gem, materials 1..4, charm).
--    - Stores full attempt timestamps (started, execute sent, result received, settled, reconciled).
--    - Stores terminal error codes and reconciliation reasons.
--
-- 2. Immutability & Transition Guarantees:
--    - Once an attempt reaches 'SETTLED', its level, spend, result code, and
--      settlement source become permanently immutable.
--    - Level transitions, item bindings, and attempt UUIDs cannot be rewritten.
--    - Service-role writes only; authenticated users may select own rows.
-- =============================================================================

-- ── 1. Create Table public.enhancement_queue_item_attempts ───────────────────

CREATE TABLE IF NOT EXISTS public.enhancement_queue_item_attempts (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                        uuid NOT NULL REFERENCES public.enhancement_queue_jobs(id) ON DELETE CASCADE,
  item_id                       uuid NOT NULL REFERENCES public.enhancement_queue_items(id) ON DELETE CASCADE,
  account_id                    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id                       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_uuid                  uuid NOT NULL UNIQUE,
  attempt_number                integer NOT NULL,
  expected_level                integer NOT NULL,
  step_target_level             integer NOT NULL,
  queue_item_final_target_level integer NOT NULL,

  -- Phase & Settlement
  attempt_phase                 text NOT NULL DEFAULT 'NONE',
  result_code                   text,
  settlement_source             text,

  -- Quoted & Mode parameters
  payment_type                  text NOT NULL,
  charm_mode                    text NOT NULL DEFAULT 'NONE',
  quoted_gold                   bigint NOT NULL DEFAULT 0,
  quoted_gems                   bigint NOT NULL DEFAULT 0,
  recipe_materials              jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Actual spend for this specific level attempt
  actual_gold_spent             bigint NOT NULL DEFAULT 0,
  actual_gem_spent              bigint NOT NULL DEFAULT 0,
  actual_material_1_spent       bigint NOT NULL DEFAULT 0,
  actual_material_2_spent       bigint NOT NULL DEFAULT 0,
  actual_material_3_spent       bigint NOT NULL DEFAULT 0,
  actual_material_4_spent       bigint NOT NULL DEFAULT 0,
  actual_charm_spent            bigint NOT NULL DEFAULT 0,

  -- Timestamps
  attempt_started_at            timestamptz,
  execute_may_have_been_sent_at timestamptz,
  result_received_at            timestamptz,
  attempt_settled_at            timestamptz,
  reconciled_at                 timestamptz,
  reconciliation_reason         text,
  error_code                    text,
  error_message                 text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- Structural & Invariant Constraints
  CONSTRAINT enhancement_queue_item_attempts_attempt_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT enhancement_queue_item_attempts_item_attempt_number_unique UNIQUE (item_id, attempt_number),
  CONSTRAINT enhancement_queue_item_attempts_expected_level_range CHECK (expected_level >= 0 AND expected_level <= 14),
  CONSTRAINT enhancement_queue_item_attempts_step_target_level_range CHECK (step_target_level >= 1 AND step_target_level <= 15),
  CONSTRAINT enhancement_queue_item_attempts_final_target_range CHECK (queue_item_final_target_level >= 1 AND queue_item_final_target_level <= 15),
  CONSTRAINT enhancement_queue_item_attempts_single_level_step CHECK (step_target_level = expected_level + 1),
  CONSTRAINT enhancement_queue_item_attempts_step_within_final_target CHECK (step_target_level <= queue_item_final_target_level),

  -- Payment & Charm allowlists
  CONSTRAINT enhancement_queue_item_attempts_payment_type_check CHECK (payment_type IN ('GOLD', 'GEMS')),
  CONSTRAINT enhancement_queue_item_attempts_charm_mode_check CHECK (
    charm_mode IN ('NONE', 'CO_3_LA', 'CO_4_LA', 'AUTO_POLICY', 'THREE_LEAF', 'FOUR_LEAF')
  ),

  -- Attempt phase allowlist matching migration 013
  CONSTRAINT enhancement_queue_item_attempts_attempt_phase_check CHECK (
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

  -- Settlement source allowlist matching migration 015
  CONSTRAINT enhancement_queue_item_attempts_settlement_source_check CHECK (
    settlement_source IS NULL OR settlement_source IN ('RESULT_CODE', 'STATE_RECONCILED')
  ),

  -- Non-negative spend & quote invariants
  CONSTRAINT enhancement_queue_item_attempts_quoted_gold_non_negative CHECK (quoted_gold >= 0),
  CONSTRAINT enhancement_queue_item_attempts_quoted_gems_non_negative CHECK (quoted_gems >= 0),
  CONSTRAINT enhancement_queue_item_attempts_gold_spent_non_negative CHECK (actual_gold_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_gem_spent_non_negative CHECK (actual_gem_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_mat1_spent_non_negative CHECK (actual_material_1_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_mat2_spent_non_negative CHECK (actual_material_2_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_mat3_spent_non_negative CHECK (actual_material_3_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_mat4_spent_non_negative CHECK (actual_material_4_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_charm_spent_non_negative CHECK (actual_charm_spent >= 0),
  CONSTRAINT enhancement_queue_item_attempts_reconciliation_reason_length CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) <= 500
  )
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_item_attempts_item_order
  ON public.enhancement_queue_item_attempts (item_id, attempt_number ASC);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_item_attempts_job
  ON public.enhancement_queue_item_attempts (job_id);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_item_attempts_attempt_uuid
  ON public.enhancement_queue_item_attempts (attempt_uuid);

CREATE INDEX IF NOT EXISTS idx_enhancement_queue_item_attempts_account
  ON public.enhancement_queue_item_attempts (account_id, created_at DESC);

-- ── 3. Triggers: Immutability & Transition Guarantees ────────────────────────

CREATE OR REPLACE FUNCTION public.enhancement_queue_item_attempts_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Verify parent item exists and inherit ownership/parentage
    SELECT job_id, account_id, user_id, target_level INTO v_item
    FROM public.enhancement_queue_items
    WHERE id = NEW.item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent enhancement queue item % does not exist', NEW.item_id;
    END IF;

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

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
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

    -- Permanently settled attempt guard:
    -- Once an attempt reaches SETTLED, its terminal outcomes cannot be modified.
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
      THEN
        RAISE EXCEPTION 'Settled attempt % is permanently immutable and cannot be rewritten', OLD.attempt_uuid;
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

-- ── 4. Row Level Security & Role Grants ───────────────────────────────────────

ALTER TABLE public.enhancement_queue_item_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_enhancement_queue_item_attempts_select ON public.enhancement_queue_item_attempts;
CREATE POLICY own_enhancement_queue_item_attempts_select ON public.enhancement_queue_item_attempts
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR account_id IN (
      SELECT id FROM public.accounts WHERE device_id = (
        SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
      )
    )
  );

-- Service-role / Server writes only:
-- Revoke all mutations from public, anon, and authenticated
REVOKE ALL ON TABLE public.enhancement_queue_item_attempts FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.enhancement_queue_item_attempts TO authenticated;
GRANT ALL ON TABLE public.enhancement_queue_item_attempts TO service_role;

REVOKE EXECUTE ON FUNCTION public.enhancement_queue_item_attempts_before_write() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.enhancement_queue_item_attempts_before_write() TO authenticated, service_role;

-- ── 5. Realtime ────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.enhancement_queue_item_attempts;

-- =============================================================================
-- Migration 010: Account Delete Primitives
--
-- Adds:
--   public.delete_game_account(p_account_id uuid, p_stop_command_id uuid) → uuid
--
-- Contract:
--   Hard-deletes the account row identified by p_account_id, relying on FK
--   CASCADE to atomically remove account_runtime and all account-specific
--   command rows.
--
-- Safety invariants enforced inside one transaction:
--   1. Caller is authenticated (auth.uid() IS NOT NULL).
--   2. Account exists and is owned by the caller.
--   3. The supplied Stop command (p_stop_command_id) is:
--        - type = 'stop'
--        - status = 'success'
--        - finished_at IS NOT NULL
--        - account_id = p_account_id
--        - device_id  = target account.device_id
--   4. No later lifecycle command (start/restart) invalidates the Stop proof.
--      Stale-proof rule:
--        Any start or restart command for this account with:
--          created_at > proof_finished_at OR finished_at > proof_finished_at
--        invalidates the Stop proof.
--        Reason:
--          PostgreSQL now() / CURRENT_TIMESTAMP is transaction-start based, so
--          created_at alone cannot guarantee execution ordering. A start or restart
--          command may be created before the stop completes (created_at < stop.finished_at)
--          but finish execution after the stop (finished_at > stop.finished_at).
--          Both timestamps must be evaluated.
--   5. No command for this account is currently in status = 'queued' or 'running'.
--      (Belt-and-suspenders: covers active commands inserted before or concurrently.)
--   6. Desired-state consistency invariant (hard gate):
--        accounts.desired_state = 'stopped'.
--        The successful Stop command remains the authoritative process-stop proof,
--        but desired_state = 'stopped' is an additional mandatory consistency invariant.
--
-- Concurrency safety:
--   The accounts row is locked FOR UPDATE before any validation occurs.
--   PostgreSQL FK enforcement on commands INSERT acquires a KEY SHARE lock on the
--   referenced accounts row.  FOR UPDATE conflicts with KEY SHARE, therefore any
--   concurrent INSERT INTO commands WHERE account_id = p_account_id BLOCKS until
--   this transaction commits or rolls back.
--   If this transaction commits (deletes the account), the concurrent INSERT gets
--   a FK violation and fails — no zombie command is inserted.
--   If this transaction rolls back, the concurrent INSERT proceeds normally.
--   This makes the deletion decision transactional around concurrent lifecycle
--   command insertion without any additional primitives.
--
-- Slot high-water:
--   devices.next_slot_index is NEVER modified. The deleted slot is permanently
--   retired. This prevents historical client/cache/RMS collisions.
--
-- FK CASCADE:
--   account_runtime.account_id → accounts.id ON DELETE CASCADE
--   commands.account_id        → accounts.id ON DELETE CASCADE
--   Both child rows are removed atomically by Postgres when the accounts row is
--   deleted. The Stop proof command row itself disappears at commit — this is
--   acceptable for current product semantics (no audit-history retention in this
--   round).
--
-- Idempotency / missing account:
--   A missing or unowned account is always rejected. The caller receives a clear
--   exception. Silently claiming success for an unknown account is never correct.
--
-- SECURITY INVOKER + SET search_path:
--   All table/function accesses run as the calling user, so RLS policies apply
--   normally. No privilege escalation.
--
-- Grants:
--   REVOKE from PUBLIC and anon; GRANT to authenticated only.
-- =============================================================================

DROP FUNCTION IF EXISTS public.delete_game_account(uuid, uuid);

CREATE OR REPLACE FUNCTION public.delete_game_account(
  p_account_id      uuid,
  p_stop_command_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_device_id     uuid;
  v_account_desired_state text;
  v_proof_finished_at     timestamptz;
  v_stale_count           bigint;
  v_active_count          bigint;
BEGIN
  -- ── 1. Authentication check ──────────────────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- ── 2. Input validation ──────────────────────────────────────────────────
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id is required';
  END IF;

  IF p_stop_command_id IS NULL THEN
    RAISE EXCEPTION 'stop_command_id is required';
  END IF;

  -- ── 3. Lock owned account row FOR UPDATE ─────────────────────────────────
  --
  -- Acquiring FOR UPDATE on the accounts row before any validation ensures that
  -- the entire validation + delete sequence is atomic with respect to:
  --   a) Concurrent DELETE attempts on the same account.
  --   b) Concurrent INSERT INTO commands WHERE account_id = p_account_id
  --      (FK KEY SHARE conflicts with FOR UPDATE → concurrent Start INSERT
  --       blocks until this transaction commits or rolls back).
  --
  -- Missing account or wrong owner → reject immediately.
  SELECT device_id, desired_state
  INTO v_account_device_id, v_account_desired_state
  FROM public.accounts
  WHERE id      = p_account_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account not found or not owned by caller (account_id=%)', p_account_id;
  END IF;

  -- ── 4. Validate the supplied Stop command proof ──────────────────────────
  --
  -- The command must exist and satisfy ALL of:
  --   type        = 'stop'
  --   status      = 'success'
  --   finished_at IS NOT NULL
  --   account_id  = p_account_id           (not another account's stop)
  --   device_id   = target account.device_id (not another device's stop)
  --
  -- We load finished_at for use in the stale-proof check (step 5).
  SELECT finished_at
  INTO v_proof_finished_at
  FROM public.commands
  WHERE id         = p_stop_command_id
    AND account_id = p_account_id
    AND device_id  = v_account_device_id
    AND type       = 'stop'
    AND status     = 'success'
    AND finished_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'stop command proof invalid or does not match account/device '
      '(stop_command_id=%, account_id=%, device_id=%)',
      p_stop_command_id, p_account_id, v_account_device_id;
  END IF;

  -- ── 5. Stale-proof check — no later lifecycle command invalidates proof ──
  --
  -- Stale-proof rule:
  --   A start or restart command invalidates the supplied Stop proof if either:
  --     created_at > proof_finished_at
  --     OR finished_at > proof_finished_at
  --
  --   PostgreSQL now() / CURRENT_TIMESTAMP is transaction-start based, so created_at
  --   alone must not be treated as proof of execution ordering. A start or restart
  --   command may have been created before the stop finished (created_at < stop.finished_at)
  --   but completed after the stop (finished_at > stop.finished_at).
  --   Queued/running commands have finished_at = NULL; they remain protected by the
  --   active-command guard in step 6.
  --   A later 'stop' command does not invalidate the proof (it reinforces it),
  --   so 'stop' is excluded from this check.
  SELECT COUNT(*)
  INTO v_stale_count
  FROM public.commands
  WHERE account_id = p_account_id
    AND type IN ('start', 'restart')
    AND (
      created_at > v_proof_finished_at
      OR finished_at > v_proof_finished_at
    );

  IF v_stale_count > 0 THEN
    RAISE EXCEPTION
      'stop proof is stale: % later start/restart command(s) found with created_at or finished_at after stop finished_at=% '
      '(account_id=%)',
      v_stale_count, v_proof_finished_at, p_account_id;
  END IF;

  -- ── 6. Active command guard — no queued or running commands ─────────────
  --
  -- Belt-and-suspenders: catches any command (of any type) currently in-flight
  -- for this account.  A concurrent Start INSERT is already serialised by the
  -- FOR UPDATE lock in step 3, but a Start that was already queued before we
  -- acquired the lock must also be caught here.
  SELECT COUNT(*)
  INTO v_active_count
  FROM public.commands
  WHERE account_id = p_account_id
    AND status IN ('queued', 'running');

  IF v_active_count > 0 THEN
    RAISE EXCEPTION
      '% active command(s) (queued or running) found for account_id=%; '
      'wait for all commands to reach a terminal status before deleting',
      v_active_count, p_account_id;
  END IF;

  -- ── 7. Desired-state consistency invariant (hard gate) ───────────────────
  --
  -- accounts.desired_state must be 'stopped'.
  --
  -- The successful Stop command proof (steps 4–6) remains the authoritative
  -- process-stop proof. However, accounts.desired_state = 'stopped' is an
  -- additional mandatory consistency invariant:
  --   Start   → desired_state = 'running'
  --   Stop    → desired_state = 'stopped'
  --   Restart → desired_state = 'stopped' → 'running'
  --
  -- If accounts.desired_state is NOT 'stopped' (e.g. 'running'), hard-delete
  -- must not proceed merely because an older Stop command exists.
  -- If a legitimate Stop succeeded but its desired-state write failed or lagged,
  -- DELETE conservatively over-rejects. The caller can execute a fresh Stop
  -- after state synchronization succeeds.
  -- Offline-device bypass is NOT allowed.
  IF v_account_desired_state <> 'stopped' THEN
    RAISE EXCEPTION
      'account desired_state is % (expected stopped) for account_id=%; '
      'hard-delete requires desired_state = stopped in addition to a valid stop proof',
      v_account_desired_state, p_account_id;
  END IF;

  -- ── 8. Hard delete — FK CASCADE removes child rows atomically ───────────
  --
  -- The single DELETE on accounts cascades to:
  --   - account_runtime  (account_id → accounts.id ON DELETE CASCADE)
  --   - commands         (account_id → accounts.id ON DELETE CASCADE)
  --       This includes the p_stop_command_id proof row itself.
  --
  -- devices.next_slot_index is NOT touched. The slot is permanently retired.
  DELETE FROM public.accounts
  WHERE id = p_account_id;

  -- ── 9. Return the deleted account ID ────────────────────────────────────
  RETURN p_account_id;
END;
$$;

-- ── Grants ────────────────────────────────────────────────────────────────────
-- Revoke from PUBLIC and anon (belt-and-suspenders: CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default in some Postgres configurations).
REVOKE EXECUTE ON FUNCTION public.delete_game_account(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_game_account(uuid, uuid) TO authenticated;

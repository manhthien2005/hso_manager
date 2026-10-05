-- ==============================================================================
-- Migration 023: Bạch Hổ Runtime Compatibility Expansion (Movement Fix v4.0.3)
--
-- Task: KNIGHT_V403_R4_5_FIX_GAME_READY_MOVEMENT_AND_COMPATIBILITY_ROLLOUT_PREP
--
-- Extends Bạch Hổ (server_index = 8) runtime compatibility allowlist:
--   1. Retains audited v4.0.3 Bạch Hổ base JAR:
--      '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d'
--   2. Adds audited v4.0.3 movement-fixed JAR:
--      '51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a'
--
-- Safety & Invariant Guarantees:
--   - Does NOT modify migration 022.
--   - CREATE OR REPLACE ONLY the 3 functions containing the Bạch Hổ SHA gate.
--   - Preserves exact CTL version 15 requirement.
--   - Preserves exact agent capability 'managed-identity-restart-v1' requirement.
--   - Preserves ownership checks, user_id/device_id immutability, range 0..8,
--     concurrency locks, transition semantics, and RPC signatures.
--   - Existing server_index = 8 accounts remain valid and intact.
--   - Non-destructive and idempotent.
-- ==============================================================================

-- ── 1. Function public.accounts_before_write() ────────────────────────────────

CREATE OR REPLACE FUNCTION public.accounts_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_user_id         uuid;
  v_device_jar_sha256      text;
  v_device_jar_ctl_version integer;
  v_device_agent_version   text;
BEGIN
  -- 1. Invariant range check (0..8)
  IF NEW.server_index IS NULL OR NEW.server_index < 0 OR NEW.server_index > 8 THEN
    RAISE EXCEPTION 'server_index must be between 0 and 8';
  END IF;

  -- 2. Immutability checks on UPDATE: user_id and device_id cannot be changed
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'accounts.user_id is immutable after insert';
    END IF;

    IF NEW.device_id IS DISTINCT FROM OLD.device_id THEN
      RAISE EXCEPTION 'accounts.device_id is immutable after insert';
    END IF;
  END IF;

  -- 3. Relational ownership check on INSERT: device must exist and belong to NEW.user_id
  IF TG_OP = 'INSERT' THEN
    SELECT user_id, jar_sha256, jar_ctl_version, agent_version
    INTO v_device_user_id, v_device_jar_sha256, v_device_jar_ctl_version, v_device_agent_version
    FROM public.devices
    WHERE id = NEW.device_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'target device % not found for account', NEW.device_id;
    END IF;

    IF v_device_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'device % does not belong to user %', NEW.device_id, NEW.user_id;
    END IF;
  END IF;

  -- 4. Bạch Hổ (server_index = 8) runtime compatibility gate
  -- Enforced on:
  --   a) INSERT with server_index = 8
  --   b) UPDATE transitioning into server_index = 8 (when OLD.server_index IS NULL OR OLD.server_index <> 8)
  -- Existing server 8 accounts receiving unrelated metadata edits are preserved without revalidation.
  IF NEW.server_index = 8 AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.server_index IS NULL OR OLD.server_index <> 8))) THEN
    IF TG_OP = 'UPDATE' THEN
      SELECT jar_sha256, jar_ctl_version, agent_version
      INTO v_device_jar_sha256, v_device_jar_ctl_version, v_device_agent_version
      FROM public.devices
      WHERE id = NEW.device_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'target device % not found for account', NEW.device_id;
      END IF;
    END IF;

    IF v_device_jar_sha256 IS NULL
       OR v_device_jar_sha256 NOT IN (
            '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d',
            '51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a'
          )
       OR v_device_jar_ctl_version IS NULL
       OR v_device_jar_ctl_version <> 15
       OR NOT public.agent_has_exact_capability(v_device_agent_version, 'managed-identity-restart-v1') THEN
      RAISE EXCEPTION 'device % is not compatible with Bach Ho server (requires compatible v4.0.3 JAR SHA, CTL 15, and agent capability managed-identity-restart-v1)',
        NEW.device_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ── 2. RPC create_game_account ────────────────────────────────────────────────
-- Concurrency-safe monotonic slot allocation with positional character slot (1..3)
-- and Bạch Hổ server capability verification.

CREATE OR REPLACE FUNCTION public.create_game_account(
  p_device_id       uuid,
  p_label           text,
  p_username        text,
  p_secret_sealed   jsonb,
  p_server_index    smallint,
  p_control_version integer,
  p_control         jsonb,
  p_character_slot  smallint DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_device_pubkey          bytea;
  v_device_jar_ctl_version integer;
  v_device_jar_sha256      text;
  v_device_agent_version   text;
  v_slot_index             integer;
  v_account_id             uuid;
BEGIN
  -- 1. Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 2. Basic input validation
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'device_id is required';
  END IF;

  IF p_label IS NULL OR trim(p_label) = '' THEN
    RAISE EXCEPTION 'label cannot be empty or whitespace only';
  END IF;

  IF p_username IS NULL OR trim(p_username) = '' THEN
    RAISE EXCEPTION 'username cannot be empty or whitespace only';
  END IF;

  IF p_server_index IS NULL OR p_server_index < 0 OR p_server_index > 8 THEN
    RAISE EXCEPTION 'server_index must be between 0 and 8';
  END IF;

  IF p_control_version IS NULL OR p_control_version <= 0 THEN
    RAISE EXCEPTION 'control_version must be a positive integer';
  END IF;

  IF p_control IS NULL OR jsonb_typeof(p_control) <> 'object' THEN
    RAISE EXCEPTION 'control must be a JSON object';
  END IF;

  IF p_character_slot IS NULL OR p_character_slot < 1 OR p_character_slot > 3 THEN
    RAISE EXCEPTION 'character_slot must be between 1 and 3';
  END IF;

  -- 3. Sealed envelope validation (centralized primitive)
  PERFORM public.validate_sealed_secret_envelope(p_secret_sealed);

  -- 4. Target device lookup & exclusive row lock for slot allocation serialization
  SELECT pubkey, jar_ctl_version, jar_sha256, agent_version, next_slot_index
  INTO v_device_pubkey, v_device_jar_ctl_version, v_device_jar_sha256, v_device_agent_version, v_slot_index
  FROM public.devices
  WHERE id = p_device_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found or not owned by caller';
  END IF;

  -- 5. Device preconditions
  IF v_device_pubkey IS NULL THEN
    RAISE EXCEPTION 'device has no pubkey';
  END IF;

  IF octet_length(v_device_pubkey) <> 65 OR get_byte(v_device_pubkey, 0) <> 4 THEN
    RAISE EXCEPTION 'device pubkey must be 65-byte SEC1 uncompressed P-256';
  END IF;

  IF v_device_jar_ctl_version IS NULL THEN
    RAISE EXCEPTION 'device has not reported jar_ctl_version';
  END IF;

  IF p_control_version <> v_device_jar_ctl_version THEN
    RAISE EXCEPTION 'control version mismatch: caller specified %, device reports %',
      p_control_version, v_device_jar_ctl_version;
  END IF;

  -- 6. Bạch Hổ runtime compatibility check
  IF p_server_index = 8 THEN
    IF v_device_jar_sha256 IS NULL
       OR v_device_jar_sha256 NOT IN (
            '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d',
            '51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a'
          )
       OR v_device_jar_ctl_version <> 15
       OR NOT public.agent_has_exact_capability(v_device_agent_version, 'managed-identity-restart-v1') THEN
      RAISE EXCEPTION 'device is not compatible with Bach Ho server (requires compatible v4.0.3 JAR SHA, CTL 15, and agent capability managed-identity-restart-v1)';
    END IF;
  END IF;

  -- 7. Monotonic slot allocation: check integer overflow & advance high-water mark
  IF v_slot_index >= 2147483647 THEN
    RAISE EXCEPTION 'slot_index integer overflow on device %', p_device_id;
  END IF;

  UPDATE public.devices
  SET next_slot_index = next_slot_index + 1
  WHERE id = p_device_id;

  -- 8. Insert accounts row (initially stopped, server-controlled metadata)
  INSERT INTO public.accounts (
    device_id,
    user_id,
    label,
    slot_index,
    character_slot,
    username,
    secret_sealed,
    server_index,
    desired_state,
    control_version,
    control,
    config_version
  ) VALUES (
    p_device_id,
    auth.uid(),
    trim(p_label),
    v_slot_index,
    p_character_slot,
    p_username,
    p_secret_sealed,
    p_server_index,
    'stopped',
    p_control_version,
    p_control,
    1
  )
  RETURNING id INTO v_account_id;

  -- 9. Insert matching account_runtime row atomically (relies on table defaults)
  INSERT INTO public.account_runtime (
    account_id
  ) VALUES (
    v_account_id
  );

  RETURN v_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_game_account(uuid, text, text, jsonb, smallint, integer, jsonb, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_game_account(uuid, text, text, jsonb, smallint, integer, jsonb, smallint) TO authenticated;


-- ── 3. RPC update_game_account ────────────────────────────────────────────────
-- Safe metadata & credential updates for existing accounts.
-- Preserves runtime, slot_index, control, desired_state, config_version, commands.

CREATE OR REPLACE FUNCTION public.update_game_account(
  p_account_id     uuid,
  p_label          text,
  p_server_index   smallint,
  p_username       text DEFAULT NULL,
  p_secret_sealed  jsonb DEFAULT NULL,
  p_character_slot smallint DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id             uuid;
  v_device_id              uuid;
  v_old_server_index       smallint;
  v_device_jar_sha256      text;
  v_device_jar_ctl_version integer;
  v_device_agent_version   text;
BEGIN
  -- 1. Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 2. Basic input validation
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id is required';
  END IF;

  IF p_label IS NULL OR trim(p_label) = '' THEN
    RAISE EXCEPTION 'label cannot be empty or whitespace only';
  END IF;

  IF p_server_index IS NULL OR p_server_index < 0 OR p_server_index > 8 THEN
    RAISE EXCEPTION 'server_index must be between 0 and 8';
  END IF;

  IF p_character_slot IS NOT NULL AND (p_character_slot < 1 OR p_character_slot > 3) THEN
    RAISE EXCEPTION 'character_slot must be between 1 and 3';
  END IF;

  -- 3. Credential pair semantics:
  -- Both must be NULL (preserve existing credentials)
  -- OR both must be NOT NULL (atomically replace credentials).
  IF (p_username IS NULL AND p_secret_sealed IS NOT NULL) OR
     (p_username IS NOT NULL AND p_secret_sealed IS NULL) THEN
    RAISE EXCEPTION 'username and secret_sealed must both be provided or both be omitted';
  END IF;

  -- If replacement credentials provided, validate both
  IF p_username IS NOT NULL THEN
    IF trim(p_username) = '' THEN
      RAISE EXCEPTION 'username cannot be empty or whitespace only';
    END IF;

    -- Validate sealed envelope with same shared contract
    PERFORM public.validate_sealed_secret_envelope(p_secret_sealed);
  END IF;

  -- 4. Target account lookup & exclusive row lock for caller ownership
  SELECT id, device_id, server_index
  INTO v_account_id, v_device_id, v_old_server_index
  FROM public.accounts
  WHERE id = p_account_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account not found or not owned by caller';
  END IF;

  -- 5. Bạch Hổ runtime compatibility check on transition
  IF p_server_index = 8 AND v_old_server_index <> 8 THEN
    SELECT jar_sha256, jar_ctl_version, agent_version
    INTO v_device_jar_sha256, v_device_jar_ctl_version, v_device_agent_version
    FROM public.devices
    WHERE id = v_device_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'device not found for account %', p_account_id;
    END IF;

    IF v_device_jar_sha256 IS NULL
       OR v_device_jar_sha256 NOT IN (
            '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d',
            '51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a'
          )
       OR v_device_jar_ctl_version IS NULL
       OR v_device_jar_ctl_version <> 15
       OR NOT public.agent_has_exact_capability(v_device_agent_version, 'managed-identity-restart-v1') THEN
      RAISE EXCEPTION 'device is not compatible with Bach Ho server (requires compatible v4.0.3 JAR SHA, CTL 15, and agent capability managed-identity-restart-v1)';
    END IF;
  END IF;

  -- 6. Atomically update metadata without altering runtime, desired_state,
  --    slot_index, control, control_version, config_version, or commands.
  IF p_username IS NOT NULL THEN
    UPDATE public.accounts
    SET label          = trim(p_label),
        server_index   = p_server_index,
        character_slot = COALESCE(p_character_slot, character_slot),
        username       = p_username,
        secret_sealed  = p_secret_sealed,
        updated_at     = now()
    WHERE id = p_account_id;
  ELSE
    UPDATE public.accounts
    SET label          = trim(p_label),
        server_index   = p_server_index,
        character_slot = COALESCE(p_character_slot, character_slot),
        updated_at     = now()
    WHERE id = p_account_id;
  END IF;

  RETURN p_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_game_account(uuid, text, smallint, text, jsonb, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_game_account(uuid, text, smallint, text, jsonb, smallint) TO authenticated;

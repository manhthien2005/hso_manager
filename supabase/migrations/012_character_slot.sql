-- =============================================================================
-- Migration 012: Character Slot Account Setting Contract
--
-- Features:
-- 1. Schema Evolution: accounts.character_slot
--    - Adds character_slot smallint NOT NULL DEFAULT 1 to public.accounts.
--    - Adds CHECK constraint accounts_character_slot_check (character_slot >= 1 AND character_slot <= 3).
--    - Automatically sets existing accounts to slot 1 via table default.
--    - Enforces strict 1..3 boundary for character slot position.
--
-- 2. Concurrency-Safe create_game_account Evolution:
--    - Drops exact 7-argument signature without CASCADE.
--    - Replaces with 8-argument signature accepting p_character_slot smallint DEFAULT 1.
--    - Validates 1 <= p_character_slot <= 3.
--    - Inserts character_slot into public.accounts row.
--    - Preserves security invoker, search_path = public, device lock, and grants.
--
-- 3. Safe update_game_account Evolution:
--    - Drops exact 5-argument signature without CASCADE.
--    - Replaces with 6-argument signature accepting p_character_slot smallint DEFAULT NULL.
--    - Preserves existing character_slot when p_character_slot IS NULL.
--    - Validates 1 <= p_character_slot <= 3 when non-NULL and updates character_slot.
--    - Preserves security invoker, search_path = public, account ownership, and grants.
-- =============================================================================

-- ── 1. Schema Evolution: accounts.character_slot ──────────────────────────────

ALTER TABLE public.accounts
  ADD COLUMN character_slot smallint NOT NULL DEFAULT 1;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_character_slot_check CHECK (character_slot >= 1 AND character_slot <= 3);


-- ── 2. RPC create_game_account ────────────────────────────────────────────────
-- Concurrency-safe monotonic slot allocation with positional character slot (1..3).

DROP FUNCTION IF EXISTS public.create_game_account(uuid, text, text, jsonb, smallint, integer, jsonb);

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

  IF p_server_index IS NULL OR p_server_index < 0 OR p_server_index > 7 THEN
    RAISE EXCEPTION 'server_index must be between 0 and 7';
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
  SELECT pubkey, jar_ctl_version, next_slot_index
  INTO v_device_pubkey, v_device_jar_ctl_version, v_slot_index
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

  -- 6. Monotonic slot allocation: check integer overflow & advance high-water mark
  IF v_slot_index >= 2147483647 THEN
    RAISE EXCEPTION 'slot_index integer overflow on device %', p_device_id;
  END IF;

  UPDATE public.devices
  SET next_slot_index = next_slot_index + 1
  WHERE id = p_device_id;

  -- 7. Insert accounts row (initially stopped, server-controlled metadata)
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

  -- 8. Insert matching account_runtime row atomically (relies on table defaults)
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

DROP FUNCTION IF EXISTS public.update_game_account(uuid, text, smallint, text, jsonb);

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
  v_account_id uuid;
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

  IF p_server_index IS NULL OR p_server_index < 0 OR p_server_index > 7 THEN
    RAISE EXCEPTION 'server_index must be between 0 and 7';
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
  SELECT id
  INTO v_account_id
  FROM public.accounts
  WHERE id = p_account_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account not found or not owned by caller';
  END IF;

  -- 5. Atomically update metadata without altering runtime, desired_state,
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

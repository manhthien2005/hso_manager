-- =============================================================================
-- Migration 022: v4.0.3 Bạch Hổ Server Support & Runtime Capability Invariant
--
-- Features:
-- 1. Table-level CHECK invariant:
--    - Enforces accounts.server_index BETWEEN 0 AND 8 with deterministic name
--      accounts_server_index_check.
--    - Fails loudly on existing invalid rows (0..8 required).
--
-- 2. Direct Write Defense Trigger:
--    - Adds BEFORE INSERT OR UPDATE trigger trg_accounts_before_write on public.accounts.
--    - Enforces 0..8 bounds independently of application layer.
--    - Protects transitions into logical server ID 8 (Bạch Hổ):
--      * On INSERT with server_index = 8: requires target device to report compatible
--        JAR SHA256 ('4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d')
--        and CTL version 15.
--      * On UPDATE into server_index = 8 (when old server_index <> 8): requires device
--        to report compatible JAR SHA256 and CTL version 15.
--      * Preserves existing server_index = 8 accounts during unrelated metadata edits
--        without forcing downgrade if device is offline or heartbeat is stale.
--
-- 3. Concurrency-Safe create_game_account Evolution:
--    - Preserves exact 8-argument signature from migration 012.
--    - Expands acceptable server_index range to 0..8 (fails closed on negative and >=9).
--    - Enforces Bạch Hổ runtime compatibility check on target device before slot allocation.
--    - Preserves security invoker, search_path = public, device lock, and grants.
--
-- 4. Concurrency-Safe update_game_account Evolution:
--    - Preserves exact 6-argument signature from migration 012.
--    - Expands acceptable server_index range to 0..8 (fails closed on negative and >=9).
--    - Enforces Bạch Hổ runtime compatibility check when transitioning into server_index = 8.
--    - Preserves security invoker, search_path = public, ownership, credential pair semantics.
-- =============================================================================

-- ── 1. Table-Level CHECK Invariant ───────────────────────────────────────────

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_server_index_check
  CHECK (server_index >= 0 AND server_index <= 8);


-- ── 2. Direct Write Defense Trigger Function ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.accounts_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_jar_sha256      text;
  v_device_jar_ctl_version integer;
BEGIN
  -- 1. Invariant range check
  IF NEW.server_index IS NULL OR NEW.server_index < 0 OR NEW.server_index > 8 THEN
    RAISE EXCEPTION 'server_index must be between 0 and 8';
  END IF;

  -- 2. Bạch Hổ (server_index = 8) runtime compatibility gate
  -- Fired when inserting a new account for server 8, or updating an account to server 8
  -- from any other server index.
  IF NEW.server_index = 8 AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.server_index IS NULL OR OLD.server_index <> 8))) THEN
    SELECT jar_sha256, jar_ctl_version
    INTO v_device_jar_sha256, v_device_jar_ctl_version
    FROM public.devices
    WHERE id = NEW.device_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'target device % not found for account', NEW.device_id;
    END IF;

    IF v_device_jar_sha256 IS NULL
       OR v_device_jar_sha256 <> '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d'
       OR v_device_jar_ctl_version IS NULL
       OR v_device_jar_ctl_version <> 15 THEN
      RAISE EXCEPTION 'device % is not compatible with Bach Ho server (requires JAR SHA 4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d and CTL 15)',
        NEW.device_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_before_write ON public.accounts;

CREATE TRIGGER trg_accounts_before_write
BEFORE INSERT OR UPDATE ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.accounts_before_write();


-- ── 3. RPC create_game_account ────────────────────────────────────────────────
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
  SELECT pubkey, jar_ctl_version, jar_sha256, next_slot_index
  INTO v_device_pubkey, v_device_jar_ctl_version, v_device_jar_sha256, v_slot_index
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
       OR v_device_jar_sha256 <> '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d'
       OR v_device_jar_ctl_version <> 15 THEN
      RAISE EXCEPTION 'device is not compatible with Bach Ho server (requires JAR SHA 4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d and CTL 15)';
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


-- ── 4. RPC update_game_account ────────────────────────────────────────────────
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
    SELECT jar_sha256, jar_ctl_version
    INTO v_device_jar_sha256, v_device_jar_ctl_version
    FROM public.devices
    WHERE id = v_device_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'device not found for account %', p_account_id;
    END IF;

    IF v_device_jar_sha256 IS NULL
       OR v_device_jar_sha256 <> '4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d'
       OR v_device_jar_ctl_version IS NULL
       OR v_device_jar_ctl_version <> 15 THEN
      RAISE EXCEPTION 'device is not compatible with Bach Ho server (requires JAR SHA 4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d and CTL 15)';
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

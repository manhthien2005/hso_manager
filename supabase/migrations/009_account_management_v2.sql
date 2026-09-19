-- =============================================================================
-- Migration 009: Account Management V2 — Lifecycle Primitives
--
-- Features:
-- 1. Permanent monotonic slot allocation:
--    - Adds next_slot_index column to public.devices.
--    - Backfills existing devices using COALESCE(MAX(accounts.slot_index) + 1, 0).
--    - Enforces NOT NULL, DEFAULT 0, and non-negative CHECK constraint.
--    - Invariant: A slot index allocated once per device is never re-allocated,
--      preventing historical client/cache/RMS collisions upon account deletion.
--
-- 2. Shared sealed envelope validation primitive:
--    - Centralizes sealed envelope validation in public.validate_sealed_secret_envelope
--      to guarantee zero contract drift between account creation and credential updates.
--
-- 3. Concurrency-safe create_game_account evolution:
--    - Replaces MAX(slot_index) query with atomic allocation from devices.next_slot_index
--      under exclusive device row lock (FOR UPDATE).
--    - Transaction-safe: rolled back if account or runtime creation fails.
--    - Preserves exact external signature, grants, and runtime defaults.
--
-- 4. public.update_game_account RPC:
--    - Allows authenticated account owner to safely update metadata (label, server_index).
--    - Supports credential preservation (both username & sealed secret omitted/null).
--    - Supports atomic credential replacement (both username & sealed secret provided).
--    - Rejects partial credential updates.
--    - Does not modify runtime, control, desired_state, slot_index, or issue commands.
-- =============================================================================

-- ── 1. Schema Evolution: devices.next_slot_index ─────────────────────────────

-- 1.1 Add column next_slot_index if not exists
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS next_slot_index integer;

-- 1.2 Backfill existing devices from maximum existing slot index
UPDATE public.devices d
SET next_slot_index = GREATEST(
  COALESCE(
    (
      SELECT MAX(a.slot_index) + 1
      FROM public.accounts a
      WHERE a.device_id = d.id
    ),
    0
  ),
  0
)
WHERE d.next_slot_index IS NULL;

-- 1.3 Set default and not-null constraints
ALTER TABLE public.devices
  ALTER COLUMN next_slot_index SET DEFAULT 0,
  ALTER COLUMN next_slot_index SET NOT NULL;

-- 1.4 Enforce non-negative constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'devices_next_slot_index_non_negative'
  ) THEN
    ALTER TABLE public.devices
      ADD CONSTRAINT devices_next_slot_index_non_negative CHECK (next_slot_index >= 0);
  END IF;
END $$;


-- ── 2. Helper: validate_sealed_secret_envelope ──────────────────────────────
-- Centralized cryptographic envelope validation shared by create_game_account
-- and update_game_account to guarantee zero schema / contract drift.

DROP FUNCTION IF EXISTS public.validate_sealed_secret_envelope(jsonb);

CREATE OR REPLACE FUNCTION public.validate_sealed_secret_envelope(
  p_secret_sealed jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_eph_pub_bytes bytea;
  v_nonce_bytes   bytea;
  v_ct_bytes      bytea;
BEGIN
  -- 1. Must be a valid JSON object
  IF p_secret_sealed IS NULL OR jsonb_typeof(p_secret_sealed) <> 'object' THEN
    RAISE EXCEPTION 'secret_sealed must be a JSON object';
  END IF;

  -- 2. Algorithm and info contract validation
  IF (p_secret_sealed->>'alg') IS DISTINCT FROM 'ecdh-p256-hkdf-sha256-aes256gcm' THEN
    RAISE EXCEPTION 'unsupported sealed algorithm: expected ecdh-p256-hkdf-sha256-aes256gcm';
  END IF;

  IF (p_secret_sealed->>'info') IS DISTINCT FROM 'zeus-v1' THEN
    RAISE EXCEPTION 'unsupported sealed info: expected zeus-v1';
  END IF;

  -- 3. Non-empty string checks
  IF jsonb_typeof(p_secret_sealed->'eph_pub') <> 'string' OR coalesce(p_secret_sealed->>'eph_pub', '') = '' THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub must be a non-empty string';
  END IF;

  IF jsonb_typeof(p_secret_sealed->'nonce') <> 'string' OR coalesce(p_secret_sealed->>'nonce', '') = '' THEN
    RAISE EXCEPTION 'secret_sealed.nonce must be a non-empty string';
  END IF;

  IF jsonb_typeof(p_secret_sealed->'ct') <> 'string' OR coalesce(p_secret_sealed->>'ct', '') = '' THEN
    RAISE EXCEPTION 'secret_sealed.ct must be a non-empty string';
  END IF;

  -- 4. Reject embedded whitespace in base64 fields
  IF (p_secret_sealed->>'eph_pub') ~ '\s' THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub must not contain whitespace';
  END IF;

  IF (p_secret_sealed->>'nonce') ~ '\s' THEN
    RAISE EXCEPTION 'secret_sealed.nonce must not contain whitespace';
  END IF;

  IF (p_secret_sealed->>'ct') ~ '\s' THEN
    RAISE EXCEPTION 'secret_sealed.ct must not contain whitespace';
  END IF;

  -- 5. Decode envelope fields in exception-safe blocks
  BEGIN
    v_eph_pub_bytes := decode(p_secret_sealed->>'eph_pub', 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub is not valid base64: %', SQLERRM;
  END;

  BEGIN
    v_nonce_bytes := decode(p_secret_sealed->>'nonce', 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'secret_sealed.nonce is not valid base64: %', SQLERRM;
  END;

  BEGIN
    v_ct_bytes := decode(p_secret_sealed->>'ct', 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'secret_sealed.ct is not valid base64: %', SQLERRM;
  END;

  -- 6. Validate eph_pub: 65 bytes SEC1 uncompressed P-256 (prefix 0x04)
  IF octet_length(v_eph_pub_bytes) <> 65 OR get_byte(v_eph_pub_bytes, 0) <> 4 THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub must be 65-byte SEC1 uncompressed P-256 (got % bytes)',
      octet_length(v_eph_pub_bytes);
  END IF;

  -- 7. Validate nonce: exactly 12 bytes
  IF octet_length(v_nonce_bytes) <> 12 THEN
    RAISE EXCEPTION 'secret_sealed.nonce must be exactly 12 bytes (got % bytes)',
      octet_length(v_nonce_bytes);
  END IF;

  -- 8. Validate ct: at minimum 16 bytes for GCM authentication tag
  IF octet_length(v_ct_bytes) < 16 THEN
    RAISE EXCEPTION 'secret_sealed.ct must be at least 16 bytes for GCM authentication tag (got % bytes)',
      octet_length(v_ct_bytes);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_sealed_secret_envelope(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_sealed_secret_envelope(jsonb) TO authenticated;


-- ── 3. RPC create_game_account ────────────────────────────────────────────────
-- Concurrency-safe monotonic slot allocation using devices.next_slot_index.

DROP FUNCTION IF EXISTS public.create_game_account(uuid, text, text, jsonb, smallint, integer, jsonb);

CREATE OR REPLACE FUNCTION public.create_game_account(
  p_device_id       uuid,
  p_label           text,
  p_username        text,
  p_secret_sealed   jsonb,
  p_server_index    smallint,
  p_control_version integer,
  p_control         jsonb
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

REVOKE EXECUTE ON FUNCTION public.create_game_account(uuid, text, text, jsonb, smallint, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_game_account(uuid, text, text, jsonb, smallint, integer, jsonb) TO authenticated;


-- ── 4. RPC update_game_account ────────────────────────────────────────────────
-- Safe metadata & credential updates for existing accounts.
-- Preserves runtime, slot_index, control, desired_state, config_version, commands.

DROP FUNCTION IF EXISTS public.update_game_account(uuid, text, smallint, text, jsonb);

CREATE OR REPLACE FUNCTION public.update_game_account(
  p_account_id     uuid,
  p_label          text,
  p_server_index   smallint,
  p_username       text DEFAULT NULL,
  p_secret_sealed  jsonb DEFAULT NULL
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
    SET label         = trim(p_label),
        server_index  = p_server_index,
        username      = p_username,
        secret_sealed = p_secret_sealed,
        updated_at    = now()
    WHERE id = p_account_id;
  ELSE
    UPDATE public.accounts
    SET label         = trim(p_label),
        server_index  = p_server_index,
        updated_at    = now()
    WHERE id = p_account_id;
  END IF;

  RETURN p_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_game_account(uuid, text, smallint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_game_account(uuid, text, smallint, text, jsonb) TO authenticated;

-- =============================================================================
-- Migration 008: Account Creation Primitives
--
-- Primitives added:
-- 1. public.get_device_sealing_pubkey(p_device_id uuid) -> text
--    - Returns the authenticated owner's device public key as canonical
--      one-line standard RFC 4648 base64 (88 chars, SEC1 uncompressed P-256).
--    - Strips PostgreSQL RFC 2045 line wrapping (newlines/CR/spaces).
-- 2. public.create_game_account(...) -> uuid
--    - Atomically creates accounts + account_runtime rows.
--    - Locks device row FOR UPDATE to ensure concurrency-safe monotonic slot allocation.
--    - Validates caller ownership via auth.uid().
--    - Validates sealed envelope structure (alg, info, eph_pub, nonce, ct).
--    - Verifies device jar_ctl_version matches requested p_control_version.
--    - Initializes account in 'stopped' desired_state with no command issued.
-- =============================================================================

-- ── 1. RPC get_device_sealing_pubkey ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_device_sealing_pubkey(uuid);

CREATE OR REPLACE FUNCTION public.get_device_sealing_pubkey(
  p_device_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pubkey bytea;
  v_b64    text;
BEGIN
  -- 1. Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 2. Find device owned by authenticated caller
  SELECT pubkey
  INTO v_pubkey
  FROM public.devices
  WHERE id = p_device_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found or not owned by caller';
  END IF;

  -- 3. Device pubkey must not be NULL
  IF v_pubkey IS NULL THEN
    RAISE EXCEPTION 'device has no public key';
  END IF;

  -- 4. Validate stored pubkey: exactly 65 bytes SEC1 uncompressed (first byte 0x04)
  IF octet_length(v_pubkey) <> 65 OR get_byte(v_pubkey, 0) <> 4 THEN
    RAISE EXCEPTION 'device public key is not a valid 65-byte SEC1 uncompressed P-256 key';
  END IF;

  -- 5. Canonical standard base64, ONE LINE, no CR/LF/space
  -- PostgreSQL encode(bytea, 'base64') inserts newlines every 76 chars (RFC 2045).
  -- We strip all CR, LF, and whitespace to produce strict RFC 4648 one-line 88-char base64.
  v_b64 := replace(replace(replace(encode(v_pubkey, 'base64'), E'\r', ''), E'\n', ''), ' ', '');

  RETURN v_b64;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_device_sealing_pubkey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_device_sealing_pubkey(uuid) TO authenticated;


-- ── 2. RPC create_game_account ────────────────────────────────────────────────

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
  v_eph_pub_bytes          bytea;
  v_nonce_bytes            bytea;
  v_ct_bytes               bytea;
  v_max_slot               integer;
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

  IF p_secret_sealed IS NULL OR jsonb_typeof(p_secret_sealed) <> 'object' THEN
    RAISE EXCEPTION 'secret_sealed must be a JSON object';
  END IF;

  IF p_control IS NULL OR jsonb_typeof(p_control) <> 'object' THEN
    RAISE EXCEPTION 'control must be a JSON object';
  END IF;

  -- 3. Sealed envelope validation (reject malformed envelope before persistence)
  IF (p_secret_sealed->>'alg') IS DISTINCT FROM 'ecdh-p256-hkdf-sha256-aes256gcm' THEN
    RAISE EXCEPTION 'unsupported sealed algorithm: expected ecdh-p256-hkdf-sha256-aes256gcm';
  END IF;

  IF (p_secret_sealed->>'info') IS DISTINCT FROM 'zeus-v1' THEN
    RAISE EXCEPTION 'unsupported sealed info: expected zeus-v1';
  END IF;

  IF jsonb_typeof(p_secret_sealed->'eph_pub') <> 'string' OR coalesce(p_secret_sealed->>'eph_pub', '') = '' THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub must be a non-empty string';
  END IF;

  IF jsonb_typeof(p_secret_sealed->'nonce') <> 'string' OR coalesce(p_secret_sealed->>'nonce', '') = '' THEN
    RAISE EXCEPTION 'secret_sealed.nonce must be a non-empty string';
  END IF;

  IF jsonb_typeof(p_secret_sealed->'ct') <> 'string' OR coalesce(p_secret_sealed->>'ct', '') = '' THEN
    RAISE EXCEPTION 'secret_sealed.ct must be a non-empty string';
  END IF;

  -- Reject embedded whitespace in base64 fields
  IF (p_secret_sealed->>'eph_pub') ~ '\s' THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub must not contain whitespace';
  END IF;

  IF (p_secret_sealed->>'nonce') ~ '\s' THEN
    RAISE EXCEPTION 'secret_sealed.nonce must not contain whitespace';
  END IF;

  IF (p_secret_sealed->>'ct') ~ '\s' THEN
    RAISE EXCEPTION 'secret_sealed.ct must not contain whitespace';
  END IF;

  -- Decode envelope fields in exception-safe blocks
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

  -- Validate eph_pub: 65 bytes SEC1 uncompressed P-256 (prefix 0x04)
  IF octet_length(v_eph_pub_bytes) <> 65 OR get_byte(v_eph_pub_bytes, 0) <> 4 THEN
    RAISE EXCEPTION 'secret_sealed.eph_pub must be 65-byte SEC1 uncompressed P-256 (got % bytes)',
      octet_length(v_eph_pub_bytes);
  END IF;

  -- Validate nonce: exactly 12 bytes
  IF octet_length(v_nonce_bytes) <> 12 THEN
    RAISE EXCEPTION 'secret_sealed.nonce must be exactly 12 bytes (got % bytes)',
      octet_length(v_nonce_bytes);
  END IF;

  -- Validate ct: at minimum 16 bytes for GCM authentication tag
  IF octet_length(v_ct_bytes) < 16 THEN
    RAISE EXCEPTION 'secret_sealed.ct must be at least 16 bytes for GCM authentication tag (got % bytes)',
      octet_length(v_ct_bytes);
  END IF;

  -- 4. Target device lookup & exclusive row lock for slot allocation serialization
  SELECT pubkey, jar_ctl_version
  INTO v_device_pubkey, v_device_jar_ctl_version
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

  -- 6. Concurrency-safe monotonic slot allocation under device row lock
  SELECT coalesce(max(slot_index), -1)
  INTO v_max_slot
  FROM public.accounts
  WHERE device_id = p_device_id;

  IF v_max_slot >= 2147483647 THEN
    RAISE EXCEPTION 'slot_index integer overflow on device %', p_device_id;
  END IF;

  v_slot_index := v_max_slot + 1;

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

-- =============================================================================
-- Zeus Knight Cloud — Migration 005: Fix claim_device pgcrypto resolution
-- Run in: https://supabase.com/dashboard/project/wuyxkksihkmsmwuiuvdk/sql/new
--
-- Problem (observed on dashboard device claim):
--   PostgreSQL error 42883: function digest(bytea, unknown) does not exist
--
-- Root Cause:
--   The function `claim_device(code text)` is defined with `SECURITY DEFINER`
--   and `SET search_path = public`.
--   In Supabase, the `pgcrypto` extension is installed in schema `extensions`.
--   Because `search_path` only contains `public`, unqualified calls to
--   pgcrypto functions (`digest()`, `crypt()`, `gen_salt()`) cannot be resolved.
--
-- Fix:
--   1. Ensure `pgcrypto` extension is installed.
--   2. Explicitly qualify all pgcrypto functions with `extensions.`:
--      - extensions.digest(v_pubkey_bytes, 'sha256'::text)
--      - extensions.crypt(v_device_password, extensions.gen_salt('bf', 8))
--   3. Keep `SET search_path = public` to maintain security isolation.
--   4. Preserve exact function signature, return type, and grant model.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS public.claim_device(text, text, bytea);
DROP FUNCTION IF EXISTS public.claim_device(text);

CREATE OR REPLACE FUNCTION public.claim_device(code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id       uuid;
  v_pubkey_bytes    bytea;   -- read directly as BYTEA, no cast needed
  v_device_email    text;
  v_device_password text;
  v_auth_user_id    uuid;
BEGIN
  -- Find the unclaimed device.
  -- Read pubkey as BYTEA directly (it was stored as BYTEA by register_device).
  SELECT id, pubkey
  INTO v_device_id, v_pubkey_bytes
  FROM public.devices
  WHERE pair_code = code AND user_id IS NULL;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'pair code không hợp lệ hoặc đã được dùng';
  END IF;

  IF v_pubkey_bytes IS NULL THEN
    RAISE EXCEPTION 'claim_device: device has no pubkey (device_id=%)', v_device_id;
  END IF;

  -- Derive device credentials. Formula MUST match Rust pairing.rs sign_in_as_device:
  --   device_email    = 'device-' || device_id::text || '@zeus.internal'
  --   device_password = hex(sha256(pubkey_bytes))[0..32]
  -- The pubkey_bytes here are the raw SEC1 BYTEA, NOT the base64 string.
  -- pgcrypto functions must be schema-qualified (extensions.) because search_path is public.
  v_device_email    := 'device-' || v_device_id::text || '@zeus.internal';
  v_device_password := substring(encode(extensions.digest(v_pubkey_bytes, 'sha256'::text), 'hex') FROM 1 FOR 32);

  -- Create auth.users entry for the device (device gets its own JWT).
  v_auth_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    role,
    aud,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
  ) VALUES (
    v_auth_user_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    v_device_email,
    extensions.crypt(v_device_password, extensions.gen_salt('bf', 8)),
    now(),
    'authenticated',
    'authenticated',
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '{}'::jsonb
  )
  ON CONFLICT (email) DO UPDATE
    SET encrypted_password = EXCLUDED.encrypted_password
  RETURNING id INTO v_auth_user_id;

  -- Fallback if ON CONFLICT path didn't return id.
  IF v_auth_user_id IS NULL THEN
    SELECT id INTO v_auth_user_id FROM auth.users WHERE email = v_device_email;
  END IF;

  -- Assign owner + clear pair_code + set device_auth_id.
  UPDATE public.devices
  SET
    user_id        = auth.uid(),
    pair_code      = NULL,
    device_auth_id = v_auth_user_id,
    status         = 'offline'
  WHERE id = v_device_id;

  RETURN v_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_device(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_device(text) FROM anon;

-- ── Verification queries to run in Supabase SQL Editor ────────────────────────
--
-- 1. Verify pgcrypto extension schema:
--    SELECT e.extname, n.nspname AS schema_name
--    FROM pg_extension e
--    JOIN pg_namespace n ON n.oid = e.extnamespace
--    WHERE e.extname = 'pgcrypto';
--    Expected: pgcrypto | extensions
--
-- 2. Verify digest function signature:
--    SELECT n.nspname AS schema_name, p.proname, pg_get_function_identity_arguments(p.oid) AS args
--    FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE p.proname = 'digest';
--    Expected: extensions | digest | bytea, text
--
-- 3. Test direct digest call:
--    SELECT extensions.digest(convert_to('test', 'UTF8'), 'sha256'::text);
--    Expected: \x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
--
-- 4. Verify claim_device function definition and privileges:
--    SELECT routine_schema, routine_name, security_type
--    FROM information_schema.routines
--    WHERE routine_schema = 'public' AND routine_name = 'claim_device';
--    Expected: public | claim_device | DEFINER

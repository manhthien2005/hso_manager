-- =============================================================================
-- Zeus Knight Cloud — Migration 004: Fix pubkey BYTEA wire contract
-- Run in: https://supabase.com/dashboard/project/wuyxkksihkmsmwuiuvdk/sql/new
--
-- Problem (observed in Railway runtime logs 2026-09-18):
--   zeus-agent boots → calls register_device(pair_code, name, pubkey_b64)
--   Migration 003 register_device() INSERT used p_pubkey (TEXT) directly into
--   devices.pubkey (BYTEA) without calling decode().
--   PostgreSQL error: column "pubkey" is of type bytea but expression is of type text
--
-- Wire contract (MUST match pairing.rs exactly):
--   Rust:  BASE64_STANDARD.encode(&pubkey_bytes)  → TEXT, sent as JSON field
--   SQL param:  p_pubkey TEXT  (base64, standard alphabet, +/, padding =)
--   SQL stores: decode(p_pubkey, 'base64') → BYTEA
--   SQL compares: WHERE pubkey = decode(p_pubkey, 'base64')
--   claim_device: decode(v_pubkey, 'base64') when reading back
--
-- This migration replaces register_device() with the correct version.
-- claim_device() reads pubkey as BYTEA directly (no decode needed when reading).
-- =============================================================================

-- Ensure pgcrypto is available (needed by claim_device for crypt/digest).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── register_device (fix: decode base64 TEXT → BYTEA before INSERT) ──────────

DROP FUNCTION IF EXISTS public.register_device(text, text, text);

CREATE OR REPLACE FUNCTION public.register_device(
  p_pair_code   text,
  p_name        text,
  p_pubkey      text   -- base64-encoded SEC1 uncompressed P-256 (65 bytes → 88 base64 chars)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id    uuid;
  v_pubkey_bytes bytea;
BEGIN
  -- ── Decode and validate pubkey ──────────────────────────────────────────────
  -- p_pubkey is base64 TEXT (sent by Rust BASE64_STANDARD.encode).
  -- PostgreSQL cannot implicitly cast text → bytea; decode() is required.
  BEGIN
    v_pubkey_bytes := decode(p_pubkey, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'register_device: p_pubkey is not valid base64: %', SQLERRM;
  END;

  -- SEC1 uncompressed P-256 must be exactly 65 bytes starting with 0x04.
  IF octet_length(v_pubkey_bytes) <> 65 OR get_byte(v_pubkey_bytes, 0) <> 4 THEN
    RAISE EXCEPTION
      'register_device: pubkey must be 65-byte SEC1 uncompressed P-256 '
      '(got % bytes, first byte 0x%)',
      octet_length(v_pubkey_bytes), to_hex(get_byte(v_pubkey_bytes, 0));
  END IF;

  -- ── Idempotent: same pair_code → update pubkey and return existing id ───────
  -- Required for Railway redeploys: the same RAILWAY_SERVICE_ID produces the
  -- same HKDF pair_code. The agent must be able to re-register without error.
  SELECT id INTO v_device_id
  FROM public.devices
  WHERE pair_code = p_pair_code;

  IF v_device_id IS NOT NULL THEN
    UPDATE public.devices
       SET pubkey    = v_pubkey_bytes,
           name      = p_name,
           last_seen = now()
     WHERE id = v_device_id;
    RETURN v_device_id;
  END IF;

  -- ── New device ──────────────────────────────────────────────────────────────
  INSERT INTO public.devices (pair_code, name, pubkey, status, last_seen)
  VALUES (p_pair_code, p_name, v_pubkey_bytes, 'offline', now())
  RETURNING id INTO v_device_id;

  RETURN v_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_device(text, text, text) TO anon, authenticated;

-- ── Verify claim_device pubkey decode path ────────────────────────────────────
-- claim_device in migration 003 reads devices.pubkey as TEXT via ::text cast,
-- then decodes it as base64 OR hex with a try/catch fallback.
-- That fallback is ambiguous and wrong: pubkey in the DB is BYTEA already.
-- Reading BYTEA as ::text gives Postgres hex format (\x04...) which decode('base64')
-- will fail, falling through to decode('hex') which also fails (\x prefix).
-- Fix: read pubkey directly as BYTEA (no cast needed), since it is already BYTEA.

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
  v_device_email    := 'device-' || v_device_id::text || '@zeus.internal';
  v_device_password := substring(encode(digest(v_pubkey_bytes, 'sha256'), 'hex') FROM 1 FOR 32);

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
    crypt(v_device_password, gen_salt('bf', 8)),
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

-- ── Manual verification steps ─────────────────────────────────────────────────
--
-- After running this migration in Supabase SQL Editor:
--
-- 1. Test register_device with valid base64 SEC1 P-256 pubkey:
--    SELECT public.register_device(
--      'TESTABCD',
--      'test-node',
--      encode(decode('04' || repeat('ab', 32) || repeat('cd', 32), 'hex'), 'base64')
--    );
--    → Must return a UUID, no error.
--
-- 2. Test idempotency (same pair_code → same UUID):
--    SELECT public.register_device(
--      'TESTABCD', 'test-node-2',
--      encode(decode('04' || repeat('ab', 32) || repeat('cd', 32), 'hex'), 'base64')
--    );
--    → Must return the SAME UUID as step 1.
--
-- 3. Test bad base64:
--    SELECT public.register_device('BADTEST1', 'x', 'not-valid-base64!!!');
--    → Must raise: 'register_device: p_pubkey is not valid base64'
--
-- 4. Test wrong key size (not 65 bytes):
--    SELECT public.register_device('BADTEST2', 'x', encode('short'::bytea, 'base64'));
--    → Must raise: 'pubkey must be 65-byte SEC1 uncompressed P-256'
--
-- 5. Test wrong first byte (not 0x04):
--    SELECT public.register_device('BADTEST3', 'x',
--      encode(decode('03' || repeat('00', 64), 'hex'), 'base64'));
--    → Must raise: 'pubkey must be 65-byte SEC1 uncompressed P-256 ... first byte 0x3'
--
-- 6. Verify pubkey is stored as BYTEA (not text):
--    SELECT octet_length(pubkey), get_byte(pubkey, 0)
--    FROM public.devices WHERE pair_code = 'TESTABCD';
--    → 65, 4
--
-- 7. Clean up:
--    DELETE FROM public.devices WHERE pair_code LIKE 'TEST%' OR pair_code LIKE 'BAD%';

-- ── IMPORTANT: do NOT grant anonymous SELECT on public.devices ────────────────
--
-- After register_device succeeds, the agent (zeus-agent/src/pairing.rs) uses
-- sign_in_as_device() to detect when the device has been claimed — NOT a direct
-- SELECT on the devices table.
--
-- Old broken path (REMOVED from pairing.rs):
--   GET /rest/v1/devices?id=eq.{id}&select=user_id   ← anon key, no JWT
--   → 401 permission denied for table devices         ← RLS own_devices blocks it
--
-- New path (pairing.rs attempt_sign_in()):
--   POST /auth/v1/token?grant_type=password
--   → 400/422 invalid_grant = not yet claimed, wait silently
--   → JWT = claim_device() has run, device auth.users entry exists
--
-- Verify table grants have NOT been widened:
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'devices'
--   ORDER BY grantee, privilege_type;
--
-- Expected: anon should NOT have SELECT on public.devices.
-- If it does, remove it: REVOKE SELECT ON public.devices FROM anon;

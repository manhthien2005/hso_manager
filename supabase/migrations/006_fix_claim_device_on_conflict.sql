-- =============================================================================
-- Zeus Knight Cloud — Migration 006: Fix claim_device auth.users ON CONFLICT error
-- Run in: https://supabase.com/dashboard/project/wuyxkksihkmsmwuiuvdk/sql/new
--
-- Problem (observed on dashboard device claim):
--   PostgreSQL error 42P10: there is no unique or exclusion constraint matching
--   the ON CONFLICT specification
--
-- Root Cause:
--   In `claim_device(code text)`, the statement:
--     INSERT INTO auth.users (...) VALUES (...)
--     ON CONFLICT (email) DO UPDATE ...
--   targets `(email)` on table `auth.users`.
--   In Supabase, `auth.users` does NOT have an unconditional UNIQUE (email)
--   constraint. Instead, it uses a partial unique index `users_email_partial_key`
--   with predicate `WHERE (is_sso_user = false)`.
--   PostgreSQL rejects `ON CONFLICT (email)` because it does not match any
--   unconditional unique constraint or index.
--
-- Fix:
--   Replace the `ON CONFLICT (email)` clause with an explicit check-and-update:
--   1. Check if an auth.users entry with `email = v_device_email` exists.
--   2. If exists: UPDATE encrypted_password and updated_at.
--   3. If not: INSERT new auth.users record (with EXCEPTION WHEN unique_violation
--      fallback for complete race-condition safety).
--   Preserves all existing security definer settings, search_path, and grants.
-- =============================================================================

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
  -- pgcrypto functions are schema-qualified with extensions.
  v_device_email    := 'device-' || v_device_id::text || '@zeus.internal';
  v_device_password := substring(encode(extensions.digest(v_pubkey_bytes, 'sha256'::text), 'hex') FROM 1 FOR 32);

  -- Check if auth.users entry already exists for this device email
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = v_device_email;

  IF v_auth_user_id IS NOT NULL THEN
    -- Device user already exists in auth.users: update password
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(v_device_password, extensions.gen_salt('bf', 8)),
        updated_at         = now()
    WHERE id = v_auth_user_id;
  ELSE
    -- Device user does not exist: insert new record
    v_auth_user_id := gen_random_uuid();
    BEGIN
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
      );
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_auth_user_id FROM auth.users WHERE email = v_device_email;
      UPDATE auth.users
      SET encrypted_password = extensions.crypt(v_device_password, extensions.gen_salt('bf', 8)),
          updated_at         = now()
      WHERE id = v_auth_user_id;
    END;
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

-- ── Verification queries ──────────────────────────────────────────────────────
--
-- 1. Verify index on auth.users (confirming partial index):
--    SELECT indexname, indexdef
--    FROM pg_indexes
--    WHERE schemaname = 'auth' AND tablename = 'users' AND indexname LIKE '%email%';
--
-- 2. Verify claim_device definition:
--    SELECT pg_get_functiondef(p.oid)
--    FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'claim_device';

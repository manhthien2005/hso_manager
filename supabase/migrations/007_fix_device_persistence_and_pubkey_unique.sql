-- =============================================================================
-- Migration 007: Fix Device Persistence & Enforce Pubkey Uniqueness
--
-- PROBLEM:
-- Railway redeploys run on ephemeral container filesystems where /opt/knight/state/device.json
-- is lost. When the agent reboots, it deterministically recomputes the same pubkey
-- from RAILWAY_SERVICE_ID and calls register_device().
-- Previously, register_device() only checked:
--     SELECT id FROM public.devices WHERE pair_code = p_pair_code;
-- Since claim_device() clears pair_code (sets to NULL) upon first claim, this query
-- never matched an already-claimed device. As public.devices lacked a UNIQUE(pubkey)
-- constraint, register_device() inserted a BRAND NEW row with a new UUID and NULL user_id.
-- This produced duplicate device rows for the same physical node, orphaned existing
-- accounts, forced the user to pair again, and created duplicate auth.users accounts.
--
-- FIXES IN THIS MIGRATION:
-- 1. One-time data cleanup: Safely merge and delete duplicate device B
--    (e0169137-4dc4-455a-b88c-b6fdefd4cf64) into canonical device A
--    (7f73369a-b97a-4c4d-b12e-f51253c428a7) and remove duplicate auth user.
-- 2. Enforce UNIQUE (pubkey) constraint on public.devices.
-- 3. Replace register_device() to match by pubkey FIRST, returning existing device_id
--    and preserving user_id / device_auth_id / claim state.
-- 4. Replace claim_device() to ensure all GoTrue token string columns in auth.users
--    are empty strings ('') rather than NULL to prevent Go scan errors.
-- =============================================================================

-- ── 1. One-Time Production Data Cleanup ──────────────────────────────────────

DO $$
DECLARE
  v_canonical_id uuid := '7f73369a-b97a-4c4d-b12e-f51253c428a7'::uuid;
  v_duplicate_id uuid := 'e0169137-4dc4-455a-b88c-b6fdefd4cf64'::uuid;
  v_dup_auth_id  uuid := 'ae5d3d99-d9d1-43ab-a9a3-12ba9723a8f6'::uuid;
BEGIN
  -- A. Migrate accounts from duplicate to canonical if slot is available
  IF EXISTS (SELECT 1 FROM public.devices WHERE id = v_duplicate_id) THEN
    UPDATE public.accounts
    SET device_id = v_canonical_id
    WHERE device_id = v_duplicate_id
      AND slot_index NOT IN (
        SELECT slot_index FROM public.accounts WHERE device_id = v_canonical_id
      );

    -- Delete any conflicting/remaining duplicate accounts on duplicate device
    DELETE FROM public.accounts
    WHERE device_id = v_duplicate_id;

    -- B. Migrate commands from duplicate to canonical
    UPDATE public.commands
    SET device_id = v_canonical_id
    WHERE device_id = v_duplicate_id;

    -- C. Delete the duplicate device row
    DELETE FROM public.devices
    WHERE id = v_duplicate_id;

    RAISE NOTICE 'Deleted duplicate device % and migrated references to canonical %',
      v_duplicate_id, v_canonical_id;
  END IF;

  -- D. Delete duplicate auth user created during accidental second pair
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_dup_auth_id) THEN
    DELETE FROM auth.users
    WHERE id = v_dup_auth_id
      AND email = 'device-e0169137-4dc4-455a-b88c-b6fdefd4cf64@zeus.internal';
    RAISE NOTICE 'Deleted duplicate device auth user %', v_dup_auth_id;
  END IF;

  -- E. General deduplication fallback: if any other duplicate pubkeys exist,
  -- keep the oldest row and remove younger empty duplicates.
  DELETE FROM public.devices d
  WHERE d.pubkey IS NOT NULL
    AND d.id NOT IN (
      SELECT DISTINCT ON (pubkey) id
      FROM public.devices
      WHERE pubkey IS NOT NULL
      ORDER BY pubkey, created_at ASC
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.device_id = d.id
    );
END $$;


-- ── 2. Enforce UNIQUE (pubkey) on public.devices ──────────────────────────────

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_pubkey_key,
  DROP CONSTRAINT IF EXISTS devices_pubkey_unique;

ALTER TABLE public.devices
  ADD CONSTRAINT devices_pubkey_unique UNIQUE (pubkey);


-- ── 3. Replace register_device (Idempotent by Pubkey) ──────────────────────────

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
  -- ── A. Decode and validate pubkey ──────────────────────────────────────────
  BEGIN
    v_pubkey_bytes := decode(p_pubkey, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'register_device: p_pubkey is not valid base64: %', SQLERRM;
  END;

  IF octet_length(v_pubkey_bytes) <> 65 OR get_byte(v_pubkey_bytes, 0) <> 4 THEN
    RAISE EXCEPTION
      'register_device: pubkey must be 65-byte SEC1 uncompressed P-256 (got % bytes, first byte 0x%)',
      octet_length(v_pubkey_bytes), to_hex(get_byte(v_pubkey_bytes, 0));
  END IF;

  -- ── B. Check if device with this pubkey already exists ──────────────────────
  -- INVARIANT: ONE PUBKEY = ONE LOGICAL DEVICE.
  -- When an existing node reboots / redeploys, return the canonical device_id.
  -- CRITICAL: Never overwrite user_id or device_auth_id on existing devices!
  SELECT id INTO v_device_id
  FROM public.devices
  WHERE pubkey = v_pubkey_bytes
  LIMIT 1;

  IF v_device_id IS NOT NULL THEN
    UPDATE public.devices
       SET name      = p_name,
           last_seen = now()
     WHERE id = v_device_id;
    RETURN v_device_id;
  END IF;

  -- ── C. Insert new device with concurrency-safe ON CONFLICT ─────────────────
  INSERT INTO public.devices (pair_code, name, pubkey, status, last_seen)
  VALUES (p_pair_code, p_name, v_pubkey_bytes, 'offline', now())
  ON CONFLICT (pubkey) DO UPDATE
    SET name      = excluded.name,
        last_seen = now()
  RETURNING id INTO v_device_id;

  RETURN v_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_device(text, text, text) TO anon, authenticated;


-- ── 4. Replace claim_device (GoTrue Auth Compatibility) ────────────────────────

DROP FUNCTION IF EXISTS public.claim_device(text);

CREATE OR REPLACE FUNCTION public.claim_device(code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id       uuid;
  v_pubkey_bytes    bytea;
  v_device_email    text;
  v_device_password text;
  v_auth_user_id    uuid;
BEGIN
  -- Find the unpaired device by pair code.
  SELECT id, pubkey INTO v_device_id, v_pubkey_bytes
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
  v_device_email    := 'device-' || v_device_id::text || '@zeus.internal';
  v_device_password := substring(encode(extensions.digest(v_pubkey_bytes, 'sha256'::text), 'hex') FROM 1 FOR 32);

  -- Check if auth.users entry already exists for this device email
  SELECT id INTO v_auth_user_id
  FROM auth.users
  WHERE email = v_device_email;

  IF v_auth_user_id IS NOT NULL THEN
    -- Device user already exists in auth.users: update password and sanitize tokens
    UPDATE auth.users
    SET encrypted_password        = extensions.crypt(v_device_password, extensions.gen_salt('bf', 8)),
        confirmation_token        = coalesce(confirmation_token, ''),
        recovery_token            = coalesce(recovery_token, ''),
        email_change_token_new    = coalesce(email_change_token_new, ''),
        email_change_token_current= coalesce(email_change_token_current, ''),
        email_change              = coalesce(email_change, ''),
        phone_change              = coalesce(phone_change, ''),
        phone_change_token        = coalesce(phone_change_token, ''),
        updated_at                = now()
    WHERE id = v_auth_user_id;
  ELSE
    -- Device user does not exist: insert new record with full GoTrue compatibility.
    -- All token string columns MUST be '' (empty string), NOT NULL, to prevent Go gotrue
    -- sql scan errors ("converting NULL to string is unsupported").
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
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change,
        email_change_token_current,
        phone_change,
        phone_change_token,
        is_sso_user,
        is_anonymous,
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
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        false,
        false,
        now(),
        now(),
        jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
        '{}'::jsonb
      );
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_auth_user_id FROM auth.users WHERE email = v_device_email;
      UPDATE auth.users
      SET encrypted_password        = extensions.crypt(v_device_password, extensions.gen_salt('bf', 8)),
          confirmation_token        = coalesce(confirmation_token, ''),
          recovery_token            = coalesce(recovery_token, ''),
          email_change_token_new    = coalesce(email_change_token_new, ''),
          email_change_token_current= coalesce(email_change_token_current, ''),
          email_change              = coalesce(email_change, ''),
          phone_change              = coalesce(phone_change, ''),
          phone_change_token        = coalesce(phone_change_token, ''),
          updated_at                = now()
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


-- ── 5. Verification Queries ───────────────────────────────────────────────────
--
-- Check uniqueness of pubkeys (must return 0 rows):
-- SELECT encode(pubkey, 'hex') as pubkey_hex, count(*), array_agg(id)
-- FROM public.devices
-- WHERE pubkey IS NOT NULL
-- GROUP BY pubkey
-- HAVING count(*) > 1;
--
-- Verify the target canonical device row:
-- SELECT id, user_id, device_auth_id, pair_code, status
-- FROM public.devices
-- WHERE pubkey = decode('046936e7abc2e158da0064436d74ce2f311cd857721faf3a7bcba365482c546cc641e086d8c36fe808114f0d222a623e07543042d05a0fec568a19ab6713b0f60d', 'hex');
--
-- Check unique constraint:
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.devices'::regclass AND conname = 'devices_pubkey_unique';

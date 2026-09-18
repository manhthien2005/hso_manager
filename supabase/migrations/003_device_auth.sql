-- =============================================================================
-- Zeus Knight Cloud — Device Auth (Migration 003)
-- Run trong: https://supabase.com/dashboard/project/wuyxkksihkmsmwuiuvdk/sql/new
--
-- Mục tiêu:
--   - Thêm cột devices.device_auth_id (UUID auth.users của device, không phải của owner)
--   - Cập nhật claim_device RPC: tạo auth.users cho device lúc pair
--   - Cập nhật RLS: agent dùng JWT của chính nó, không cần dùng JWT của owner
-- =============================================================================

-- 1. Thêm cột lưu auth_user_id của device (để RLS nhận ra device)
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_auth_id uuid;

-- 2. Cần pgcrypto để hash pubkey → password
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3. Cập nhật RLS policies để device tự đọc/ghi row của mình ─────────────────

-- devices: owner thấy device của mình; device thấy row của chính nó
DROP POLICY IF EXISTS own_devices ON public.devices;
CREATE POLICY own_devices ON public.devices
  USING (
    user_id = auth.uid()               -- owner: thấy toàn bộ device của mình
    OR device_auth_id = auth.uid()     -- agent: chỉ thấy row của chính nó
  )
  WITH CHECK (
    user_id = auth.uid()
    OR device_auth_id = auth.uid()
  );

-- accounts: owner thấy; agent thấy account thuộc device của nó
DROP POLICY IF EXISTS own_accounts ON public.accounts;
CREATE POLICY own_accounts ON public.accounts
  USING (
    user_id = auth.uid()               -- owner
    OR device_id = (                   -- agent: lấy device_id từ JWT của nó
      SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR device_id = (
      SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
    )
  );

-- account_runtime: agent ghi telemetry; owner đọc
DROP POLICY IF EXISTS own_runtime ON public.account_runtime;
CREATE POLICY own_runtime ON public.account_runtime
  USING (
    account_id IN (
      SELECT id FROM public.accounts WHERE user_id = auth.uid()         -- owner
      UNION
      SELECT id FROM public.accounts WHERE device_id = (                -- agent
        SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    account_id IN (
      SELECT id FROM public.accounts WHERE user_id = auth.uid()
      UNION
      SELECT id FROM public.accounts WHERE device_id = (
        SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
      )
    )
  );

-- commands: agent drain + ack; owner insert
DROP POLICY IF EXISTS own_commands ON public.commands;
CREATE POLICY own_commands ON public.commands
  USING (
    device_id IN (
      SELECT id FROM public.devices WHERE user_id = auth.uid()          -- owner
      UNION
      SELECT id FROM public.devices WHERE device_auth_id = auth.uid()  -- agent
    )
  )
  WITH CHECK (
    device_id IN (
      SELECT id FROM public.devices WHERE user_id = auth.uid()
      UNION
      SELECT id FROM public.devices WHERE device_auth_id = auth.uid()
    )
  );

-- 4. Cập nhật grant cho authenticated (đã có nhưng cần update sau schema change)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_runtime TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commands        TO authenticated;

-- 5. Cập nhật claim_device RPC ─────────────────────────────────────────────────
--
-- Flow mới:
--   Agent boot → POST /devices (pair_code, name, pubkey) → device row tạo ra, user_id=NULL
--   Web user nhập pair_code → gọi claim_device(code)
--   RPC: tìm device, tạo auth.users cho device, gán user_id=owner, gán device_auth_id
--   Agent poll check_device_claimed → true
--   Agent derive email/password từ keypair → signIn → có JWT
--
-- Password formula (phải khớp chính xác với Rust trong pairing.rs):
--   device_email    = 'device-' || device_id::text || '@zeus.internal'
--   device_password = substring(encode(digest(pubkey, 'sha256'), 'hex') FROM 1 FOR 32)
--
DROP FUNCTION IF EXISTS public.claim_device(text, text, bytea);
DROP FUNCTION IF EXISTS public.claim_device(text);

CREATE OR REPLACE FUNCTION public.claim_device(code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device_id      uuid;
  v_pubkey         text;   -- base64 của SEC1 uncompressed 65 bytes
  v_pubkey_bytes   bytea;
  v_device_email   text;
  v_device_password text;
  v_auth_user_id   uuid;
BEGIN
  -- Tìm device chưa pair
  SELECT id, pubkey::text
  INTO v_device_id, v_pubkey
  FROM public.devices
  WHERE pair_code = code AND user_id IS NULL;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'pair code không hợp lệ hoặc đã được dùng';
  END IF;

  -- Decode pubkey từ base64 → bytes
  BEGIN
    v_pubkey_bytes := decode(v_pubkey, 'base64');
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: thử xem pubkey có phải hex không
    v_pubkey_bytes := decode(v_pubkey, 'hex');
  END;

  -- Tính credentials cho device (phải khớp với Rust pairing.rs)
  v_device_email    := 'device-' || v_device_id::text || '@zeus.internal';
  v_device_password := substring(encode(digest(v_pubkey_bytes, 'sha256'), 'hex') FROM 1 FOR 32);

  -- Tạo auth.users cho device
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

  -- Nếu ON CONFLICT không trả về id, lấy lại
  IF v_auth_user_id IS NULL THEN
    SELECT id INTO v_auth_user_id FROM auth.users WHERE email = v_device_email;
  END IF;

  -- Gán owner + xoá pair_code + gán device_auth_id
  UPDATE public.devices
  SET
    user_id        = auth.uid(),
    pair_code      = NULL,           -- xoá code sau khi dùng
    device_auth_id = v_auth_user_id,
    status         = 'offline'
  WHERE id = v_device_id;

  RETURN v_device_id;
END;
$$;

-- Grant execute cho authenticated (web user gọi RPC này)
GRANT EXECUTE ON FUNCTION public.claim_device(text) TO authenticated;
-- anon không cần gọi nữa (agent pre-registers device trước khi pair)
REVOKE EXECUTE ON FUNCTION public.claim_device(text) FROM anon;

-- 6. RPC register_device cho agent (anon, trước khi có session) ─────────────────
--
-- Agent gọi: POST /rest/v1/rpc/register_device
-- Params: p_pair_code text, p_name text, p_pubkey text (base64 SEC1 uncompressed 65 bytes)
--
-- Wire contract (phải khớp chính xác với Rust pairing.rs):
--   Rust sends:  BASE64_STANDARD.encode(pubkey_bytes)   → TEXT in JSON body
--   SQL receives: p_pubkey TEXT
--   SQL converts: decode(p_pubkey, 'base64') → BYTEA, stored in devices.pubkey
--   All comparisons: decode(p_pubkey, 'base64') — never cast TEXT directly to BYTEA
--
-- Idempotent: cùng pair_code → trả lại uuid cũ và update pubkey (redeploy an toàn).
-- SECURITY DEFINER để anon insert được vào devices (bình thường bị RLS chặn).

DROP FUNCTION IF EXISTS public.register_device(text, text, text);

CREATE OR REPLACE FUNCTION public.register_device(
  p_pair_code   text,
  p_name        text,
  p_pubkey      text   -- base64-encoded SEC1 uncompressed P-256 (65 bytes → 88 chars base64)
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
  -- ── Decode and validate pubkey ────────────────────────────────────────────
  -- p_pubkey is base64 TEXT (sent by Rust's BASE64_STANDARD.encode).
  -- PostgreSQL CANNOT implicitly cast text → bytea; we must call decode() explicitly.
  BEGIN
    v_pubkey_bytes := decode(p_pubkey, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'register_device: p_pubkey is not valid base64: %', SQLERRM;
  END;

  -- SEC1 uncompressed P-256 is always 65 bytes, starting with 0x04.
  IF octet_length(v_pubkey_bytes) <> 65 OR get_byte(v_pubkey_bytes, 0) <> 4 THEN
    RAISE EXCEPTION 'register_device: pubkey must be 65-byte SEC1 uncompressed P-256 (got % bytes, first byte 0x%)',
      octet_length(v_pubkey_bytes), to_hex(get_byte(v_pubkey_bytes, 0));
  END IF;

  -- ── Idempotent: same pair_code → return existing device ──────────────────
  -- Needed for Railway redeploy: agent boots, pair_code already registered,
  -- no need to fail. Update pubkey in case RAILWAY_SERVICE_ID changed.
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

  -- ── New device ─────────────────────────────────────────────────────────────
  INSERT INTO public.devices (pair_code, name, pubkey, status, last_seen)
  VALUES (p_pair_code, p_name, v_pubkey_bytes, 'offline', now())
  RETURNING id INTO v_device_id;

  RETURN v_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_device(text, text, text) TO anon, authenticated;

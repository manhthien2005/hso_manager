-- =============================================================================
-- Migration 011: Farm Spot Presets Schema (Round R3A1)
--
-- Features:
-- 1. public.farm_spots:
--    - Reusable, user-owned monster-farming spot presets library.
--    - Decoupled from accounts, devices, and Control v13 runtime settings.
--    - Ownership bound strictly to auth.users(id) with ON DELETE CASCADE.
--
-- 2. Integrity & Database Constraints:
--    - map_id: clamped to valid game map range 0..255.
--    - x, y: world pixel coordinates required non-negative (>= 0).
--    - captured_zone: optional captured zone metadata (-1..127).
--    - source: provenance allowlist ('manual', 'detected', 'imported').
--    - name: non-empty trimmed text (1..48 chars).
--
-- 3. Case-Insensitive Normalized Name Uniqueness:
--    - Enforced via unique expression index on (user_id, map_id, lower(btrim(name))).
--    - Names differing only by leading/trailing whitespace or letter casing collide.
--    - Duplicate coordinates with different names are explicitly allowed.
--
-- 4. Database Timestamp & Normalization Authority:
--    - created_at: default now() on insert.
--    - updated_at: maintained by BEFORE UPDATE trigger function.
--    - name: normalized via btrim(name) on BEFORE INSERT OR UPDATE trigger.
--
-- 5. Row Level Security & Grants:
--    - RLS enabled; explicit SELECT, INSERT, UPDATE, DELETE policies bound to auth.uid().
--    - Granted to 'authenticated' role only; revoked from anon/PUBLIC.
-- =============================================================================

-- ── 1. Table public.farm_spots ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.farm_spots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  map_id        smallint NOT NULL,
  x             integer NOT NULL,
  y             integer NOT NULL,
  captured_zone smallint NOT NULL DEFAULT -1,
  source        text NOT NULL DEFAULT 'manual',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT farm_spots_name_trimmed_not_empty CHECK (char_length(btrim(name)) >= 1),
  CONSTRAINT farm_spots_name_trimmed_max_length CHECK (char_length(btrim(name)) <= 48),
  CONSTRAINT farm_spots_map_id_range CHECK (map_id >= 0 AND map_id <= 255),
  CONSTRAINT farm_spots_x_non_negative CHECK (x >= 0),
  CONSTRAINT farm_spots_y_non_negative CHECK (y >= 0),
  CONSTRAINT farm_spots_captured_zone_range CHECK (captured_zone >= -1 AND captured_zone <= 127),
  CONSTRAINT farm_spots_source_allowed CHECK (source IN ('manual', 'detected', 'imported'))
);

-- ── 2. Unique Normalized Index ───────────────────────────────────────────────
-- Enforces case-insensitive, whitespace-trimmed uniqueness per user and map.
-- Also serves as the primary B-tree lookup index for user_id and (user_id, map_id) queries.

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_spots_user_map_name_unique
  ON public.farm_spots (user_id, map_id, lower(btrim(name)));

-- ── 3. Normalization & Timestamp Trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.farm_spots_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Normalize name by trimming leading and trailing whitespace
  NEW.name := btrim(NEW.name);

  -- Maintain database updated_at authority on updates
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_farm_spots_before_write ON public.farm_spots;

CREATE TRIGGER trg_farm_spots_before_write
  BEFORE INSERT OR UPDATE ON public.farm_spots
  FOR EACH ROW
  EXECUTE FUNCTION public.farm_spots_before_write();

-- ── 4. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.farm_spots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_farm_spots_select ON public.farm_spots;
CREATE POLICY own_farm_spots_select ON public.farm_spots
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS own_farm_spots_insert ON public.farm_spots;
CREATE POLICY own_farm_spots_insert ON public.farm_spots
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS own_farm_spots_update ON public.farm_spots;
CREATE POLICY own_farm_spots_update ON public.farm_spots
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS own_farm_spots_delete ON public.farm_spots;
CREATE POLICY own_farm_spots_delete ON public.farm_spots
  FOR DELETE
  USING (user_id = auth.uid());

-- ── 5. Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON TABLE public.farm_spots FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.farm_spots TO authenticated;

REVOKE EXECUTE ON FUNCTION public.farm_spots_before_write() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.farm_spots_before_write() TO authenticated;

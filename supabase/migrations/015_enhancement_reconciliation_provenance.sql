-- =============================================================================
-- Migration 015: Enhancement Queue Non-Replay State Reconciliation Provenance
-- Task: ENHANCE-05M-RESULT-CAPTURE-AND-STATE-RECONCILIATION-CORRECTIVE
--
-- Features:
-- 1. Provenance metadata columns on public.enhancement_queue_items:
--    - settlement_source text: 'RESULT_CODE' | 'STATE_RECONCILED'
--    - reconciled_at timestamptz
--    - reconciliation_reason text (max 500 chars)
-- =============================================================================

-- ── 1. Add Provenance Metadata Columns ──────────────────────────────────────

ALTER TABLE public.enhancement_queue_items
  ADD COLUMN IF NOT EXISTS settlement_source text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enhancement_queue_items_settlement_source_check'
  ) THEN
    ALTER TABLE public.enhancement_queue_items
      ADD CONSTRAINT enhancement_queue_items_settlement_source_check
      CHECK (settlement_source IS NULL OR settlement_source IN ('RESULT_CODE', 'STATE_RECONCILED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enhancement_queue_items_reconciliation_reason_length_check'
  ) THEN
    ALTER TABLE public.enhancement_queue_items
      ADD CONSTRAINT enhancement_queue_items_reconciliation_reason_length_check
      CHECK (reconciliation_reason IS NULL OR char_length(reconciliation_reason) <= 500);
  END IF;
END $$;

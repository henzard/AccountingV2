-- 009_sinking_funds.sql
-- Add sinking fund target columns to envelopes table.
-- Both columns are nullable; non-null only when envelope_type = 'sinking_fund'.

ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS target_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS target_date TEXT; -- ISO date YYYY-MM-DD

-- Update envelope_type constraint to include 'sinking_fund'
ALTER TABLE public.envelopes
  DROP CONSTRAINT IF EXISTS envelopes_envelope_type_check;
ALTER TABLE public.envelopes
  ADD CONSTRAINT envelopes_envelope_type_check
  CHECK (envelope_type IN ('spending','savings','emergency_fund','baby_step','utility','income','sinking_fund'));

-- Update merge_envelope RPC to include the new columns.
CREATE OR REPLACE FUNCTION public.merge_envelope(r public.envelopes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid()::text;
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = r.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', r.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.envelopes (
    id, household_id, name, allocated_cents, spent_cents,
    envelope_type, is_savings_locked, is_archived, period_start,
    target_amount_cents, target_date,
    created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.name, r.allocated_cents, r.spent_cents,
    r.envelope_type, r.is_savings_locked, r.is_archived, r.period_start,
    r.target_amount_cents, r.target_date,
    r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      name                = EXCLUDED.name,
      allocated_cents     = EXCLUDED.allocated_cents,
      spent_cents         = EXCLUDED.spent_cents,
      envelope_type       = EXCLUDED.envelope_type,
      is_savings_locked   = EXCLUDED.is_savings_locked,
      is_archived         = EXCLUDED.is_archived,
      period_start        = EXCLUDED.period_start,
      target_amount_cents = EXCLUDED.target_amount_cents,
      target_date         = EXCLUDED.target_date,
      updated_at          = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= envelopes.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_envelope(public.envelopes) TO authenticated;

-- Migration 003: Baby Steps columns + income envelope support
--
-- Context:
--   - public.baby_steps table was created in 001_initial_schema.sql without
--     is_manual and celebrated_at columns. This migration adds those columns.
--   - RLS for baby_steps was already enabled in 002_rls_policies.sql; no change needed.
--   - envelope_type in public.envelopes is an unconstrained TEXT column (no CHECK
--     constraint in 001_initial_schema.sql), so adding 'income' requires no DDL change.
--     The TypeScript union is the sole enforcement point for allowed values.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add new columns to public.baby_steps (idempotent via IF NOT EXISTS guard)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.baby_steps
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.baby_steps
  ADD COLUMN IF NOT EXISTS celebrated_at TEXT;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Unique index on (household_id, step_number)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_baby_steps_household_step
  ON public.baby_steps (household_id, step_number);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. envelope_type check constraint
--    The existing remote schema uses an unconstrained TEXT column for
--    envelope_type, so no drop/re-add is required. This comment serves as the
--    explicit no-op declaration required by the spec.
-- ──────────────────────────────────────────────────────────────────────────────
-- No-op: envelope_type has no CHECK constraint on the remote; 'income' is valid
-- as-is. The TypeScript EnvelopeType union is the sole type-narrowing boundary.

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. merge_baby_step RPC
--    Performs an UPSERT with celebrated_at preservation:
--      - If the incoming row has celebrated_at IS NULL but the existing row has
--        celebrated_at IS NOT NULL, keep the existing stamp (one-shot for life).
--      - LWW on updated_at for all other columns.
--
--    Security note (CRITICAL-3 fix):
--      The function is SECURITY DEFINER so it can bypass RLS for the upsert
--      path. Without an explicit authz check, any authenticated user could call
--      it with an arbitrary household_id. We guard that by verifying the caller
--      is a member of the target household via user_households (the same
--      junction table used by all RLS policies in 002_rls_policies.sql).
--      Option A was chosen: keep SECURITY DEFINER + add explicit membership
--      check. This is more robust than removing SECURITY DEFINER because RLS
--      INSERT policies on baby_steps use FOR ALL, which would still allow
--      arbitrary households for the upsert ON CONFLICT path in older Postgres
--      versions.
--      SET search_path = public prevents search_path injection attacks.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_baby_step(row baby_steps)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  -- Verify the caller belongs to the target household before any write.
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id
      AND user_id = caller_id
  ) INTO is_member;

  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.baby_steps (
    id,
    household_id,
    step_number,
    is_completed,
    completed_at,
    is_manual,
    celebrated_at,
    created_at,
    updated_at
  )
  VALUES (
    row.id,
    row.household_id,
    row.step_number,
    row.is_completed,
    row.completed_at,
    row.is_manual,
    row.celebrated_at,
    row.created_at,
    row.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      household_id  = EXCLUDED.household_id,
      step_number   = EXCLUDED.step_number,
      is_completed  = EXCLUDED.is_completed,
      completed_at  = EXCLUDED.completed_at,
      is_manual     = EXCLUDED.is_manual,
      -- celebrated_at: preserve existing stamp if incoming row has none
      celebrated_at = CASE
                        WHEN EXCLUDED.celebrated_at IS NULL
                             AND baby_steps.celebrated_at IS NOT NULL
                          THEN baby_steps.celebrated_at
                        ELSE EXCLUDED.celebrated_at
                      END,
      created_at    = EXCLUDED.created_at,
      updated_at    = EXCLUDED.updated_at
    -- LWW guard: only update if the incoming row is newer
    WHERE EXCLUDED.updated_at >= baby_steps.updated_at;
END;
$$;

-- Grant execute to authenticated users (matching existing RLS pattern where
-- authenticated users access their household-scoped rows).
GRANT EXECUTE ON FUNCTION public.merge_baby_step(baby_steps) TO authenticated;

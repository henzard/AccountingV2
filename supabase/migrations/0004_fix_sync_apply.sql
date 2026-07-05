-- 0004_fix_sync_apply.sql
--
-- Audit 2026-07-05 fix — M4: public.sync_row_state throws 42703 for 'households'.
--
-- BUG (M4): sync_row_state (0001_baseline.sql §9e) unconditionally runs
--     SELECT to_jsonb(t) FROM public.<table> t WHERE t.id = <row_id> AND t.household_id = <household_id>
--   but public.households has NO household_id column — a household IS its own
--   scope (its `id` is the household id). 'households' is in this function's
--   table allowlist, so any call for a households row raises
--     SQLSTATE 42703  column "household_id" does not exist
--   with no EXCEPTION block to catch it. The DLQ "discard" action
--   (SyncEngine.discardDeadLettered -> transport.rowState) forwards
--   op.table_name straight through, so a dead-lettered `households` op (e.g. an
--   UpdateHouseholdPaydayDayUseCase op that transiently failed) can NEVER be
--   reconciled/discarded — it is permanently stuck in the DLQ.
--
-- This is the identical bug class migration 0002 fixed in private.apply_one_op
-- (BUG 1 / IMPORTANT-2) by special-casing v_table = 'households' to scope on the
-- row's own id. 0002 only redefined apply_one_op + sync_push and never touched
-- sync_row_state, so this migration closes that sibling.
--
-- FIX: CREATE OR REPLACE sync_row_state to special-case 'households' — scope on
-- the row's own id = p_household_id (the membership-verified scope), exactly as
-- apply_one_op does. All other tables keep the (id + household_id) scope.
--
-- Idempotent: pure CREATE OR REPLACE FUNCTION + REVOKE/GRANT; safe to re-run and
-- safe on a fresh `supabase db reset`.

CREATE OR REPLACE FUNCTION public.sync_row_state(p_household_id text, p_table text, p_row_id text)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  c_tables constant text[] := array['households', 'household_members', 'envelopes', 'transactions', 'debts', 'meter_readings', 'baby_steps', 'slip_queue'];
  v_row jsonb;
BEGIN
  IF NOT (p_table = ANY (c_tables)) THEN
    RAISE EXCEPTION 'unsupported table: %', p_table USING ERRCODE = '22023';
  END IF;
  IF NOT private.is_household_member(p_household_id) THEN
    RETURN NULL;
  END IF;
  IF p_table = 'households' THEN
    -- households has NO household_id column (a household IS its own scope — its
    -- id is the household id). Scope on the row's own id = p_household_id, the
    -- membership-verified scope, mirroring apply_one_op's households special-case
    -- (migration 0002). p_row_id is ignored: for a well-formed households op
    -- row_id = household_id, and scoping on the authenticated scope prevents
    -- ever returning a row outside the caller's household.
    EXECUTE format('SELECT to_jsonb(t) FROM public.households t WHERE t.id = %L',
                   p_household_id)
      INTO v_row;
  ELSE
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = %L AND t.household_id = %L',
                   p_table, p_row_id, p_household_id)
      INTO v_row;
  END IF;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_row_state(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_row_state(text, text, text) TO authenticated;

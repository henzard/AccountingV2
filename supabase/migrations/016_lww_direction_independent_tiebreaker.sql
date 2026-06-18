-- 014_lww_direction_independent_tiebreaker.sql
-- R3 FIX: Change merge RPCs from >= to > with a direction-independent tiebreaker.
-- On equal timestamps, use lexicographic comparison on row id for determinism.
-- For ON CONFLICT (id) tables, EXCLUDED.id = existing.id always, so the tiebreaker
-- evaluates to false — first-write-wins on equal timestamps (deterministic).
-- For baby_steps (ON CONFLICT household_id, step_number), IDs may differ, providing a real tiebreaker.

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
    id, household_id, name, allocated_cents, spent_cents, envelope_type,
    is_savings_locked, is_archived, period_start, created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.name, r.allocated_cents, r.spent_cents, r.envelope_type,
    r.is_savings_locked, r.is_archived, r.period_start, r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      name              = EXCLUDED.name,
      allocated_cents   = EXCLUDED.allocated_cents,
      spent_cents       = EXCLUDED.spent_cents,
      envelope_type     = EXCLUDED.envelope_type,
      is_savings_locked = EXCLUDED.is_savings_locked,
      is_archived       = EXCLUDED.is_archived,
      period_start      = EXCLUDED.period_start,
      updated_at        = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > envelopes.updated_at
       OR (EXCLUDED.updated_at = envelopes.updated_at AND EXCLUDED.id > envelopes.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_envelope(public.envelopes) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_transaction(r public.transactions)
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

  INSERT INTO public.transactions (
    id, household_id, envelope_id, amount_cents, payee, description,
    transaction_date, is_business_expense, spending_trigger_note, created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.envelope_id, r.amount_cents, r.payee, r.description,
    r.transaction_date, r.is_business_expense, r.spending_trigger_note, r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      envelope_id           = EXCLUDED.envelope_id,
      amount_cents          = EXCLUDED.amount_cents,
      payee                 = EXCLUDED.payee,
      description           = EXCLUDED.description,
      transaction_date      = EXCLUDED.transaction_date,
      is_business_expense   = EXCLUDED.is_business_expense,
      spending_trigger_note = EXCLUDED.spending_trigger_note,
      updated_at            = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > transactions.updated_at
       OR (EXCLUDED.updated_at = transactions.updated_at AND EXCLUDED.id > transactions.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_transaction(public.transactions) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_debt(r public.debts)
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

  INSERT INTO public.debts (
    id, household_id, creditor_name, debt_type, outstanding_balance_cents,
    initial_balance_cents, interest_rate_percent, minimum_payment_cents,
    sort_order, is_paid_off, total_paid_cents, created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.creditor_name, r.debt_type, r.outstanding_balance_cents,
    r.initial_balance_cents, r.interest_rate_percent, r.minimum_payment_cents,
    r.sort_order, r.is_paid_off, r.total_paid_cents, r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      creditor_name             = EXCLUDED.creditor_name,
      debt_type                 = EXCLUDED.debt_type,
      outstanding_balance_cents = EXCLUDED.outstanding_balance_cents,
      initial_balance_cents     = EXCLUDED.initial_balance_cents,
      interest_rate_percent     = EXCLUDED.interest_rate_percent,
      minimum_payment_cents     = EXCLUDED.minimum_payment_cents,
      sort_order                = EXCLUDED.sort_order,
      is_paid_off               = EXCLUDED.is_paid_off,
      total_paid_cents          = EXCLUDED.total_paid_cents,
      updated_at                = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > debts.updated_at
       OR (EXCLUDED.updated_at = debts.updated_at AND EXCLUDED.id > debts.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_debt(public.debts) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_meter_reading(r public.meter_readings)
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

  INSERT INTO public.meter_readings (
    id, household_id, meter_type, reading_value, reading_date,
    cost_cents, vehicle_id, notes, created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.meter_type, r.reading_value, r.reading_date,
    r.cost_cents, r.vehicle_id, r.notes, r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      meter_type    = EXCLUDED.meter_type,
      reading_value = EXCLUDED.reading_value,
      reading_date  = EXCLUDED.reading_date,
      cost_cents    = EXCLUDED.cost_cents,
      vehicle_id    = EXCLUDED.vehicle_id,
      notes         = EXCLUDED.notes,
      updated_at    = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > meter_readings.updated_at
       OR (EXCLUDED.updated_at = meter_readings.updated_at AND EXCLUDED.id > meter_readings.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_meter_reading(public.meter_readings) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_household(r public.households)
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
    WHERE household_id = r.id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', r.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.households (
    id, name, payday_day, user_level, created_at, updated_at
  )
  VALUES (
    r.id, r.name, r.payday_day, r.user_level, r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      name       = EXCLUDED.name,
      payday_day = EXCLUDED.payday_day,
      user_level = EXCLUDED.user_level,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > households.updated_at
       OR (EXCLUDED.updated_at = households.updated_at AND EXCLUDED.id > households.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household(public.households) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_household_member(r public.household_members)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid()::text;
BEGIN
  IF r.user_id::uuid != caller_id THEN
    RAISE EXCEPTION 'may only upsert your own household_members row'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.household_members (
    id, household_id, user_id, role, joined_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.user_id, r.role, r.joined_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      role       = EXCLUDED.role,
      joined_at  = EXCLUDED.joined_at,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > household_members.updated_at
       OR (EXCLUDED.updated_at = household_members.updated_at AND EXCLUDED.id > household_members.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household_member(public.household_members) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_baby_step(r public.baby_steps)
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

  INSERT INTO public.baby_steps (
    id, household_id, step_number, is_completed, completed_at,
    is_manual, celebrated_at, created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.step_number, r.is_completed, r.completed_at,
    r.is_manual, r.celebrated_at, r.created_at, r.updated_at
  )
  ON CONFLICT (household_id, step_number) DO UPDATE
    SET
      is_completed  = EXCLUDED.is_completed,
      completed_at  = EXCLUDED.completed_at,
      is_manual     = EXCLUDED.is_manual,
      celebrated_at = CASE
                        WHEN EXCLUDED.celebrated_at IS NULL
                             AND baby_steps.celebrated_at IS NOT NULL
                          THEN baby_steps.celebrated_at
                        ELSE EXCLUDED.celebrated_at
                      END,
      created_at    = EXCLUDED.created_at,
      updated_at    = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > baby_steps.updated_at
       OR (EXCLUDED.updated_at = baby_steps.updated_at AND EXCLUDED.id > baby_steps.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_baby_step(public.baby_steps) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_slip_queue(r public.slip_queue)
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

  INSERT INTO public.slip_queue (
    id, household_id, image_base64, status, extracted_json,
    retry_count, created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.image_base64, r.status, r.extracted_json,
    r.retry_count, r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      status         = EXCLUDED.status,
      extracted_json = EXCLUDED.extracted_json,
      retry_count    = EXCLUDED.retry_count,
      updated_at     = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > slip_queue.updated_at
       OR (EXCLUDED.updated_at = slip_queue.updated_at AND EXCLUDED.id > slip_queue.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_slip_queue(public.slip_queue) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_user_consent(r public.user_consent)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
BEGIN
  IF r.user_id != caller_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.user_consent VALUES (r.*)
  ON CONFLICT (user_id) DO UPDATE
    SET
      slip_scan_consent_at = EXCLUDED.slip_scan_consent_at,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > user_consent.updated_at
       OR (EXCLUDED.updated_at = user_consent.updated_at AND EXCLUDED.user_id > user_consent.user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_user_consent(public.user_consent) TO authenticated;

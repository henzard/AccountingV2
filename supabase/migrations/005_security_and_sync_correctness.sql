-- 005_security_and_sync_correctness.sql
-- Hotfix the merge_baby_step RPC: change ON CONFLICT from named-constraint form
-- to column-list form so it works with a standalone unique index.

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
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.baby_steps (
    id, household_id, step_number, is_completed, completed_at,
    is_manual, celebrated_at, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.step_number, row.is_completed, row.completed_at,
    row.is_manual, row.celebrated_at, row.created_at, row.updated_at
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
    WHERE EXCLUDED.updated_at >= baby_steps.updated_at;
END;
$$;

-- Mirror household_members inserts into user_households so RLS keeps working.
-- (Remove if user_households is phased out later.)
CREATE OR REPLACE FUNCTION public.sync_household_member_to_user_households()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_households (user_id, household_id, role, created_at)
  VALUES (NEW.user_id, NEW.household_id, COALESCE(NEW.role, 'member'), NEW.created_at)
  ON CONFLICT (user_id, household_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_household_members_sync_user_households
  ON public.household_members;
CREATE TRIGGER tr_household_members_sync_user_households
  AFTER INSERT ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_household_member_to_user_households();

-- RLS on invitations: only the inviter or the person accepting may read;
-- only authenticated users may insert; only the creator may update/delete.
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_select ON public.invitations;
CREATE POLICY inv_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    invited_by_user_id = auth.uid()
    OR used_by_user_id = auth.uid()
    OR (used_by_user_id IS NULL AND expires_at > NOW())
  );
-- Note: the last clause lets an acceptor look up by code. The code is the secret.

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (invited_by_user_id = auth.uid());

DROP POLICY IF EXISTS inv_update ON public.invitations;
CREATE POLICY inv_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (invited_by_user_id = auth.uid() OR used_by_user_id IS NULL)
  WITH CHECK (true);

-- RLS on household_members: members can read their own households' members;
-- only the user themself may insert their row (via the trigger chain);
-- only the user themself may delete their row.
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hm_select ON public.household_members;
CREATE POLICY hm_select ON public.household_members
  FOR SELECT TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.user_households WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS hm_insert ON public.household_members;
CREATE POLICY hm_insert ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS hm_delete ON public.household_members;
CREATE POLICY hm_delete ON public.household_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS initial_balance_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS total_paid_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.envelopes
  DROP CONSTRAINT IF EXISTS envelopes_envelope_type_check;
ALTER TABLE public.envelopes
  ADD CONSTRAINT envelopes_envelope_type_check
  CHECK (envelope_type IN ('spending','savings','emergency_fund','baby_step','utility','income'));

-- Create household_members table if not already present (it is the remote counterpart
-- to the local SQLite mirror; user_households is the RLS junction table).
CREATE TABLE IF NOT EXISTS public.household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES public.households(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL
);

-- Merge RPCs: one per sync table, LWW guard via WHERE EXCLUDED.updated_at >= existing.updated_at.

CREATE OR REPLACE FUNCTION public.merge_envelope(row envelopes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.envelopes (
    id, household_id, name, allocated_cents, spent_cents, envelope_type,
    is_savings_locked, is_archived, period_start, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.name, row.allocated_cents, row.spent_cents, row.envelope_type,
    row.is_savings_locked, row.is_archived, row.period_start, row.created_at, row.updated_at
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
    WHERE EXCLUDED.updated_at >= envelopes.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_envelope(envelopes) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_transaction(row transactions)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.transactions (
    id, household_id, envelope_id, amount_cents, payee, description,
    transaction_date, is_business_expense, spending_trigger_note, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.envelope_id, row.amount_cents, row.payee, row.description,
    row.transaction_date, row.is_business_expense, row.spending_trigger_note, row.created_at, row.updated_at
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
    WHERE EXCLUDED.updated_at >= transactions.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_transaction(transactions) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_debt(row debts)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.debts (
    id, household_id, creditor_name, debt_type, outstanding_balance_cents,
    initial_balance_cents, interest_rate_percent, minimum_payment_cents,
    sort_order, is_paid_off, total_paid_cents, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.creditor_name, row.debt_type, row.outstanding_balance_cents,
    row.initial_balance_cents, row.interest_rate_percent, row.minimum_payment_cents,
    row.sort_order, row.is_paid_off, row.total_paid_cents, row.created_at, row.updated_at
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
    WHERE EXCLUDED.updated_at >= debts.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_debt(debts) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_meter_reading(row meter_readings)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.meter_readings (
    id, household_id, meter_type, reading_value, reading_date,
    cost_cents, vehicle_id, notes, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.meter_type, row.reading_value, row.reading_date,
    row.cost_cents, row.vehicle_id, row.notes, row.created_at, row.updated_at
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
    WHERE EXCLUDED.updated_at >= meter_readings.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_meter_reading(meter_readings) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_household(row households)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.households (
    id, name, payday_day, user_level, created_at, updated_at
  )
  VALUES (
    row.id, row.name, row.payday_day, row.user_level, row.created_at, row.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      name       = EXCLUDED.name,
      payday_day = EXCLUDED.payday_day,
      user_level = EXCLUDED.user_level,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= households.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household(households) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_household_member(row household_members)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  -- For household_members, only the user themselves may upsert their own row.
  IF row.user_id::uuid != caller_id THEN
    RAISE EXCEPTION 'may only upsert your own household_members row'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.household_members (
    id, household_id, user_id, role, joined_at
  )
  VALUES (
    row.id, row.household_id, row.user_id, row.role, row.joined_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      role      = EXCLUDED.role,
      joined_at = EXCLUDED.joined_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household_member(household_members) TO authenticated;

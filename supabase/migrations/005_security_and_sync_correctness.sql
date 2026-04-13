-- 005_security_and_sync_correctness.sql
-- Hotfix the merge_baby_step RPC: change ON CONFLICT from named-constraint form
-- to column-list form so it works with a standalone unique index.

-- Create household_members table if not already present (it is the remote counterpart
-- to the local SQLite mirror; user_households is the RLS junction table).
CREATE TABLE IF NOT EXISTS public.household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES public.households(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TEXT
);

-- Add updated_at to existing rows (idempotent; no-op if table was just created above).
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TEXT;


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
    WHERE EXCLUDED.updated_at >= baby_steps.updated_at;
END;
$$;

-- Defensive re-grant for merge_baby_step: CREATE OR REPLACE preserves grants in Postgres,
-- but we re-state it here for auditability. The original GRANT lives in 003.
GRANT EXECUTE ON FUNCTION public.merge_baby_step(public.baby_steps) TO authenticated;

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
  VALUES (NEW.user_id::uuid, NEW.household_id, COALESCE(NEW.role, 'member'), NEW.created_at)
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

-- Create invitations table (was previously assumed to exist from Dashboard setup).
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::TEXT
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON public.invitations(code);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_select ON public.invitations;
CREATE POLICY inv_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()::text
    OR used_by = auth.uid()::text
    OR (used_by IS NULL AND expires_at::timestamptz > NOW())
  );
-- Note: the last clause lets an acceptor look up by code. The code is the secret.

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()::text);

DROP POLICY IF EXISTS inv_update ON public.invitations;
CREATE POLICY inv_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()::text)
  WITH CHECK (created_by = auth.uid()::text);

-- SECURITY DEFINER RPC for the "claim invite" path.
-- Only this function (not the inv_update policy) may mark an invitation as used
-- by a non-inviter, ensuring used_by is always set to the caller's own id
-- and that the invite is not expired or already claimed.
CREATE OR REPLACE FUNCTION public.claim_invite(invite_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid()::text;
BEGIN
  UPDATE public.invitations
  SET used_by = caller_id, used_at = NOW()
  WHERE id = invite_id::uuid
    AND used_by IS NULL
    AND expires_at::timestamptz > NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found, already claimed, or expired'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_invite(TEXT) TO authenticated;

-- RLS on household_members: members can read their own households' members;
-- only the user themself may insert their r (via the trigger chain);
-- only the user themself may delete their r.
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hm_select ON public.household_members;
CREATE POLICY hm_select ON public.household_members
  FOR SELECT TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS hm_insert ON public.household_members;
CREATE POLICY hm_insert ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS hm_delete ON public.household_members;
CREATE POLICY hm_delete ON public.household_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS initial_balance_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS total_paid_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.envelopes
  DROP CONSTRAINT IF EXISTS envelopes_envelope_type_check;
ALTER TABLE public.envelopes
  ADD CONSTRAINT envelopes_envelope_type_check
  CHECK (envelope_type IN ('spending','savings','emergency_fund','baby_step','utility','income'));

-- Merge RPCs: one per sync table, LWW guard via WHERE EXCLUDED.updated_at >= existing.updated_at.

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
    WHERE EXCLUDED.updated_at >= envelopes.updated_at;
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
    WHERE EXCLUDED.updated_at >= transactions.updated_at;
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
    WHERE EXCLUDED.updated_at >= debts.updated_at;
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
    WHERE EXCLUDED.updated_at >= meter_readings.updated_at;
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
    WHERE EXCLUDED.updated_at >= households.updated_at;
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
  -- For household_members, only the user themselves may upsert their own r.
  IF r.user_id::uuid != caller_id THEN
    RAISE EXCEPTION 'may only upsert your own household_members r'
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
    WHERE EXCLUDED.updated_at >= household_members.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household_member(public.household_members) TO authenticated;

-- Remote audit_events table (mirrors local schema columns)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value_json TEXT,
  new_value_json TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ae_select ON public.audit_events;
CREATE POLICY ae_select ON public.audit_events FOR SELECT TO authenticated
  USING (household_id IN (SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text));
DROP POLICY IF EXISTS ae_insert ON public.audit_events;
CREATE POLICY ae_insert ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text));

CREATE OR REPLACE FUNCTION public.merge_audit_event(r public.audit_events)
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

  INSERT INTO public.audit_events (
    id, household_id, entity_type, entity_id, action,
    previous_value_json, new_value_json, created_at
  )
  VALUES (
    r.id, r.household_id, r.entity_type, r.entity_id, r.action,
    r.previous_value_json, r.new_value_json, r.created_at
  )
  ON CONFLICT (id) DO NOTHING; -- audit events are immutable; first-write wins
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_audit_event(public.audit_events) TO authenticated;

-- Remote slip_queue table (mirrors local schema columns)
CREATE TABLE IF NOT EXISTS public.slip_queue (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  image_base64 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  extracted_json TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE public.slip_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sq_select ON public.slip_queue;
CREATE POLICY sq_select ON public.slip_queue FOR SELECT TO authenticated
  USING (household_id IN (SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text));
DROP POLICY IF EXISTS sq_insert ON public.slip_queue;
CREATE POLICY sq_insert ON public.slip_queue FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT household_id FROM public.user_households WHERE user_id::text = auth.uid()::text));

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
    WHERE EXCLUDED.updated_at >= slip_queue.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_slip_queue(public.slip_queue) TO authenticated;

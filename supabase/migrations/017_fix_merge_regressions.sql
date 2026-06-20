-- 017_fix_merge_regressions.sql
-- Fixes 5 regressions introduced by migration 016:
-- 1. merge_envelope: re-add target_amount_cents (from 009)
-- 2. merge_envelope: re-add target_date (from 009)
-- 3. merge_transaction: re-add slip_id (from 006)
-- 4. merge_household_member: re-add role escalation guard (from 012)
-- 5. merge_slip_queue: use current column schema (from 006)

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
    is_savings_locked, is_archived, period_start, target_amount_cents, target_date,
    created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.name, r.allocated_cents, r.spent_cents, r.envelope_type,
    r.is_savings_locked, r.is_archived, r.period_start, r.target_amount_cents, r.target_date,
    r.created_at, r.updated_at
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
      target_amount_cents = EXCLUDED.target_amount_cents,
      target_date       = EXCLUDED.target_date,
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
    transaction_date, is_business_expense, spending_trigger_note, slip_id,
    created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.envelope_id, r.amount_cents, r.payee, r.description,
    r.transaction_date, r.is_business_expense, r.spending_trigger_note, r.slip_id,
    r.created_at, r.updated_at
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
      slip_id               = EXCLUDED.slip_id,
      updated_at            = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > transactions.updated_at
       OR (EXCLUDED.updated_at = transactions.updated_at AND EXCLUDED.id > transactions.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_transaction(public.transactions) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_household_member(r public.household_members)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid()::text;
  existing_role text;
BEGIN
  IF r.user_id::uuid != caller_id THEN
    RAISE EXCEPTION 'may only upsert your own household_members row'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO existing_role
    FROM public.household_members
    WHERE user_id = r.user_id AND household_id = r.household_id;

  IF (existing_role = 'owner' OR r.role != 'owner') THEN
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
  ELSE
    r.role := 'member';
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
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household_member(public.household_members) TO authenticated;

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
    id, household_id, image_uris, status, created_by,
    created_at, updated_at, extracted_data, merchant, total_cents,
    line_items, original_image_uri, category_suggestion
  )
  VALUES (
    r.id, r.household_id, r.image_uris, r.status, r.created_by,
    r.created_at, r.updated_at, r.extracted_data, r.merchant, r.total_cents,
    r.line_items, r.original_image_uri, r.category_suggestion
  )
  ON CONFLICT (id) DO UPDATE
    SET
      image_uris          = EXCLUDED.image_uris,
      status              = EXCLUDED.status,
      created_by          = EXCLUDED.created_by,
      updated_at          = EXCLUDED.updated_at,
      extracted_data      = EXCLUDED.extracted_data,
      merchant            = EXCLUDED.merchant,
      total_cents         = EXCLUDED.total_cents,
      line_items          = EXCLUDED.line_items,
      original_image_uri  = EXCLUDED.original_image_uri,
      category_suggestion = EXCLUDED.category_suggestion
    WHERE EXCLUDED.updated_at > slip_queue.updated_at
       OR (EXCLUDED.updated_at = slip_queue.updated_at AND EXCLUDED.id > slip_queue.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_slip_queue(public.slip_queue) TO authenticated;

-- 019_batch1_security_hardening.sql
-- SEC-RT-001/002: invite-only household join; lock down user_households writes
-- SEC-RT-003: revoke direct PostgREST DML; route deletes via delete_sync_row
-- SEC-RT-004: restore completed-slip overwrite guard (regression from 018)
-- SEC-RT-005: inv_insert requires owner membership on household

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-001/002: join_household_via_invite — the ONLY client path to join
-- an existing household (SECURITY DEFINER bypasses revoked INSERT policies).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.join_household_via_invite(p_invite_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
  invite_row public.invitations%ROWTYPE;
  member_id text := gen_random_uuid()::text;
  now_ts text := (NOW() AT TIME ZONE 'UTC')::text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO invite_row
  FROM public.invitations
  WHERE code = UPPER(TRIM(p_invite_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF invite_row.used_by IS NOT NULL THEN
    RAISE EXCEPTION 'invite already used' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF invite_row.expires_at::timestamptz <= NOW() THEN
    RAISE EXCEPTION 'invite expired' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = invite_row.household_id AND hm.user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'already a member of this household' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
  VALUES (member_id, invite_row.household_id, caller_id, 'member', now_ts, now_ts);

  UPDATE public.invitations
  SET used_by = caller_id, used_at = now_ts
  WHERE id = invite_row.id
    AND used_by IS NULL
    AND expires_at::timestamptz > NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite claim failed' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'member_id', member_id,
    'household_id', invite_row.household_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_household_via_invite(text) TO authenticated;

-- Remove permissive direct INSERT on household_members
DROP POLICY IF EXISTS hm_insert ON public.household_members;
REVOKE INSERT ON public.household_members FROM authenticated;

-- user_households must only be populated by trigger (005), never by clients
REVOKE INSERT, UPDATE, DELETE ON public.user_households FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-005: only household owners may create invitations
-- ═══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = household_id
        AND hm.user_id = auth.uid()::text
        AND hm.role = 'owner'
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Tighten merge_household_member: block joining existing households via sync RPC
-- (join must use join_household_via_invite). Allow owner bootstrap on empty household.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.merge_household_member(r public.household_members)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  existing_count int;
BEGIN
  IF r.user_id::uuid != caller_id THEN
    RAISE EXCEPTION 'may only upsert your own household_members row';
  END IF;

  SELECT COUNT(*) INTO existing_count
  FROM public.household_members hm
  WHERE hm.household_id = r.household_id;

  IF NOT EXISTS (SELECT 1 FROM public.household_members hm WHERE hm.id = r.id) THEN
    IF existing_count > 0 THEN
      RAISE EXCEPTION 'use join_household_via_invite to join an existing household';
    END IF;
    IF r.role != 'owner' THEN
      RAISE EXCEPTION 'first household member must be owner';
    END IF;
  END IF;

  IF r.role != 'member' AND NOT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = r.household_id
      AND hm.user_id = caller_id::text
      AND hm.role = 'owner'
  ) THEN
    r.role := 'member';
  END IF;

  INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
  VALUES (r.id, r.household_id, r.user_id, r.role, r.joined_at, r.updated_at)
  ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role,
      joined_at = EXCLUDED.joined_at,
      updated_at = EXCLUDED.updated_at
  WHERE EXCLUDED.updated_at >= household_members.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household_member(public.household_members) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-004: restore completed-slip overwrite guard (007 regression in 018)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.merge_slip_queue(r public.slip_queue)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
BEGIN
  IF r.created_by != caller_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.slip_queue (
    id, household_id, created_by, image_uris, status,
    error_message, merchant, slip_date, total_cents,
    raw_response_json, images_deleted_at, openai_cost_cents,
    created_at, updated_at
  )
  VALUES (
    r.id, r.household_id, r.created_by, r.image_uris, r.status,
    r.error_message, r.merchant, r.slip_date, r.total_cents,
    r.raw_response_json, r.images_deleted_at, r.openai_cost_cents,
    r.created_at, r.updated_at
  )
  ON CONFLICT (id) DO UPDATE
    SET
      status            = EXCLUDED.status,
      error_message     = EXCLUDED.error_message,
      merchant          = EXCLUDED.merchant,
      slip_date         = EXCLUDED.slip_date,
      total_cents       = EXCLUDED.total_cents,
      raw_response_json = EXCLUDED.raw_response_json,
      images_deleted_at = EXCLUDED.images_deleted_at,
      openai_cost_cents = EXCLUDED.openai_cost_cents,
      image_uris        = EXCLUDED.image_uris,
      updated_at        = EXCLUDED.updated_at
    WHERE
      slip_queue.status != 'completed'
      AND (
        EXCLUDED.updated_at > slip_queue.updated_at
        OR (EXCLUDED.updated_at = slip_queue.updated_at AND EXCLUDED.id > slip_queue.id)
        OR EXCLUDED.status = 'completed'
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_slip_queue(public.slip_queue) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-003: delete_sync_row — authenticated deletes only via RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_sync_row(p_table text, p_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
  hh_id text;
  row_count int;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_table NOT IN (
    'envelopes', 'transactions', 'debts', 'meter_readings', 'baby_steps',
    'slip_queue', 'audit_events', 'household_members'
  ) THEN
    RAISE EXCEPTION 'table not allowed for delete: %', p_table;
  END IF;

  EXECUTE format(
    'SELECT household_id::text FROM public.%I WHERE id = $1',
    p_table
  ) INTO hh_id USING p_id;

  IF hh_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_households uh
    WHERE uh.household_id = hh_id AND uh.user_id::text = caller_id
  ) THEN
    RAISE EXCEPTION 'not a member of household' USING ERRCODE = 'insufficient_privilege';
  END IF;

  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_table) USING p_id;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_sync_row(text, text) TO authenticated;

-- Revoke direct DML on sync data tables (reads remain via existing SELECT policies)
REVOKE INSERT, UPDATE, DELETE ON public.envelopes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.debts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.meter_readings FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.baby_steps FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.households FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.household_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.slip_queue FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_consent FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invitations FROM authenticated;

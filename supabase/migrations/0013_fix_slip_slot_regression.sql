-- 0013_fix_slip_slot_regression.sql
--
-- HOTFIX. 0009 rebuilt public.check_and_reserve_slip_slot from 0001's body
-- instead of 0003's, silently re-introducing both defects 0003 exists to fix:
--
--   C2  an `auth.uid() <> p_user_id -> 'unauthorized'` self-check. The ONLY
--       caller is the extract-slip edge function using the service-role client,
--       whose JWT has no `sub`, so auth.uid() IS NULL and EVERY extraction was
--       refused (surfaced to the user as a 429 "rate limit").
--   C1  the reservation UPDATE matched `status = 'pending'`, a status no client
--       path ever writes (capture persists 'processing'; a retry is 'failed').
--
-- Net effect: slip scanning was dead for every user from the moment 0009 was
-- deployed. supabase/tests/slip_rate_limit.test.sql hid it exactly the way
-- 0003's header warns about: it seeded 'pending' rows and set a jwt `sub`.
--
-- This body = 0009's body with ONLY these changes:
--   * no auth.uid() self-check (the edge function authenticates the user with
--     getUser() and verifies household membership before calling; EXECUTE is
--     service_role-only since 0007/0009, so p_user_id cannot be spoofed by a
--     client);
--   * reservation matches status IN ('processing', 'failed') as 0003 did. The
--     double-spend guard is the 60-second per-slip lease from 0009, which does
--     not depend on status;
--   * the per-USER 24h cap counts across ALL households. It was scoped to one
--     household, and households are free to create, so a single account could
--     run unbounded paid extractions by hopping households;
--   * the advisory lock uses the same key as sync_push / apply_server_op
--     (hashtextextended(household_id, 0)) so this function's direct slip_queue
--     write is serialised with theirs, plus a per-user lock so the cross-
--     household user count cannot be raced from two households at once.
-- Grants are unchanged (service_role only) and restated for safety.

CREATE OR REPLACE FUNCTION public.check_and_reserve_slip_slot(p_household_id text, p_user_id text, p_slip_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cutoff        timestamptz;
  v_household_cnt int;
  v_user_cnt      int;
BEGIN
  -- Lock order is fixed (user, then household) so two calls can never deadlock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slip-user:' || p_user_id, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id, 0));

  IF EXISTS (
    SELECT 1 FROM public.slip_extraction_attempts
    WHERE slip_id = p_slip_id
      AND attempted_at >= NOW() - INTERVAL '60 seconds'
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'lease_active');
  END IF;

  v_cutoff := NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_household_cnt
  FROM public.slip_extraction_attempts
  WHERE household_id = p_household_id
    AND attempted_at >= v_cutoff;

  IF v_household_cnt >= 50 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'household_limit');
  END IF;

  SELECT COUNT(*) INTO v_user_cnt
  FROM public.slip_extraction_attempts
  WHERE user_id = p_user_id
    AND attempted_at >= v_cutoff;

  IF v_user_cnt >= 25 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;

  INSERT INTO public.slip_extraction_attempts (user_id, household_id, slip_id)
  VALUES (p_user_id, p_household_id, p_slip_id);

  UPDATE public.slip_queue
  SET status     = 'processing',
      updated_at = NOW()
  WHERE id           = p_slip_id
    AND status       IN ('processing', 'failed')
    AND household_id = p_household_id
    AND created_by   = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'slot_not_reserved');
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) TO service_role;

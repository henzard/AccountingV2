-- 008_phase2_data_integrity.sql
-- Phase 2: invitations RLS (creator-only), lookup RPC, and OpenAI rate-limit fix.

-- ─── Invitations: tighten SELECT to creator only ───────────────────────────
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_select ON public.invitations;
CREATE POLICY inv_select ON public.invitations
  FOR SELECT TO authenticated
  USING (created_by = auth.uid()::text);

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()::text);

DROP POLICY IF EXISTS inv_update ON public.invitations;
CREATE POLICY inv_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid()::text)
  WITH CHECK (created_by = auth.uid()::text);

-- ─── RPC: look up a valid invite by code (SECURITY DEFINER bypasses RLS) ───
CREATE OR REPLACE FUNCTION public.lookup_invite_by_code(invite_code text)
RETURNS TABLE (
  id          uuid,
  household_id text,
  expires_at  text,
  used_by     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.household_id,
    i.expires_at,
    i.used_by
  FROM public.invitations i
  WHERE i.code = UPPER(invite_code)
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_invite_by_code(text) TO authenticated;

-- ─── Atomic rate-limit check + slip reservation ────────────────────────────
-- Holds a per-household advisory lock for the full transaction lifetime so
-- concurrent requests for the same household are serialized. The lock is
-- released automatically when the transaction ends (Supabase autocommit per RPC).
CREATE OR REPLACE FUNCTION public.check_and_reserve_slip_slot(
  p_household_id text,
  p_user_id      text,
  p_slip_id      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff        text;
  v_household_cnt int;
  v_user_cnt      int;
BEGIN
  -- Serialize all concurrent calls for this household.
  PERFORM pg_advisory_xact_lock(hashtext(p_household_id));

  v_cutoff := to_char(NOW() AT TIME ZONE 'UTC' - INTERVAL '24 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  SELECT COUNT(*) INTO v_household_cnt
  FROM public.slip_queue
  WHERE household_id = p_household_id
    AND created_at  >= v_cutoff;

  IF v_household_cnt >= 50 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'household_limit');
  END IF;

  SELECT COUNT(*) INTO v_user_cnt
  FROM public.slip_queue
  WHERE household_id = p_household_id
    AND created_by  = p_user_id
    AND created_at  >= v_cutoff;

  IF v_user_cnt >= 25 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;

  -- Reserve the slot: transition slip from pending → processing atomically.
  UPDATE public.slip_queue
  SET status     = 'processing',
      updated_at = NOW()::text
  WHERE id     = p_slip_id
    AND status = 'pending';

  RETURN jsonb_build_object('allowed', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) TO authenticated;

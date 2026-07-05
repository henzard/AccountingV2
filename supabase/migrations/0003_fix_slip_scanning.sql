-- ============================================================================
-- 0003_fix_slip_scanning.sql
--
-- Fixes the slip-scanning status/auth contract so the extract-slip edge
-- function is functional in production. Forward migration (CREATE OR REPLACE);
-- it does NOT edit 0001/0002, so historical replay stays intact.
--
-- Two independent defects made the entire slip-scan feature fail for every
-- real user despite a green test suite (the tests seeded 'pending' rows and
-- mocked the RPC to {allowed:true}, hiding both):
--
--   C1  STATUS CONTRACT MISMATCH. The only slip writer
--       (src/domain/slipScanning/CaptureSlipUseCase.ts) and BOTH schema
--       defaults (local slipQueue.ts, server slip_queue.status) persist a
--       freshly-captured slip with status='processing'. But
--       check_and_reserve_slip_slot reserved only `WHERE status='pending'` — a
--       value NO production path ever writes — so the reserve UPDATE matched
--       zero rows and returned reason 'slot_not_reserved' (mapped to a 429).
--       FIX: reserve the states the client actually produces — a fresh
--       'processing' slip and a re-extracted 'failed' slip. The edge
--       function's step-5 guard is fixed in tandem (it no longer 409s on
--       'processing'); a 'completed' slip is short-circuited by that guard's
--       cache branch before this RPC is reached.
--
--   C2  auth.uid() IS NULL. extract-slip invokes this RPC with the
--       service-role admin client (no forwarded user JWT), so inside this
--       SECURITY DEFINER body auth.uid() reads a NULL `sub` claim and the
--       guard `auth.uid() IS NULL OR <> p_user_id -> 'unauthorized'` ALWAYS
--       fired (mis-mapped by the edge function to a 429 'Household rate
--       limit'). The RPC was therefore unsatisfiable via its only caller.
--       FIX: drop the auth.uid() self-check and trust p_user_id. The edge
--       function has already authenticated the caller (auth.getUser on the
--       user-scoped client) and verified ACTIVE, non-deleted household
--       membership + slip ownership (created_by = caller, household matches)
--       BEFORE calling here, so p_user_id is trusted. The per-user and
--       per-household 24h rate-limit counting is preserved unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_and_reserve_slip_slot(p_household_id text, p_user_id text, p_slip_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cutoff        timestamptz;
  v_household_cnt int;
  v_user_cnt      int;
BEGIN
  -- C2: no auth.uid() self-check. This RPC is invoked exclusively by the
  -- extract-slip edge function with the service-role client, which carries no
  -- `sub` claim (auth.uid() IS NULL). The edge function authenticates the
  -- caller and verifies active membership + slip ownership before calling, so
  -- p_user_id is trusted here.

  -- Serialize all concurrent calls for this household (eliminates the TOCTOU
  -- window between the rate-limit COUNTs and the reservation UPDATE).
  PERFORM pg_advisory_xact_lock(hashtext(p_household_id));

  v_cutoff := NOW() - INTERVAL '24 hours';

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

  -- C1: reserve the slot for the states the client actually produces.
  -- A freshly-captured slip is persisted with status='processing' (the
  -- slip_queue default), and a slip whose prior extraction failed carries
  -- status='failed' and must be re-extractable. Both are reserved here. A
  -- 'completed' slip is short-circuited by the edge function's cache guard
  -- before this RPC is reached; any other status (e.g. 'cancelled') is
  -- intentionally NOT reservable and yields 'slot_not_reserved'.
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

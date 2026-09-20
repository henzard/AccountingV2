-- ============================================================================
-- 0017_notify_throttle.sql
--
-- Push-notification throttle hardening (REG-15 + SEC2-12). FORWARD migration
-- (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE only); it does not edit
-- 0001-0015 so historical replay stays intact. Idempotent: safe to re-run and
-- safe on a fresh `supabase db reset`.
--
-- Live sources used (highest-numbered migration defining each object):
--   public.notify_send_log                 -- 0001 (never altered since)
--   public.check_and_reserve_notify_send   -- 0001 (body); 0007 (grants only)
--
--   SEC2-12(b) (the throttle's count-then-insert is unlocked):
--     check_and_reserve_notify_send counts the sender's rows in the last hour
--     and THEN inserts, with no lock in between. N concurrent notify-event
--     invocations for the same sender can each observe "19 sends" and all
--     proceed, overshooting the cap by however many ran in parallel. This is
--     the same class of bug 0015 fixed for join_household_via_invite's invite
--     throttle, and is fixed the same way: a per-sender advisory lock taken
--     BEFORE the count.
--
--   REG-15 (the one budget that matters is spent on chatter):
--     notify-event counted ONE send per RECIPIENT per event, so a 3-member
--     household burnt the whole 20/hour bucket in ten transactions and the
--     over-budget push -- the single most important one -- came back 429.
--     notify-event now counts ONE send per EVENT, and puts
--     `envelope_over_budget` in its OWN bucket with its own (smaller) hourly
--     cap, so ordinary transaction chatter can never starve a budget alert.
--     That needs a bucket dimension on both the log and the reservation call.
--
-- WHY A NEW FUNCTION RATHER THAN A NEW PARAMETER:
--   Adding `p_bucket text DEFAULT ...` to the existing function would not
--   replace it -- CREATE OR REPLACE only replaces a matching signature, so
--   public.check_and_reserve_notify_send(text, integer) and
--   (text, integer, text) would both exist. PostgREST resolves an RPC by the
--   JSON keys it is given, and a call carrying only {p_sender_id,
--   p_max_per_hour} matches BOTH overloads -- an ambiguous-function error at
--   runtime. So this migration adds a distinctly named
--   check_and_reserve_notify_send_v2(text, text, integer) and leaves the old
--   function's body untouched (it keeps working, unchanged, for anything
--   still calling it; nothing in this repo does after notify-event ships).
--
-- notify_send_log is a SERVER-ONLY table: it is absent from private.
-- apply_one_op's `c_tables` allowlist (0015) and from every client
-- repository, so it is never synced and adding a nullable column to it
-- cannot reach a device. This respects the "no new synced columns" rule.
-- ============================================================================

-- ----------------------------------------------------------------------
-- 1. Bucket dimension on the send log.
--    Nullable with no default: rows written by the OLD
--    check_and_reserve_notify_send (which does not know about buckets) carry
--    NULL, and v2 below counts NULL as the 'default' bucket so a mixed-
--    version window cannot let a sender exceed the default cap.
-- ----------------------------------------------------------------------
ALTER TABLE public.notify_send_log
  ADD COLUMN IF NOT EXISTS bucket text;

-- The existing idx_notify_send_log_sender_sent (sender_id, sent_at DESC)
-- already serves v2's lookup; bucket is a low-cardinality residual filter on
-- a set that the 2-hourly prune cron (0007) keeps tiny, so no extra index.

-- ----------------------------------------------------------------------
-- 2. The bucket-aware, race-free reservation function.
--    `SET search_path = ''` (0015's convention) -- every reference below is
--    schema-qualified.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_reserve_notify_send_v2(
  p_sender_id text,
  p_bucket text,
  p_limit integer
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  recent_count int;
BEGIN
  IF p_sender_id IS NULL OR p_bucket IS NULL OR p_limit IS NULL OR p_limit < 0 THEN
    RETURN false;
  END IF;

  -- SEC2-12(b): serialize THIS sender's own check-then-insert so N
  -- concurrent requests cannot each observe "under the cap" and all proceed.
  -- Distinct lock namespace ('notify:' prefix) from the per-household and
  -- 'invite:' locks, so the three can never contend with each other. The
  -- lock is per SENDER, not per (sender, bucket), so the two buckets of one
  -- sender serialize against each other -- they never share a counter, only
  -- the lock, and holding it is microseconds.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('notify:' || p_sender_id, 0)
  );

  SELECT count(*)::int INTO recent_count
  FROM public.notify_send_log
  WHERE sender_id = p_sender_id
    AND coalesce(bucket, 'default') = p_bucket
    AND sent_at >= now() - interval '1 hour';

  IF recent_count >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.notify_send_log (sender_id, bucket) VALUES (p_sender_id, p_bucket);
  RETURN true;
END;
$$;

-- ----------------------------------------------------------------------
-- 3. Grants, matching 0007's DB-4 treatment of the v1 function: this RPC is
--    only ever called by the notify-event edge function through its
--    service_role client, never directly by a client over PostgREST.
--    Postgres grants EXECUTE to PUBLIC by default for new functions, so the
--    REVOKE is required.
-- ----------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_and_reserve_notify_send_v2(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_notify_send_v2(text, text, integer)
  TO service_role;

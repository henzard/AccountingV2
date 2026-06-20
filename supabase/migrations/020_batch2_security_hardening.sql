-- 020_batch2_security_hardening.sql
-- SEC-RT-006: lookup_invite_by_code filters expired/used invites
-- SEC-RT-008: merge_household no longer accepts client-driven user_level updates
-- SEC-RT-007: notify_send_log for edge-function rate limiting

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-007: rate-limit log (service role only; edge function writes/reads)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notify_send_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id  text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notify_send_log_sender_sent
  ON public.notify_send_log (sender_id, sent_at DESC);

ALTER TABLE public.notify_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notify_send_log FROM authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-006: invite lookup — only valid, unused, unexpired codes
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.lookup_invite_by_code(invite_code text)
RETURNS TABLE (
  id           uuid,
  household_id text,
  expires_at   text,
  used_by      text
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
  WHERE i.code = UPPER(TRIM(invite_code))
    AND i.used_by IS NULL
    AND i.expires_at::timestamptz > NOW()
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_invite_by_code(text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEC-RT-008: merge_household — user_level set only on INSERT, never on UPDATE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.merge_household(r public.households)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id text := auth.uid()::text;
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
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > households.updated_at
       OR (EXCLUDED.updated_at = households.updated_at AND EXCLUDED.id > households.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_household(public.households) TO authenticated;

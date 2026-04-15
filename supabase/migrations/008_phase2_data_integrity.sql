-- 008_phase2_data_integrity.sql
-- Phase 2: invitations RLS (creator-only), lookup RPC, and OpenAI rate-limit fix.

-- ─── Invitations: tighten SELECT to creator only ───────────────────────────
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inv_select ON public.invitations;
CREATE POLICY inv_select ON public.invitations
  FOR SELECT TO authenticated
  USING (invited_by_user_id = auth.uid());

DROP POLICY IF EXISTS inv_insert ON public.invitations;
CREATE POLICY inv_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (invited_by_user_id = auth.uid());

DROP POLICY IF EXISTS inv_update ON public.invitations;
CREATE POLICY inv_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (invited_by_user_id = auth.uid() OR used_by IS NULL)
  WITH CHECK (true);

-- ─── RPC: look up a valid invite by code (SECURITY DEFINER bypasses RLS) ───
CREATE OR REPLACE FUNCTION public.lookup_invite_by_code(invite_code text)
RETURNS TABLE (
  id          text,
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

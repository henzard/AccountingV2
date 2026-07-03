-- On a fresh replay, tables created by migrations (owner: postgres) get NO
-- SELECT or DML grants for the API roles — the image's default ACL for the
-- postgres role only grants TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. 019's
-- DML revokes assumed "reads remain via existing SELECT policies", but the
-- underlying SELECT grant never existed on a fresh database, so every
-- client read fails with "permission denied" before RLS is even evaluated.
-- Grant reads to the API roles (RLS still scopes rows; anon sees zero rows
-- because auth.uid() is null), and give service_role full access (it is the
-- edge functions' client and bypasses RLS by design but still needs table
-- privileges).

GRANT SELECT ON public.households        TO authenticated, anon;
GRANT SELECT ON public.household_members TO authenticated, anon;
GRANT SELECT ON public.user_households   TO authenticated, anon;
GRANT SELECT ON public.envelopes         TO authenticated, anon;
GRANT SELECT ON public.transactions      TO authenticated, anon;
GRANT SELECT ON public.debts             TO authenticated, anon;
GRANT SELECT ON public.meter_readings    TO authenticated, anon;
GRANT SELECT ON public.baby_steps        TO authenticated, anon;
GRANT SELECT ON public.slip_queue        TO authenticated, anon;
GRANT SELECT ON public.user_consent      TO authenticated, anon;
GRANT SELECT ON public.invitations       TO authenticated, anon;
GRANT SELECT ON public.audit_events      TO authenticated, anon;
GRANT SELECT ON public.user_preferences  TO authenticated;
GRANT SELECT ON public.user_fcm_tokens   TO authenticated;

-- Per-user tables keep client upsert (RLS-scoped, user_id = auth.uid());
-- 019 never revoked their DML. user_consent stays read-only for clients —
-- 019 routes its writes through merge_user_consent.
GRANT INSERT, UPDATE ON public.user_preferences TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_fcm_tokens TO authenticated;

-- Edge functions / crons operate via service_role.
GRANT ALL ON public.households, public.household_members, public.user_households,
             public.envelopes, public.transactions, public.debts,
             public.meter_readings, public.baby_steps, public.slip_queue,
             public.user_consent, public.invitations, public.audit_events,
             public.user_preferences, public.user_fcm_tokens, public.notify_send_log
  TO service_role;

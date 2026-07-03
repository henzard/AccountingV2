-- 005's sync_household_member_to_user_households reads NEW.created_at, but
-- household_members has no created_at column (only joined_at) — every INSERT
-- into household_members fails on a fresh-replay database. Use joined_at.
CREATE OR REPLACE FUNCTION public.sync_household_member_to_user_households()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_households (user_id, household_id, role, created_at)
  VALUES (NEW.user_id::uuid, NEW.household_id, COALESCE(NEW.role, 'member'), NEW.joined_at)
  ON CONFLICT (user_id, household_id) DO NOTHING;
  RETURN NEW;
END;
$$;

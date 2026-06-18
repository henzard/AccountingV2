-- Fix: prevent self-role-escalation via merge_household_member
CREATE OR REPLACE FUNCTION public.merge_household_member(r public.household_members)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE caller_id uuid := auth.uid();
BEGIN
  IF r.user_id::uuid != caller_id THEN
    RAISE EXCEPTION 'may only upsert your own household_members row';
  END IF;
  
  -- Force role to 'member' unless caller is already an owner of this household
  IF r.role != 'member' AND NOT EXISTS (
    SELECT 1 FROM household_members
    WHERE household_id = r.household_id AND user_id = caller_id::text AND role = 'owner'
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

CREATE POLICY hm_update ON public.household_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- 005_security_and_sync_correctness.sql
-- Hotfix the merge_baby_step RPC: change ON CONFLICT from named-constraint form
-- to column-list form so it works with a standalone unique index.

CREATE OR REPLACE FUNCTION public.merge_baby_step(row baby_steps)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  is_member boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_households
    WHERE household_id = row.household_id AND user_id = caller_id
  ) INTO is_member;
  IF NOT is_member THEN
    RAISE EXCEPTION 'not a member of household %', row.household_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.baby_steps (
    id, household_id, step_number, is_completed, completed_at,
    is_manual, celebrated_at, created_at, updated_at
  )
  VALUES (
    row.id, row.household_id, row.step_number, row.is_completed, row.completed_at,
    row.is_manual, row.celebrated_at, row.created_at, row.updated_at
  )
  ON CONFLICT (household_id, step_number) DO UPDATE
    SET
      is_completed  = EXCLUDED.is_completed,
      completed_at  = EXCLUDED.completed_at,
      is_manual     = EXCLUDED.is_manual,
      celebrated_at = CASE
                        WHEN EXCLUDED.celebrated_at IS NULL
                             AND baby_steps.celebrated_at IS NOT NULL
                          THEN baby_steps.celebrated_at
                        ELSE EXCLUDED.celebrated_at
                      END,
      created_at    = EXCLUDED.created_at,
      updated_at    = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at >= baby_steps.updated_at;
END;
$$;

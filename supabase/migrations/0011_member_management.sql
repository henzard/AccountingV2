-- ============================================================================
-- 0011_member_management.sql
--
-- Household member management. FORWARD migration (CREATE OR REPLACE only);
-- it does not edit 0001-0010, so historical replay stays intact. Idempotent:
-- safe to re-run and safe on a fresh `supabase db reset`.
--
--   MM-1 (an owner cannot remove anyone): private.apply_one_op (live body in
--       0010) lets a caller soft-delete ONLY THEIR OWN household_members row
--       -- `v_target_uid IS DISTINCT FROM v_caller` => forbidden_member --
--       and household_members is closed to apply_server_op/service-role
--       callers entirely. So there has never been ANY server path for a
--       household owner to remove another member; the user guide promised
--       one. FIX: public.remove_household_member below, a SECURITY DEFINER
--       RPC that does its OWN authorization (active owner of that household,
--       not self, target is not an owner) and then performs the soft-delete
--       plus its oplog `delete` row directly -- exactly the way
--       join_household_via_invite (0010 DB-6(a)) appends the oplog row for
--       its own already-authorized insert, and under the SAME per-household
--       advisory lock every other oplog writer (sync_push, apply_server_op,
--       join_household_via_invite) takes. It deliberately does NOT route
--       through apply_one_op: that function's household_members guard is
--       "the caller may only touch their OWN row", which is precisely what
--       this RPC must not be bound by. This is a narrowly-scoped second
--       exception for ONE already-authorized write, not a general opening --
--       apply_one_op is untouched by this migration.
--
--       Membership changes reach other devices ONLY as oplog rows pulled by
--       sync_pull, so the oplog append is not bookkeeping: without it the
--       removal would exist only in the server's household_members table and
--       no other device would ever learn of it.
--
--   MM-2 (nobody can see who is in the household): public.household_members
--       carries `user_id` and nothing else identifying -- no name, no email
--       -- and there is no profiles table anywhere in 0001-0010 (auth.users
--       is referenced exactly once, by user_preferences' FK). A member
--       listing built from the table alone would therefore be a list of raw
--       UUIDs. FIX: public.list_household_members below, SECURITY DEFINER,
--       caller must be an ACTIVE member of the household (the same
--       private.is_household_member RLS predicate everything else uses),
--       returning user_id/role/joined_at plus the member's email from
--       auth.users. The email of a co-member of your OWN household is the
--       minimum identity needed to know who you are sharing money with;
--       nothing else from auth.users is exposed, and a non-member gets an
--       exception rather than a row.
-- ============================================================================

-- ----------------------------------------------------------------------
-- MM-1: public.remove_household_member
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_household_member(
  p_household_id text,
  p_member_user_id text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  caller_id text := (select auth.uid())::text;
  v_member_id text;
  v_member_role text;
  now_ts timestamptz := now();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same active-owner check create_invitation uses (0001): role = 'owner'
  -- AND deleted_at IS NULL, so a removed ex-owner cannot remove anyone.
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = p_household_id
      AND hm.user_id = caller_id
      AND hm.role = 'owner'
      AND hm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'only an owner can remove a member' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Removing yourself is "leaving", which goes through the ordinary
  -- sync_push delete path (apply_one_op) precisely so its last_owner guard
  -- applies. Allowing it here would let the last owner delete themselves and
  -- strand the household with no owner and therefore no way to invite,
  -- remove, or hand over.
  IF p_member_user_id = caller_id THEN
    RAISE EXCEPTION 'cannot remove yourself; leave the household instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Same per-household advisory lock every oplog writer takes (sync_push,
  -- apply_server_op, join_household_via_invite), so the membership row and
  -- its oplog row are serialized against a concurrent join/leave for this
  -- household. Taken BEFORE reading the target row so the role/active read
  -- below is not a TOCTOU window.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_household_id, 0));

  SELECT hm.id, hm.role INTO v_member_id, v_member_role
  FROM public.household_members hm
  WHERE hm.household_id = p_household_id
    AND hm.user_id = p_member_user_id
    AND hm.deleted_at IS NULL
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not an active member of this household' USING ERRCODE = 'no_data_found';
  END IF;

  -- Owners are peers: one owner may not unilaterally remove another. There is
  -- no role-change RPC, so an owner can only ever be shed by that owner
  -- leaving of their own accord.
  IF v_member_role = 'owner' THEN
    RAISE EXCEPTION 'cannot remove another owner' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Soft delete, matching apply_one_op's own `delete` apply exactly: it sets
  -- deleted_at and NOTHING else, so the row every other device converges to
  -- from the oplog row below is byte-identical to this one.
  UPDATE public.household_members
  SET deleted_at = now_ts
  WHERE id = v_member_id
    AND deleted_at IS NULL;

  -- The oplog append, the same shape join_household_via_invite (0010) uses
  -- for its insert: a server-authored row attributed to the acting user with
  -- a `server:` device id, so the pullers on every device (including the
  -- owner's own) apply it like any other delete.
  INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
  VALUES (
    gen_random_uuid(), p_household_id, 'household_members', v_member_id, 'delete',
    jsonb_build_object('deleted_at', now_ts),
    caller_id::uuid, 'server:remove_household_member', now_ts
  );

  RETURN jsonb_build_object('removed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_household_member(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_household_member(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_household_member(text, text) TO authenticated;

-- ----------------------------------------------------------------------
-- MM-2: public.list_household_members
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_household_members(p_household_id text)
RETURNS TABLE (user_id text, role text, joined_at timestamptz, email text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = ''
    AS $$
#variable_conflict use_column
BEGIN
  -- Same predicate as every household-scoped RLS policy, so this RPC can
  -- never be a way around them: only an ACTIVE member of the household may
  -- see who else is in it.
  IF NOT private.is_household_member(p_household_id) THEN
    RAISE EXCEPTION 'not a member of this household' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT hm.user_id, hm.role, hm.joined_at, u.email::text
  FROM public.household_members hm
  LEFT JOIN auth.users u ON u.id::text = hm.user_id
  WHERE hm.household_id = p_household_id
    AND hm.deleted_at IS NULL
  ORDER BY hm.joined_at, hm.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_household_members(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_household_members(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_household_members(text) TO authenticated;

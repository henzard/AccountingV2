-- ============================================================================
-- 0012_account_deletion.sql
--
-- Remediation wave 2. FORWARD migration (CREATE OR REPLACE only); it does not
-- edit 0001-0011 so historical replay stays intact. Idempotent: safe to re-run
-- and safe on a fresh `supabase db reset`. It introduces no new tables, no new
-- columns and no new constraints -- only one new RPC.
--
--   PRIVACY-1 (no in-app account deletion path):
--
--   docs/privacy-policy.md promises the user can delete "your account and all
--   associated data", and Google Play requires an IN-APP path to it, but no
--   such path existed anywhere in src/ or supabase/ -- the policy pointed at
--   an email address and a 30-day manual turnaround.
--
--   public.delete_my_account_data() below is the server half of that path.
--   It runs AS THE CALLER (auth.uid() must be non-null; the edge function
--   calls it with the user's own JWT, never the service-role key) and is the
--   ONLY place the erasure rules live, so the edge function cannot widen
--   them.
--
--   Why this is not a simple `DELETE FROM ... WHERE user_id = auth.uid()`:
--
--   (a) household_members.user_id, user_fcm_tokens.user_id,
--       user_consent.user_id, slip_queue.created_by and
--       invitations.created_by/used_by are all `text` with NO foreign key to
--       auth.users (0001_baseline.sql); only user_preferences.user_id is a
--       uuid with ON DELETE CASCADE. So deleting the auth.users row erases
--       exactly ONE table and silently orphans every other reference. Every
--       one of them has to be handled explicitly here.
--
--   (b) household_members is a SYNCED table: every other device converges
--       purely by pulling public.oplog (sync_pull) -- there is no other
--       channel. A membership change written straight to the table would be
--       invisible to the rest of the household forever (the DB-6 class of bug
--       fixed in 0010). So both membership writes below (the ownership
--       promotion and the caller's own removal) take the SAME per-household
--       advisory lock every other writer takes (sync_push, apply_server_op,
--       join_household_via_invite) and append their own oplog row, exactly
--       the way 0010's join_household_via_invite appends its `insert`. They
--       deliberately do NOT go through apply_one_op/apply_server_op:
--       apply_one_op's household_members guard (0007) allows a caller to
--       `delete` only their OWN row and never to `update` a membership at
--       all, so the ownership promotion -- which writes ANOTHER user's row --
--       is not expressible there. This RPC has already done its own
--       authorization (the caller is deleting their own account and is an
--       active member of the household in question), so it appends directly.
--
--   (c) A household must never be left ownerless. If the caller is an owner,
--       other active members remain, and no OTHER active owner exists, the
--       longest-standing other active member is promoted to owner BEFORE the
--       caller's row is removed.
--
--   RETENTION, deliberately scoped: when the caller is the SOLE active member
--   of a household, this RPC soft-deletes their membership and stops there.
--   It does NOT hard-delete that household's financial rows (households,
--   envelopes, transactions, debts, meter_readings, baby_steps,
--   envelope_contributions, slip_queue, oplog). With the last membership gone
--   the data is unreachable: every RLS policy and every RPC in 0001-0011
--   scopes access through an ACTIVE household_members row, so no user and no
--   client can read it again. Purging it for real is a SEPARATE RETENTION
--   JOB (service-role, batched, runs on its own schedule): doing it inline
--   here would mean an unbounded cascading delete inside the user's own
--   request -- it would have to delete the household's entire oplog history,
--   which is the very thing every other replica's cursor is defined against,
--   and it would hold the per-household advisory lock for the duration. The
--   privacy promise is met either way: the rows that IDENTIFY the user
--   (tokens, consent, preferences, rate-limit attempt logs, and every
--   created_by/used_by attribution) are hard-deleted or anonymised below,
--   in this call, unconditionally.
-- ============================================================================

-- ----------------------------------------------------------------------
-- public.delete_my_account_data
--
-- SECURITY DEFINER so it can write the rows the caller's own RLS policies
-- would not let them touch (another member's household_members row during
-- the ownership promotion; the definer-only invite_attempts /
-- slip_extraction_attempts tables). `SET search_path TO 'public'` plus
-- fully-qualified references keep the definer body from resolving anything
-- through a caller-controlled search_path.
--
-- Returns a jsonb summary of what it erased. Calling it twice is a harmless
-- no-op: the second call finds no active memberships and no user-scoped rows,
-- and returns the same shape with zero counts.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account_data() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
  -- Anonymisation tombstone for NOT NULL attribution columns
  -- (invitations.created_by, slip_queue.created_by). NULL is not an option
  -- there, and reusing the real uuid obviously defeats the erasure.
  c_tombstone constant text := 'deleted-user';

  caller_id text := (select auth.uid())::text;
  now_ts timestamptz := now();

  hh record;
  promoted record;
  slip record;

  v_households_left int := 0;
  v_sole_member_households int := 0;
  v_ownership_transfers int := 0;
  v_fcm_tokens int := 0;
  v_consent int := 0;
  v_preferences int := 0;
  v_invite_attempts int := 0;
  v_slip_attempts int := 0;
  v_invites_created int := 0;
  v_invites_used int := 0;
  v_slips_anonymised int := 0;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- --------------------------------------------------------------------
  -- 1. Leave every household the caller is still an ACTIVE member of.
  --
  -- Ordered by household_id so two accounts deleting at the same moment take
  -- the per-household advisory locks in the same order and cannot deadlock
  -- against each other.
  -- --------------------------------------------------------------------
  FOR hh IN
    SELECT hm.id AS member_row_id, hm.household_id, hm.role
    FROM public.household_members hm
    WHERE hm.user_id = caller_id
      AND hm.deleted_at IS NULL
    ORDER BY hm.household_id
  LOOP
    -- The SAME lock sync_push / apply_server_op / join_household_via_invite
    -- take before touching a household's oplog. Advisory xact locks are
    -- re-entrant, so re-taking it in step 3 below costs nothing.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(hh.household_id, 0));

    IF NOT EXISTS (
      SELECT 1 FROM public.household_members o
      WHERE o.household_id = hh.household_id
        AND o.deleted_at IS NULL
        AND o.id <> hh.member_row_id
    ) THEN
      -- Sole active member: nothing to hand over. The household's financial
      -- rows are left in place and become unreachable once the membership
      -- below is soft-deleted (see the RETENTION note in the header).
      v_sole_member_households := v_sole_member_households + 1;
    ELSIF hh.role = 'owner' AND NOT EXISTS (
      SELECT 1 FROM public.household_members o
      WHERE o.household_id = hh.household_id
        AND o.deleted_at IS NULL
        AND o.role = 'owner'
        AND o.id <> hh.member_row_id
    ) THEN
      -- Last active owner leaving a household that still has other active
      -- members: promote the longest-standing one (joined_at, then id as a
      -- deterministic tie-break) BEFORE removing the caller, so the
      -- household is never ownerless for even one statement.
      SELECT o.id, o.household_id
        INTO promoted
      FROM public.household_members o
      WHERE o.household_id = hh.household_id
        AND o.deleted_at IS NULL
        AND o.id <> hh.member_row_id
      ORDER BY o.joined_at, o.id
      LIMIT 1;

      UPDATE public.household_members
      SET role = 'owner', updated_at = now_ts
      WHERE id = promoted.id;

      -- Oplog row for the promotion, appended the same way 0010's
      -- join_household_via_invite appends its insert. Payload carries exactly
      -- the columns the update wrote, which is what SyncEngine.applyOne
      -- replays for an `update` op.
      INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
      VALUES (
        gen_random_uuid(), hh.household_id, 'household_members', promoted.id, 'update',
        jsonb_build_object('role', 'owner', 'updated_at', now_ts),
        caller_id::uuid, 'server:delete_my_account_data', now_ts
      );

      v_ownership_transfers := v_ownership_transfers + 1;
    END IF;

    -- Soft-delete the caller's own membership. `SET deleted_at` only --
    -- byte-for-byte what private.apply_one_op's delete branch does and what
    -- SyncEngine.applyOne replays, so server and replicas converge on the
    -- identical tombstone.
    UPDATE public.household_members
    SET deleted_at = now_ts
    WHERE id = hh.member_row_id;

    INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
    VALUES (
      gen_random_uuid(), hh.household_id, 'household_members', hh.member_row_id, 'delete',
      jsonb_build_object('deleted_at', now_ts),
      caller_id::uuid, 'server:delete_my_account_data', now_ts
    );

    v_households_left := v_households_left + 1;
  END LOOP;

  -- --------------------------------------------------------------------
  -- 2. Hard-delete every row that exists ONLY to describe this user.
  --    None of these are synced tables, so none of them need an oplog row.
  -- --------------------------------------------------------------------
  DELETE FROM public.user_fcm_tokens WHERE user_id = caller_id;
  GET DIAGNOSTICS v_fcm_tokens = ROW_COUNT;

  DELETE FROM public.user_consent WHERE user_id = caller_id;
  GET DIAGNOSTICS v_consent = ROW_COUNT;

  -- user_preferences.user_id is the one column in the schema that IS a uuid
  -- with ON DELETE CASCADE to auth.users. Deleted explicitly anyway: this RPC
  -- must leave nothing behind even if the auth-user delete that follows it
  -- (in the delete-account edge function) never happens.
  DELETE FROM public.user_preferences WHERE user_id = caller_id::uuid;
  GET DIAGNOSTICS v_preferences = ROW_COUNT;

  DELETE FROM public.invite_attempts WHERE user_id = caller_id;
  GET DIAGNOSTICS v_invite_attempts = ROW_COUNT;

  DELETE FROM public.slip_extraction_attempts WHERE user_id = caller_id;
  GET DIAGNOSTICS v_slip_attempts = ROW_COUNT;

  -- --------------------------------------------------------------------
  -- 3. Anonymise the attribution columns that cannot be deleted, because the
  --    rows themselves belong to a household that other members still use.
  --
  --    invitations.created_by is NOT NULL -> tombstone. used_by is nullable
  --    -> NULL, which is also the "unused" sentinel, so an already-consumed
  --    invite must not be reopened: consumed rows (used_at IS NOT NULL) are
  --    tombstoned instead, and only genuinely-unconsumed rows would ever be
  --    nulled -- there are none, since used_by is only ever set together with
  --    used_at by join_household_via_invite. Both branches are written out so
  --    the invariant is enforced, not assumed.
  -- --------------------------------------------------------------------
  UPDATE public.invitations
  SET created_by = c_tombstone
  WHERE created_by = caller_id;
  GET DIAGNOSTICS v_invites_created = ROW_COUNT;

  UPDATE public.invitations
  SET used_by = CASE WHEN used_at IS NULL THEN NULL ELSE c_tombstone END
  WHERE used_by = caller_id;
  GET DIAGNOSTICS v_invites_used = ROW_COUNT;

  -- slip_queue IS a synced table, so each anonymised row gets its own oplog
  -- `update` op under that household's advisory lock -- otherwise the
  -- remaining members' devices would keep the deleted user's id in their
  -- local copy forever (they converge purely by pulling the oplog). Driven
  -- off slip_queue itself rather than off the memberships walked in step 1:
  -- the caller may have slips in a household they had ALREADY left before
  -- deleting their account, and those attributions must be erased too.
  FOR slip IN
    SELECT s.id, s.household_id
    FROM public.slip_queue s
    WHERE s.created_by = caller_id
    ORDER BY s.household_id, s.id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(slip.household_id, 0));

    UPDATE public.slip_queue
    SET created_by = c_tombstone, updated_at = now_ts
    WHERE id = slip.id;

    INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
    VALUES (
      gen_random_uuid(), slip.household_id, 'slip_queue', slip.id, 'update',
      jsonb_build_object('created_by', c_tombstone, 'updated_at', now_ts),
      caller_id::uuid, 'server:delete_my_account_data', now_ts
    );

    v_slips_anonymised := v_slips_anonymised + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'households_left', v_households_left,
    'sole_member_households', v_sole_member_households,
    'ownership_transfers', v_ownership_transfers,
    'fcm_tokens_deleted', v_fcm_tokens,
    'consent_deleted', v_consent,
    'preferences_deleted', v_preferences,
    'invite_attempts_deleted', v_invite_attempts,
    'slip_attempts_deleted', v_slip_attempts,
    'invitations_created_anonymised', v_invites_created,
    'invitations_used_anonymised', v_invites_used,
    'slips_anonymised', v_slips_anonymised
  );
END;
$fn$;

-- anon must never reach this: an unauthenticated call would raise anyway
-- (auth.uid() IS NULL), but the grant is closed regardless.
REVOKE ALL ON FUNCTION public.delete_my_account_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_my_account_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account_data() TO authenticated;

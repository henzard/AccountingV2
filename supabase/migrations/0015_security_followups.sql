-- ============================================================================
-- 0015_security_followups.sql
--
-- Security-audit wave (SEC2). FORWARD migration (CREATE OR REPLACE +
-- CREATE INDEX/CRON IF NOT EXISTS style guards only); it does not edit
-- 0001-0014 so historical replay stays intact. Idempotent: safe to re-run
-- and safe on a fresh `supabase db reset`.
--
-- Every function re-issued below is copied from its LIVE definition (the
-- highest-numbered migration that (re)defines it as of 0014) with ONLY the
-- documented change applied — never from an older body. Live sources used:
--   public.create_invitation           -- 0001 (never redefined since)
--   public.join_household_via_invite   -- 0010
--   public.delete_my_account_data      -- 0012 (never redefined since)
--   public.remove_household_member     -- 0011 (never redefined since)
--   private.apply_one_op               -- 0010
--   public.cleanup_old_slip_images     -- 0001 (never redefined since)
--
--   SEC2-2 (HIGH, invite-guess throttle is resettable at will):
--     (a) delete_my_account_data used to DELETE the caller's own
--         invite_attempts rows. Combined with (i) no server-side account
--         deletion of the auth user itself here (that is the delete-account
--         edge function's job, and it can fail/be skipped) and (ii) the
--         function being callable an unlimited number of times by an
--         authenticated attacker, this let an attacker loop "10 guesses,
--         then wipe my own throttle" forever. FIX: this migration's
--         delete_my_account_data no longer touches invite_attempts at all.
--         A deleted user's uuid sitting in a rate-limit log is not personal
--         data worth erasing on its own (it identifies no one once the
--         account itself, auth.users, and every other user-scoped row are
--         gone) -- rows simply age out of the 1-hour window like anyone
--         else's.
--     (b) The count-then-insert in join_household_via_invite was unlocked:
--         N parallel requests from the same caller could all observe
--         "9 attempts" and all proceed, overshooting the 10/hour cap by
--         however many ran concurrently. FIX: take a NEW per-caller
--         advisory lock (distinct namespace from the per-household lock
--         already taken later in the same function) before reading the
--         count, serializing a single caller's own check-then-insert.
--     (d) Invite codes lengthen from 6 to 10 characters (same 32-char
--         alphabet: 32^10 vs 32^6 keyspace) in create_invitation, which
--         combined with (a)-(b) makes guessing impractical even before
--         accounting for the throttle. join_household_via_invite already
--         matches by `code = UPPER(TRIM(p_invite_code))` with no length
--         assumption, so EXISTING 6-char codes keep working unchanged.
--
--     A global circuit breaker (more than N failed attempts across ALL
--     callers in the last hour also throttles) was considered and
--     deliberately DROPPED: it is a denial-of-service lever, not a defense
--     -- any attacker with free sign-ups can generate enough failures in an
--     hour to lock every household's invite acceptance for everyone, and
--     keep doing so indefinitely. With codes now 10 characters from a
--     32-symbol alphabet (~1e15 keyspace) plus the per-caller
--     throttle/lock above, the marginal guessing-resistance a global cap
--     would add does not justify that risk.
--
--   SEC2-8 (role decisions made on pre-lock snapshots):
--     delete_my_account_data iterated a cursor (household_id, role) opened
--     BEFORE the per-household advisory lock for each household in the
--     loop, and used that snapshot's `role` to decide promotion. A
--     concurrent write to the SAME row between the cursor being opened and
--     the lock being taken (e.g. another owner's own delete_my_account_data
--     call, or an owner's remove_household_member call against this same
--     caller, racing in a different transaction) could be missed entirely.
--     FIX: after taking the per-household lock, re-SELECT the caller's own
--     membership row (role, deleted_at) FOR UPDATE and decide EVERYTHING
--     from that fresh read; if it is already gone (deleted_at IS NOT NULL),
--     skip the iteration entirely rather than re-deriving stale intent from
--     the cursor.
--
--     remove_household_member re-checked "is the caller still an active
--     owner" BEFORE taking the household's advisory lock, so the exact same
--     staleness was possible there too. FIX: move that check to AFTER the
--     lock is acquired.
--
--   SEC2-10: two prune crons, guarded the same way 0001/0007 guard their
--   pg_cron schedules (idempotent CREATE EXTENSION + a swallowed
--   cron.unschedule before every cron.schedule): invite_attempts older than
--   2 hours (a `>= 10/hour` throttle table has no reason to keep rows past
--   2 rolling windows) and slip_extraction_attempts older than 48 hours (the
--   slip rate limiter's own lease window is 60s -- 48h is generous
--   retention for later abuse investigation without growing unbounded).
--
--   SEC2-11 (server half): private.apply_one_op now rejects, pre-oplog, any
--   CLIENT-authenticated op (auth.uid() IS NOT NULL, i.e. reached via
--   sync_push) whose device_id claims the `server:` prefix every privileged
--   server-side writer in this codebase uses (join_household_via_invite,
--   delete_my_account_data, remove_household_member,
--   apply_server_op/extract-slip, and this migration's own oplog rows for
--   the crons above). Reuses the existing `forbidden_column` code --
--   src/data/sync/SyncEngine.ts's PERMANENT_REJECT_CODES already treats it
--   as deterministic-and-final, so a spoofed device_id dead-letters
--   immediately instead of retrying into the "unexpected code" backoff path.
--
--   SEC2-13: every function re-issued above switches from
--   `SET search_path TO 'public'` (or 'public','storage') to
--   `SET search_path = ''`. Every reference inside each of these bodies was
--   ALREADY schema-qualified (public./pg_catalog./auth.) except calls to
--   gen_random_uuid()/now(), which have been core `pg_catalog` builtins
--   since Postgres 13 and resolve regardless of search_path -- so this is a
--   pure hardening change with no other body edits required.
--   private.apply_one_op and public.remove_household_member already used
--   `SET search_path = ''` (0010, 0011) and are unchanged in this respect.
--   Functions NOT otherwise touched by this migration are left exactly as
--   they are -- this migration does not go hunting for other
--   search_path TO 'public' functions.
--
--   SEC2-9 (retention, known-open): public.cleanup_old_slip_images() calls
--   storage.delete_object, which does not exist on Supabase storage, so its
--   nightly cron run has always deleted zero objects from the bucket, still
--   NULLed raw_response_json with no oplog row (never replicating to other
--   devices), and logged one STORAGE_DELETE_FAILED job_log row per image
--   forever. This migration unschedules that broken cron job by its exact
--   name ('cleanup-old-slip-images', 0001 ~713-717) and replaces the
--   function body with a no-op that records a single 'superseded' job_log
--   row (so a stray direct call -- there are none in this codebase -- is
--   still observable rather than silently doing nothing). The real
--   replacement, supabase/functions/cleanup-slip-images/index.ts, is NOT
--   scheduled from SQL: invoking an edge function from pg_cron needs a
--   vault-stored secret, which is out of scope here. It is instead invoked
--   by .github/workflows/slip-retention.yml on its own daily schedule.
-- ============================================================================

-- ----------------------------------------------------------------------
-- SEC2-2(d) + SEC2-13: public.create_invitation. Body is 0001's CURRENT
-- (and only) definition, byte-for-byte, except the code length: 6 -> 10
-- characters (10-byte CSPRNG draw, loop 0..9 instead of 0..5). Same
-- 32-character alphabet, same unbiased byte % 32 (256 is an exact multiple
-- of 32). Already used `SET search_path = ''`; unchanged.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_invitation(p_household_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  caller_id text := (select auth.uid())::text;
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 chars, no 0/O/1/I
  v_id uuid;
  v_code text;
  v_expires_at timestamptz := now() + interval '48 hours';
  v_bytes bytea;
  v_attempt int := 0;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = p_household_id
      AND hm.user_id = caller_id
      AND hm.role = 'owner'
      AND hm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'only an owner can create an invitation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    -- SEC2-2(d): 10 bytes / 10 characters, up from 6/6.
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    FOR i IN 0..9 LOOP
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % length(c_alphabet)) + 1, 1);
    END LOOP;
    v_id := gen_random_uuid();

    BEGIN
      INSERT INTO public.invitations (id, code, household_id, created_by, expires_at)
      VALUES (v_id, v_code, p_household_id, caller_id, v_expires_at);
      EXIT; -- inserted without a code collision
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE EXCEPTION 'failed to generate a unique invite code' USING ERRCODE = 'insufficient_privilege';
      END IF;
      -- retry with a freshly generated code
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invitation(text) TO authenticated;

-- ----------------------------------------------------------------------
-- SEC2-2(b) + SEC2-13: public.join_household_via_invite. Body is
-- 0010's CURRENT definition, byte-for-byte, with TWO changes:
--   1. `SET search_path TO 'public'` -> `SET search_path = ''` (every
--      reference was already schema-qualified; see header).
--   2. A new per-caller advisory lock (distinct namespace, 'invite:' +
--      caller_id, from the per-household lock already taken later in this
--      same function) taken BEFORE the per-caller throttle count, closing
--      the unlocked count-then-insert race.
-- A global circuit breaker was deliberately NOT added here -- see the
-- migration header for why (it is a denial-of-service lever, not a
-- defense).
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_household_via_invite(p_invite_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  caller_id text := auth.uid()::text;
  invite_row public.invitations%ROWTYPE;
  member_id text := gen_random_uuid()::text;
  now_ts timestamptz := NOW();
  recent_attempts int;
  v_inserted boolean := false;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- SEC2-2(b): serialize THIS caller's own throttle check-then-insert so N
  -- concurrent requests from the same caller cannot each observe "under 10"
  -- and all proceed, overshooting the cap. Distinct lock namespace
  -- ('invite:' prefix) from the per-household lock taken further down, so
  -- the two can never contend with each other.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:' || caller_id, 0));

  -- DB-5: throttle to 10 failed attempts per rolling hour per caller, checked
  -- BEFORE looking up the code at all, so the throttle itself never leaks
  -- anything about whether any particular code exists.
  SELECT count(*) INTO recent_attempts
  FROM public.invite_attempts
  WHERE user_id = caller_id
    AND attempted_at >= now() - interval '1 hour';

  IF recent_attempts >= 10 THEN
    RAISE EXCEPTION 'too many attempts, try again later' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO invite_row
  FROM public.invitations
  WHERE code = UPPER(TRIM(p_invite_code))
  LIMIT 1;

  -- DB-5: not-found / already-used / expired now raise the SAME generic
  -- message (an enumeration oracle otherwise) and each failure is recorded
  -- as a throttled attempt.
  IF NOT FOUND OR invite_row.used_by IS NOT NULL OR invite_row.expires_at::timestamptz <= NOW() THEN
    INSERT INTO public.invite_attempts (user_id) VALUES (caller_id);
    -- RETURN, do not RAISE: an exception would roll back the attempt row just
    -- written, and the throttle would never count anything. Clients read
    -- `error` (older ones fall through to "invalid join response").
    RETURN jsonb_build_object('error', 'invite_invalid', 'message', 'invite code is invalid');
  END IF;

  -- Only an ACTIVE membership blocks a re-join; a previously-removed
  -- (soft-deleted) member is allowed to rejoin via a fresh invite. This is
  -- NOT part of the code-guessing oracle (it only fires for a caller who
  -- already knows they belong to the household), so it keeps its own
  -- distinct message.
  IF EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = invite_row.household_id
      AND hm.user_id = caller_id
      AND hm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'already a member of this household' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The EXISTS check above is a TOCTOU-vulnerable pre-check: two concurrent
  -- joins (e.g. via two different valid invites to the same household) can
  -- both pass it and race to insert. The partial unique index on
  -- (household_id, user_id) WHERE deleted_at IS NULL is the actual guard;
  -- a loser of the race hits unique_violation here and is treated as a
  -- no-op success (the caller ends up an active member either way) instead
  -- of surfacing a spurious error.
  --
  -- DB-6(a) (deep-review finding): this INSERT used to be the ONLY record
  -- of the new membership -- written straight to household_members with no
  -- oplog row at all. Every other device converges purely by pulling
  -- public.oplog (sync_pull), so the household's other members (in
  -- particular the owner, who never calls this RPC themselves) NEVER
  -- learned a new member had joined until their own next unrelated sync
  -- happened to re-read household_members some other way (it doesn't --
  -- there is no other way). FIX: take the SAME per-household advisory lock
  -- every sync writer (sync_push, apply_server_op) takes before touching
  -- oplog for a household, then append an oplog row for this insert
  -- directly (NOT via apply_one_op/apply_server_op: apply_one_op's own
  -- household_members guard requires the caller's auth.uid() to equal
  -- payload.user_id, which holds here since caller_id IS the joiner, but
  -- its DB-1 anti-reinsert-over-history check would WRONGLY reject a
  -- legitimate rejoin-after-removal, since a previously-removed member has
  -- an existing soft-deleted row for this household -- exactly the case
  -- this RPC exists to handle. This RPC has already done its OWN
  -- authorization (valid, unused, unexpired invite; not already an ACTIVE
  -- member), so it appends directly instead of re-running sync_push's
  -- rules). Only appended when this call actually performed the insert
  -- (v_inserted) -- the unique_violation race-loser path below must NOT
  -- double-append an oplog row for a member another concurrent request
  -- already recorded.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(invite_row.household_id, 0));

  BEGIN
    INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
    VALUES (member_id, invite_row.household_id, caller_id, 'member', now_ts, now_ts);
    v_inserted := true;
  EXCEPTION WHEN unique_violation THEN
    v_inserted := false;
  END;

  IF v_inserted THEN
    INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
    VALUES (
      gen_random_uuid(), invite_row.household_id, 'household_members', member_id, 'insert',
      jsonb_build_object('user_id', caller_id, 'role', 'member', 'joined_at', now_ts, 'updated_at', now_ts),
      caller_id::uuid, 'server:join_household_via_invite', now_ts
    );
  END IF;

  UPDATE public.invitations
  SET used_by = caller_id, used_at = now_ts
  WHERE id = invite_row.id
    AND used_by IS NULL
    AND expires_at::timestamptz > NOW();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite claim failed' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    'member_id', member_id,
    'household_id', invite_row.household_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_household_via_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_household_via_invite(text) TO authenticated;

-- ----------------------------------------------------------------------
-- SEC2-2(a) + SEC2-8 + SEC2-13: public.delete_my_account_data. Body is
-- 0012's CURRENT (and only) definition, with FOUR changes:
--   1. `SET search_path TO 'public'` -> `SET search_path = ''` (every
--      reference was already schema-qualified; see header).
--   2. The per-household loop's cursor no longer selects `hm.role` (a
--      pre-lock snapshot column that must never be trusted for a decision).
--   3. Immediately after taking the per-household advisory lock, the
--      caller's OWN membership row is re-SELECTed FOR UPDATE (role,
--      deleted_at) and the promotion/sole-member decision is made from
--      THAT fresh read; if it is already gone (deleted_at IS NOT NULL --
--      e.g. removed by an owner between the cursor read and the lock), the
--      iteration is skipped entirely (CONTINUE) rather than acting on stale
--      intent.
--   4. Step 2 (hard-delete of rows that exist only to describe this user)
--      no longer touches invite_attempts at all -- removed the DELETE, its
--      GET DIAGNOSTICS, the v_invite_attempts variable, and the
--      'invite_attempts_deleted' key from the returned summary. See
--      SEC2-2(a) in the header for why: this table is the invite-guess
--      throttle's own memory, and letting an authenticated caller wipe
--      their own rows in it via this RPC made the throttle resettable at
--      will. A deleted user's uuid sitting in a rate-limit log identifies
--      no one once auth.users and every other user-scoped row are gone;
--      the rows simply age out (now pruned after 2 hours -- SEC2-10 below).
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account_data() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
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

  v_current_role text;
  v_current_deleted_at timestamptz;

  v_households_left int := 0;
  v_sole_member_households int := 0;
  v_ownership_transfers int := 0;
  v_fcm_tokens int := 0;
  v_consent int := 0;
  v_preferences int := 0;
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
    SELECT hm.id AS member_row_id, hm.household_id
    FROM public.household_members hm
    WHERE hm.user_id = caller_id
      AND hm.deleted_at IS NULL
    ORDER BY hm.household_id
  LOOP
    -- The SAME lock sync_push / apply_server_op / join_household_via_invite
    -- take before touching a household's oplog. Advisory xact locks are
    -- re-entrant, so re-taking it in step 3 below costs nothing.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(hh.household_id, 0));

    -- SEC2-8: the cursor above was opened BEFORE this lock, so treating its
    -- columns (in particular a `role`) as current would be trusting a
    -- pre-lock snapshot -- a concurrent remove_household_member or another
    -- session's delete_my_account_data could have changed or removed this
    -- exact row between the cursor read and the lock being granted. Re-read
    -- it now, under the lock, and decide everything from THAT.
    SELECT hm.role, hm.deleted_at INTO v_current_role, v_current_deleted_at
    FROM public.household_members hm
    WHERE hm.id = hh.member_row_id
    FOR UPDATE;

    IF v_current_deleted_at IS NOT NULL THEN
      -- Already removed (e.g. by an owner's remove_household_member, or a
      -- concurrent call for this same user) between the cursor read and the
      -- lock -- nothing left to do for this household.
      CONTINUE;
    END IF;

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
    ELSIF v_current_role = 'owner' AND NOT EXISTS (
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
  --    SEC2-2(a): invite_attempts is deliberately NOT touched here anymore
  --    -- see the migration header.
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

-- ----------------------------------------------------------------------
-- SEC2-8: public.remove_household_member. Body is 0011's CURRENT (and
-- only) definition, with ONE change: the "caller is still an active owner
-- of this household" check is moved from BEFORE the per-household advisory
-- lock to AFTER it (and after the self-removal check, which needs no lock).
-- The check's content is byte-for-byte identical -- only its position
-- moved -- so it is evaluated against the current committed state instead
-- of a snapshot a concurrent writer (another owner removing THIS caller, or
-- this caller's own delete_my_account_data leaving the household) could
-- have invalidated before this transaction ever acquired the lock. Already
-- used `SET search_path = ''`; unchanged.
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

  -- SEC2-8: checked HERE, after the lock, not before. A pre-lock check
  -- would read the caller's owner-ness off a snapshot that a concurrent
  -- writer could invalidate before this transaction ever acquired the
  -- lock; checking under the lock means the decision is made against
  -- the current committed state. Same active-owner predicate
  -- create_invitation uses (0001): role = 'owner' AND deleted_at IS NULL,
  -- so a removed ex-owner cannot remove anyone.
  IF NOT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = p_household_id
      AND hm.user_id = caller_id
      AND hm.role = 'owner'
      AND hm.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'only an owner can remove a member' USING ERRCODE = 'insufficient_privilege';
  END IF;

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
-- SEC2-11: private.apply_one_op. Body is 0010's CURRENT definition,
-- byte-for-byte, with ONE addition: a new pre-oplog rejection for a
-- CLIENT-authenticated op (v_actor_uid IS NOT NULL, i.e. reached via
-- sync_push, which always carries an authenticated JWT `sub`) whose
-- device_id claims the `server:` prefix every privileged server-side writer
-- in this codebase uses. Already used `SET search_path = ''`; unchanged.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.apply_one_op(p_op jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  c_tables   constant text[] := array['households', 'household_members', 'envelopes', 'envelope_contributions', 'transactions', 'debts', 'meter_readings', 'baby_steps', 'slip_queue'];
  v_op_id    text  := p_op->>'op_id';
  v_hh       text  := p_op->>'household_id';
  v_table    text  := p_op->>'table';
  v_row_id   text  := p_op->>'row_id';
  v_op_type  text  := p_op->>'op_type';
  v_payload  jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_allowed  text[];
  v_inserted boolean;
  v_actual   text;
  v_cols     text;
  v_vals     text;
  v_set      text;
  v_field    text;
  v_delta    text;
  v_clamp    text;
  v_caller   text;
  v_target_uid  text;
  v_target_role text;
  v_membership_count int;
  v_role     text;
  v_actor_uid uuid := (select auth.uid());
BEGIN
  -- Validation (pre-oplog): v must be 1, table allowlisted, op_type known.
  -- Rejected here => no oplog row is ever written.
  IF (p_op->>'v') IS DISTINCT FROM '1'
     OR NOT (v_table = ANY (c_tables))
     OR v_op_type IS NULL
     OR NOT (v_op_type = ANY (array['insert', 'update', 'delete', 'increment'])) THEN
    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'unsupported');
  END IF;

  -- --------------------------------------------------------------------
  -- SEC2-11: device_id identifies the WRITER, not a table column, but a
  -- client-authenticated call (v_actor_uid IS NOT NULL, i.e. this op
  -- reached apply_one_op via sync_push) claiming a `server:`-prefixed
  -- device_id is impersonating one of this function's own privileged
  -- callers: join_household_via_invite, delete_my_account_data,
  -- remove_household_member, and apply_server_op (used by extract-slip and
  -- this migration's cleanup-slip-images function) all stamp device_id =
  -- 'server:...' -- and all of THEM reach the database with NO
  -- authenticated JWT `sub` (v_actor_uid IS NULL), since they call either
  -- as SECURITY DEFINER acting on the caller's own authority (the first
  -- three) or with the service_role key (apply_server_op). So a
  -- non-NULL v_actor_uid together with a `server:` device_id can only ever
  -- mean a client is lying about who wrote the op. Rejected with
  -- `forbidden_column`: src/data/sync/SyncEngine.ts's
  -- PERMANENT_REJECT_CODES already treats that code as
  -- deterministic-and-final (re-pushing the SAME op re-evaluates the SAME
  -- committed state and is refused identically), so this dead-letters on
  -- the first rejection rather than falling through to the "unexpected
  -- code" retry-with-backoff path a brand-new code would hit.
  -- --------------------------------------------------------------------
  IF v_actor_uid IS NOT NULL AND (p_op->>'device_id') LIKE 'server:%' THEN
    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_column');
  END IF;

  -- Per-table payload column allowlist: every real column minus the
  -- wire/server-owned id + household_id.
  SELECT array_agg(a.attname)
    INTO v_allowed
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = ('public.' || quote_ident(v_table))::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname NOT IN ('id', 'household_id');

  -- --------------------------------------------------------------------
  -- 0009 (DB-2), gated by 0010 DB-6(b): slip_queue system-owned columns.
  -- Strip openai_cost_cents from the payload entirely (the client's value,
  -- if any, is simply ignored -- never applied), and force created_by to
  -- the authenticated caller on insert (ignoring whatever the payload
  -- claims), so a CLIENT push via sync_push can never attribute a slip to
  -- someone else or write its own OpenAI cost. Done BEFORE the
  -- forbidden_column allowlist check below so a legitimate combined
  -- payload (e.g. ExtractSlipUseCase's completed-transition, which
  -- includes openai_cost_cents alongside status/merchant/etc.) is never
  -- rejected wholesale -- only the protected keys' values are
  -- discarded/overridden.
  --
  -- 0010 DB-6(b) addition: gated on `v_actor_uid IS NOT NULL` -- i.e. an
  -- authenticated CLIENT call via sync_push (which always carries a JWT
  -- `sub`), never the privileged server path. extract-slip now writes
  -- slip_queue (including the real openai_cost_cents it just computed)
  -- through `apply_server_op`, which calls this SAME function with the
  -- service_role key and consequently NO `sub` claim (v_actor_uid IS
  -- NULL). Without this gate, the server's own authoritative cost write
  -- would be silently stripped to nothing -- the exact regression this
  -- gate prevents. apply_server_op is service_role-only (0001 grants), so
  -- a client can never reach this function with v_actor_uid NULL.
  -- --------------------------------------------------------------------
  IF v_table = 'slip_queue' AND v_actor_uid IS NOT NULL THEN
    v_payload := v_payload - 'openai_cost_cents';
    IF v_op_type = 'insert' THEN
      v_payload := v_payload || jsonb_build_object('created_by', to_jsonb(v_actor_uid::text));
    ELSE
      v_payload := v_payload - 'created_by';
    END IF;
  END IF;

  -- --------------------------------------------------------------------
  -- 0002 IMPORTANT-1 (security), extended by 0007 DB-1/DB-9: per-op
  -- authorization for household_members writes, enforced REGARDLESS of the
  -- household-level authorization in sync_push. sync_push authorizes a whole
  -- household for the caller (incl. the owner self-bootstrap path); that
  -- gate must NOT be read as "the caller may write ANY membership row for
  -- that household", nor as "the caller may insert a NEW row for themselves
  -- with any role just because they are already an authorized member of
  -- this household". Adding OTHER members and changing roles is the sole
  -- job of join_household_via_invite / owner RPCs (SECURITY DEFINER), which
  -- bypass sync_push entirely. So sync_push is not a path to write another
  -- user's membership, nor to acquire a second/elevated row for yourself:
  -- through it a caller may only touch their OWN household_members row, and
  -- only to
  --   (a) INSERT a brand-new bootstrap row (payload.user_id = caller, AND
  --       the caller has NO existing row -- active or soft-deleted -- for
  --       this household already, AND role='owner' is permitted only when
  --       the household has ZERO membership rows at all; every other insert
  --       must be role='member'), or
  --   (b) DELETE it -- soft-delete -- to leave the household (target row's
  --       user_id = caller), UNLESS the caller is the household's last
  --       ACTIVE owner.
  -- Everything else is rejected here, per-op (see 0007 for the full
  -- enumeration of rejected cases). This guard is UNCONDITIONAL on
  -- v_caller (auth.uid()) being non-null, which is exactly what keeps
  -- household_members closed to apply_server_op/service-role callers (see
  -- the header comment above) -- untouched by this migration.
  IF v_table = 'household_members' THEN
    v_caller := (select auth.uid())::text;
    IF v_op_type = 'insert' THEN
      IF v_caller IS NULL OR (v_payload->>'user_id') IS DISTINCT FROM v_caller THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = v_hh AND user_id = v_caller
      ) THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
      END IF;

      SELECT count(*) INTO v_membership_count
      FROM public.household_members
      WHERE household_id = v_hh;

      v_role := v_payload->>'role';
      IF v_membership_count = 0 THEN
        IF v_role IS DISTINCT FROM 'owner' THEN
          RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
        END IF;
      ELSE
        IF v_role IS DISTINCT FROM 'member' THEN
          RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
        END IF;
      END IF;
    ELSIF v_op_type = 'delete' THEN
      EXECUTE format('SELECT user_id, role FROM public.household_members WHERE id = %L', v_row_id)
        INTO v_target_uid, v_target_role;
      IF v_caller IS NULL OR v_target_uid IS DISTINCT FROM v_caller THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
      END IF;

      IF v_target_role = 'owner' AND NOT EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = v_hh
          AND role = 'owner'
          AND deleted_at IS NULL
          AND id <> v_row_id
      ) THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'last_owner');
      END IF;
    ELSE
      -- update / increment on a membership row is never allowed via sync_push.
      RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
    END IF;
  END IF;

  BEGIN  -- per-op savepoint
    -- Record first so a duplicate op_id short-circuits to 'applied'
    -- (duplicate-ack, spec §6.11) before any apply work happens.
    INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
    VALUES (v_op_id::uuid, v_hh, v_table, v_row_id, v_op_type, v_payload,
            v_actor_uid, p_op->>'device_id', (p_op->>'client_created_at')::timestamptz)
    ON CONFLICT (op_id) DO NOTHING
    RETURNING true INTO v_inserted;

    IF v_inserted IS NULL THEN
      RETURN jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'code', 'duplicate');
    END IF;

    IF v_op_type = 'increment' THEN
      -- increment payload is {field, delta, clamp}; the target field is
      -- validated like a settable column.
      v_field := v_payload->>'field';
      v_delta := v_payload->>'delta';
      v_clamp := coalesce(v_payload->>'clamp', 'none');
      IF v_field IS NULL OR NOT (v_field = ANY (v_allowed)) THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_column');
      END IF;
    ELSE
      -- insert/update/delete payloads are column maps; any key outside the
      -- allowlist (id/household_id or an unknown column) is forbidden.
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_payload) k WHERE NOT (k = ANY (v_allowed))) THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_column');
      END IF;
    END IF;

    -- update/delete/increment must target a row whose ACTUAL household_id
    -- equals the op's household_id.
    IF v_op_type IN ('update', 'delete', 'increment') THEN
      IF v_table = 'households' THEN
        EXECUTE format('SELECT id FROM public.households WHERE id = %L', v_row_id)
          INTO v_actual;
      ELSE
        EXECUTE format('SELECT household_id FROM public.%I WHERE id = %L', v_table, v_row_id)
          INTO v_actual;
      END IF;
      IF v_actual IS NULL THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'row_missing');
      ELSIF v_actual IS DISTINCT FROM v_hh THEN
        DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'wrong_household');
      END IF;
    END IF;

    -- Apply.
    IF v_op_type = 'insert' THEN
      SELECT string_agg(format('%I', e.key), ', '), string_agg(format('%L', e.value), ', ')
        INTO v_cols, v_vals
      FROM jsonb_each_text(v_payload) e;
      IF v_table = 'households' THEN
        -- households IS its own scope (row_id = household id); there is NO
        -- household_id column to inject. Insert id + payload columns only.
        EXECUTE format(
          'INSERT INTO public.households (id%s) VALUES (%L%s) ON CONFLICT (id) DO NOTHING',
          CASE WHEN v_cols IS NULL THEN '' ELSE ', ' || v_cols END,
          v_row_id,
          CASE WHEN v_vals IS NULL THEN '' ELSE ', ' || v_vals END);
      ELSE
        -- Row already present with the same id => no-op applied (spec §6.6).
        EXECUTE format(
          'INSERT INTO public.%I (id, household_id%s) VALUES (%L, %L%s) ON CONFLICT (id) DO NOTHING',
          v_table,
          CASE WHEN v_cols IS NULL THEN '' ELSE ', ' || v_cols END,
          v_row_id, v_hh,
          CASE WHEN v_vals IS NULL THEN '' ELSE ', ' || v_vals END);
      END IF;
    ELSIF v_op_type = 'update' THEN
      SELECT string_agg(format('%I = %L', e.key, e.value), ', ')
        INTO v_set
      FROM jsonb_each_text(v_payload) e;
      IF v_set IS NOT NULL THEN
        EXECUTE format('UPDATE public.%I SET %s WHERE id = %L', v_table, v_set, v_row_id);
      END IF;
    ELSIF v_op_type = 'delete' THEN
      EXECUTE format('UPDATE public.%I SET deleted_at = now() WHERE id = %L', v_table, v_row_id);
    ELSIF v_op_type = 'increment' THEN
      IF v_clamp = 'floor_zero' THEN
        EXECUTE format('UPDATE public.%I SET %I = greatest(0, %I + (%L)::numeric) WHERE id = %L',
                       v_table, v_field, v_field, v_delta, v_row_id);
      ELSE
        EXECUTE format('UPDATE public.%I SET %I = %I + (%L)::numeric WHERE id = %L',
                       v_table, v_field, v_field, v_delta, v_row_id);
      END IF;
    END IF;

    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'applied', 'code', null);
  EXCEPTION WHEN OTHERS THEN
    -- Any other SQL error: the savepoint rollback already discarded this op's
    -- oplog row; report the SQLSTATE as the rejection code.
    RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', SQLSTATE);
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION private.apply_one_op(jsonb) FROM PUBLIC;

-- ----------------------------------------------------------------------
-- SEC2-10: two prune crons, guarded exactly like 0001's/0007's pg_cron
-- schedules (idempotent CREATE EXTENSION, cron.unschedule wrapped in a
-- swallowed exception so a fresh database where the job never existed does
-- not error, then cron.schedule).
-- ----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('prune-invite-attempts');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job didn't exist, ignore
END;
$$;

SELECT cron.schedule(
  'prune-invite-attempts',
  '*/30 * * * *',
  $$DELETE FROM public.invite_attempts WHERE attempted_at < now() - interval '2 hours';$$
);

DO $$
BEGIN
  PERFORM cron.unschedule('prune-slip-extraction-attempts');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job didn't exist, ignore
END;
$$;

SELECT cron.schedule(
  'prune-slip-extraction-attempts',
  '0 * * * *',
  $$DELETE FROM public.slip_extraction_attempts WHERE attempted_at < now() - interval '48 hours';$$
);

-- ----------------------------------------------------------------------
-- SEC2-9 + SEC2-13: unschedule the broken cleanup-old-slip-images cron
-- (exact jobname from 0001 ~713-717) and replace
-- public.cleanup_old_slip_images() with a no-op that records a single
-- 'superseded' job_log row, so a stray direct call is still observable
-- rather than silently doing nothing. See the migration header for why this
-- is not simply fixed in place and why the replacement
-- (supabase/functions/cleanup-slip-images) is scheduled from GitHub Actions
-- instead of pg_cron.
-- ----------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-slip-images');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job didn't exist, ignore
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_slip_images() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
  INSERT INTO public.job_log (job, detail)
  VALUES (
    'cleanup_old_slip_images',
    jsonb_build_object(
      'event', 'superseded',
      'by', 'supabase/functions/cleanup-slip-images (see .github/workflows/slip-retention.yml)'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_slip_images() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_slip_images() TO service_role;

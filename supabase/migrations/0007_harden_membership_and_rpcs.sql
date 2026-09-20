-- ============================================================================
-- 0007_harden_membership_and_rpcs.sql
--
-- Deep-review remediation (server-side security holes). This is a FORWARD
-- migration (CREATE OR REPLACE + new table/policy/grants); it does not edit
-- 0001-0006 so historical replay stays intact. Idempotent: safe to re-run and
-- safe on a fresh `supabase db reset`.
--
--   DB-1 (HIGH)  private.apply_one_op let a caller soft-delete their own
--       household_members row and then, in the SAME batch, insert a NEW row
--       for themselves with role='owner' -- sync_push's household-level gate
--       already authorizes every op for a household the caller is an
--       EXISTING member of, and apply_one_op's per-op check only verified
--       payload.user_id = caller for an insert, never the requested role or
--       whether the caller already had a row here. So
--       [delete own membership, insert own membership role=owner] made any
--       member an owner of their own household in one push.
--       FIX: apply_one_op now rejects a household_members INSERT when the
--       caller already has ANY row (active or soft-deleted) for that
--       household -- rejoining after removal goes through
--       join_household_via_invite (SECURITY DEFINER), never sync_push -- and
--       only allows role='owner' when the household has ZERO membership rows
--       at all (true bootstrap); every other insert must be role='member'.
--
--   DB-9  The sync_push bootstrap guard only checked for ACTIVE members
--       (deleted_at IS NULL), so once a household's last member left, ANYONE
--       who knew (or guessed) its id could self-insert as owner via the same
--       bootstrap path meant for brand-new households.
--       FIX: sync_push's bootstrap guard now checks for ANY membership row
--       ever (active or soft-deleted), not just active ones. Paired with a
--       NEW apply_one_op guard: a household_members DELETE of the caller's
--       own row is rejected ('last_owner') when the caller is the household's
--       last ACTIVE owner, so a lone owner can no longer vacate a household
--       into the "zero active members" state that made this hijack possible
--       in the first place (defense in depth on top of the zero-EVER-rows
--       bootstrap check above).
--
--   DB-4  check_and_reserve_notify_send / check_and_reserve_slip_slot /
--       cleanup_old_slip_images are SECURITY DEFINER functions in the public
--       (PostgREST-exposed) schema with no REVOKE, so Postgres' default
--       EXECUTE-to-PUBLIC on functions left them callable directly over the
--       RPC endpoint by anon/authenticated -- bypassing every one of their
--       call sites' own authorization context (the edge functions that
--       legitimately call them always use the service_role key).
--       FIX: REVOKE EXECUTE from PUBLIC/anon/authenticated, GRANT to
--       service_role only. Also adds a pg_cron prune of notify_send_log rows
--       older than 2 hours (the table has no TTL/cleanup at all today and is
--       service_role-only, so it grows forever).
--
--   DB-10  invitations_select let every household member read every LIVE
--       invite code for their household (not just the owner who minted it),
--       needlessly widening who can hand out/use a still-valid code.
--       FIX: restrict SELECT to the household's owner(s) or the invitation's
--       own creator.
--
--   DB-5  join_household_via_invite had no attempt throttling and raised
--       distinct messages for not-found / already-used / expired, which is
--       an oracle for enumerating valid invite codes (6 chars from a 32-char
--       alphabet is only ~1e9 codes; distinguishable errors let an attacker
--       binary-search toward "this code exists").
--       FIX: a new public.invite_attempts table (RLS enabled, no policies --
--       definer-only) throttles a caller to 10 failed attempts per rolling
--       hour, and all three failure modes (not found / used / expired) now
--       raise the SAME generic message so a client can no longer distinguish
--       them. src/domain/households/AcceptInviteUseCase.ts's mapJoinError
--       matches on distinct substrings ('expired', 'already used'/'already a
--       member', 'not found') to pick INVITE_EXPIRED / INVITE_ALREADY_USED /
--       INVITE_NOT_FOUND; none of those substrings appear in the new generic
--       message ("invite code is invalid"), so it now falls through to
--       mapJoinError's default { code: 'JOIN_FAILED', message } branch and
--       the user sees "invite code is invalid" for all three cases instead
--       of a specific reason. This is a client UX change (not a client code
--       change -- JOIN_FAILED already existed as the fallback) and is called
--       out again in the migration author's final report; the "already a
--       member of this household" message (a DIFFERENT failure mode, not
--       part of the code-guessing oracle -- it fires only for a caller who
--       already knows they belong to the household) is intentionally left
--       distinct.
--
--   SYNC-4 (server half)  apply_one_op returned the SAME 'wrong_household'
--       code whether a row existed in another household or did not exist at
--       ALL. The client treats 'wrong_household' as a hard, permanent
--       conflict, but a truly-missing row (e.g. racing against another
--       device's not-yet-pulled delete, or a row created client-side that
--       failed to ever reach the server) is a transient condition worth
--       retrying/reconciling differently.
--       FIX: apply_one_op now returns 'row_missing' when the target id does
--       not exist in ANY household, and keeps 'wrong_household' only when
--       the row exists but belongs to a different household than the op
--       claims.
-- ============================================================================

-- ----------------------------------------------------------------------
-- DB-5: throttle table for join_household_via_invite. RLS is enabled with
-- NO policies -- only the SECURITY DEFINER function (running as the table
-- owner, which bypasses RLS) ever reads or writes it; no authenticated/anon
-- grant is issued either, so this table is fully definer-only in depth.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invite_attempts (
    user_id text NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invite_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_invite_attempts_user_attempted
  ON public.invite_attempts USING btree (user_id, attempted_at);

-- ----------------------------------------------------------------------
-- DB-1 / DB-9 / SYNC-4: private.apply_one_op. Last fully redefined in 0005
-- (actor_user_id hardening); the body below is 0005's CURRENT definition,
-- byte-for-byte, with three changes:
--   1. the household_members INSERT branch gains the "no existing row for
--      this caller" + "role gated on zero-rows-ever" checks (DB-1/DB-9);
--   2. the household_members DELETE branch gains the "not the last active
--      owner" check (DB-9);
--   3. the update/delete/increment row-scope check distinguishes a
--      genuinely missing row ('row_missing') from one that exists in another
--      household ('wrong_household') (SYNC-4).
-- Every other fix already in 0005/0002 (actor_user_id from auth.uid(), the
-- households insert special-case, the households update/delete/increment
-- household_id scope fix) is preserved unchanged.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.apply_one_op(p_op jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  c_tables   constant text[] := array['households', 'household_members', 'envelopes', 'transactions', 'debts', 'meter_readings', 'baby_steps', 'slip_queue'];
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
  -- 0005 (L2 fix): the authenticated caller, resolved server-side by
  -- Postgres/PostgREST from the request's JWT -- NEVER from the wire
  -- payload.
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
  --       ACTIVE owner (DB-9: leaving would strand the household ownerless
  --       and, historically, re-opened the bootstrap hijack window).
  -- Everything else is rejected here, per-op:
  --   * an INSERT whose payload.user_id != caller;
  --   * an INSERT for a caller who already has ANY row (active or
  --     soft-deleted) in this household (DB-1) -- a caller cannot
  --     delete-then-reinsert themselves with a different role in one batch,
  --     and rejoining after removal must go through join_household_via_invite;
  --   * an INSERT with role != 'member' when the household already has at
  --     least one membership row of any kind (DB-1) -- role='owner' is only
  --     ever accepted for a TRUE bootstrap (zero rows ever);
  --   * a DELETE of another user's membership row;
  --   * a DELETE of the caller's own row when they are the household's sole
  --     active owner (DB-9);
  --   * ANY update/increment on a membership row -- roles/memberships are
  --     never mutated through sync_push, so no member (existing or
  --     bootstrapping) can elevate themselves or anyone else to owner via an
  --     update.
  -- This is the tightest rule that still lets legitimate bootstrap and
  -- leave-household (own soft-delete, when not the last owner) work.
  IF v_table = 'household_members' THEN
    v_caller := (select auth.uid())::text;
    IF v_op_type = 'insert' THEN
      IF v_caller IS NULL OR (v_payload->>'user_id') IS DISTINCT FROM v_caller THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
      END IF;

      -- DB-1/DB-9: never allow a caller to insert over their own history.
      -- A caller with ANY existing row for this household (active or
      -- soft-deleted) must rejoin via join_household_via_invite instead --
      -- this is what closes the delete-then-reinsert-as-owner attack
      -- regardless of the order the two ops appear in the batch, since the
      -- delete only soft-deletes (the row still EXISTS afterward).
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
        -- True bootstrap: this is the very first membership row this
        -- household will ever have. Only an owner insert qualifies (mirrors
        -- sync_push's bootstrap-eligibility check below).
        IF v_role IS DISTINCT FROM 'owner' THEN
          RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
        END IF;
      ELSE
        -- The household already has membership history (active or not) --
        -- this insert can only be a fresh 'member' row. Any other role
        -- (in particular 'owner') is rejected outright.
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

      -- DB-9: a sole active owner may not leave. Without this, the last
      -- member leaving reopens the "zero active members" bootstrap window
      -- that DB-9's sync_push fix (below) otherwise closes by checking for
      -- ANY row ever -- but that check only stops a DIFFERENT (foreign)
      -- caller from hijacking; it does not by itself stop the departure.
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
        -- 0002 IMPORTANT-2 (correctness): households has NO household_id column
        -- (a household IS its own scope -- its id is the household id).
        -- v_actual is the target household's id (or NULL if it does not
        -- exist), compared to v_hh.
        EXECUTE format('SELECT id FROM public.households WHERE id = %L', v_row_id)
          INTO v_actual;
      ELSE
        EXECUTE format('SELECT household_id FROM public.%I WHERE id = %L', v_table, v_row_id)
          INTO v_actual;
      END IF;
      -- SYNC-4 (0007): a NULL v_actual means the row does not exist AT ALL
      -- (row_missing -- a transient condition the client can retry/reconcile
      -- differently), distinct from a row that exists but belongs to
      -- another household (wrong_household -- a hard conflict).
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
-- DB-9: public.sync_push. Last fully redefined in 0002 (0004/0005 only
-- redefined the sibling sync_row_state / apply_one_op). The body below is
-- 0002's CURRENT definition, byte-for-byte, with ONE change: the bootstrap
-- anti-hijack guard now checks for ANY membership row ever (active or
-- soft-deleted), not just active ones, so a household whose last member left
-- can never again be bootstrap-hijacked by a different caller.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_push(p_ops jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  v_result     jsonb := '[]'::jsonb;
  v_membership jsonb := '{}'::jsonb;  -- household_id -> authorized boolean (cache)
  v_caller     text  := (select auth.uid())::text;
  v_hh         text;
  v_authorized boolean;
  v_is_member  boolean;
  v_bootstrap  boolean;
  v_op         jsonb;
BEGIN
  -- Pass 1: resolve authorization once per distinct household and, for
  -- authorized households, take the per-household advisory lock (writer
  -- serialization, spec §6.1). ORDER BY 1 is required so two concurrent
  -- pushes touching the same household set acquire locks in the same order
  -- (else AB/BA deadlock).
  FOR v_hh IN
    SELECT DISTINCT e.value->>'household_id'
    FROM jsonb_array_elements(p_ops) e
    ORDER BY 1
  LOOP
    IF v_hh IS NULL THEN
      CONTINUE;
    END IF;

    v_is_member := private.is_household_member(v_hh);

    -- Bootstrap eligibility: the batch contains an owner self-insert for this
    -- household by the CALLER (user_id = auth.uid()). This alone does not
    -- authorize -- the "no existing members" guard below (checked under the
    -- lock) prevents hijacking an already-populated household.
    IF v_is_member THEN
      v_bootstrap := false;
    ELSE
      v_bootstrap := EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_ops) e
        WHERE e.value->>'household_id' = v_hh
          AND e.value->>'table' = 'household_members'
          AND e.value->>'op_type' = 'insert'
          AND e.value->'payload'->>'role' = 'owner'
          AND v_caller IS NOT NULL
          AND e.value->'payload'->>'user_id' = v_caller
      );
    END IF;

    v_authorized := v_is_member OR v_bootstrap;

    IF v_authorized THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hh, 0));
      -- Re-confirm bootstrap safety UNDER the lock: a self-bootstrap is only
      -- valid for a household with NO existing membership rows AT ALL --
      -- active or soft-deleted (0007 DB-9: previously this only checked
      -- ACTIVE rows, so a household whose last member left -- deleted_at IS
      -- NOT NULL for every row -- could be re-bootstrapped by anyone who knew
      -- its id). This is the anti-hijack guard: you cannot insert yourself as
      -- owner of a household that has EVER had a member.
      IF v_bootstrap AND EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = v_hh
      ) THEN
        v_authorized := false;
      END IF;
    END IF;

    v_membership := v_membership || jsonb_build_object(v_hh, v_authorized);
  END LOOP;

  -- Pass 2: apply in input order. The household insert op is applied before
  -- the membership insert op (input order); the oplog FK is DEFERRABLE so the
  -- household-insert op's oplog row commits cleanly once the household row
  -- lands in the same transaction (see 0002 BUG 2).
  FOR v_op IN SELECT e.value FROM jsonb_array_elements(p_ops) e
  LOOP
    v_hh := v_op->>'household_id';
    v_authorized := coalesce((v_membership->>v_hh)::boolean, false);
    IF NOT v_authorized THEN
      v_result := v_result || jsonb_build_object('op_id', v_op->>'op_id', 'status', 'rejected', 'code', 'not_member');
    ELSE
      v_result := v_result || private.apply_one_op(v_op);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_push(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_push(jsonb) TO authenticated;

-- ----------------------------------------------------------------------
-- DB-5: public.join_household_via_invite. Body is 0001's CURRENT definition,
-- byte-for-byte, with the throttle + generic-error changes called out in the
-- header comment above.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_household_via_invite(p_invite_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  caller_id text := auth.uid()::text;
  invite_row public.invitations%ROWTYPE;
  member_id text := gen_random_uuid()::text;
  now_ts timestamptz := NOW();
  recent_attempts int;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

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
  BEGIN
    INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
    VALUES (member_id, invite_row.household_id, caller_id, 'member', now_ts, now_ts);
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

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
-- DB-10: invitations_select. Previously any household member could read
-- every LIVE invite code for their household; restrict to the invitation's
-- own creator or a current owner of the household.
-- ----------------------------------------------------------------------
DROP POLICY IF EXISTS invitations_select ON public.invitations;
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    created_by = (select auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = invitations.household_id
        AND hm.user_id = (select auth.uid())::text
        AND hm.role = 'owner'
        AND hm.deleted_at IS NULL
    )
  );

-- ----------------------------------------------------------------------
-- DB-4: these three SECURITY DEFINER RPCs are only ever meant to be called
-- by service_role code paths (the pg_cron job below, and the notify-send /
-- extract-slip edge functions via their admin/service_role client) -- never
-- directly by a client over the PostgREST RPC endpoint. Postgres grants
-- EXECUTE to PUBLIC by default for new functions, so without an explicit
-- REVOKE, anon/authenticated could call them directly, bypassing every one
-- of their real call sites' own authorization/context.
-- ----------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.check_and_reserve_notify_send(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_notify_send(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_old_slip_images() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_slip_images() TO service_role;

-- ----------------------------------------------------------------------
-- DB-4: notify_send_log has no TTL. It is service_role-only (no
-- authenticated/anon grant, no RLS policy) and only ever read/written by
-- check_and_reserve_notify_send's 1-hour rolling window, so a 2-hour prune
-- is well clear of anything still in use. Guarded the same way 0001 guards
-- its pg_cron schedule: CREATE EXTENSION IF NOT EXISTS is idempotent, and
-- the unschedule is wrapped so a fresh database (job never existed) does not
-- error.
-- ----------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('prune-notify-send-log');
EXCEPTION WHEN OTHERS THEN
  NULL; -- job didn't exist, ignore
END;
$$;

SELECT cron.schedule(
  'prune-notify-send-log',
  '*/30 * * * *',
  $$DELETE FROM public.notify_send_log WHERE sent_at < now() - interval '2 hours';$$
);

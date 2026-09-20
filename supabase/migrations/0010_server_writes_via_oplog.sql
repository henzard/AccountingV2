-- ============================================================================
-- 0010_server_writes_via_oplog.sql
--
-- Deep-review remediation, wave 3. This is a FORWARD migration (CREATE OR
-- REPLACE + CREATE INDEX IF NOT EXISTS); it does not edit 0001-0009 so
-- historical replay stays intact. Idempotent: safe to re-run and safe on a
-- fresh `supabase db reset`.
--
--   DB-6 (server-side writes bypass the oplog):
--
--   (a) public.join_household_via_invite (0001, last redefined in 0007)
--       inserted household_members DIRECTLY. Every other device converges
--       PURELY by pulling public.oplog (sync_pull) -- there is no other
--       channel -- so a household's other members, in particular the owner
--       (who never calls this RPC themselves), never learned a new member
--       had joined. FIX: after the insert, append an oplog row for it under
--       the SAME per-household advisory lock every other writer
--       (sync_push, apply_server_op) takes before touching oplog for a
--       household. This does NOT go through apply_one_op/apply_server_op:
--       apply_one_op's own DB-1 anti-reinsert-over-history guard (0007)
--       would WRONGLY reject a legitimate rejoin-after-removal here, since
--       a previously-removed member already has a soft-deleted row for
--       this household -- exactly the case this RPC exists to handle. This
--       RPC has already done its own authorization (valid/unused/unexpired
--       invite, not already an active member), so it appends the oplog row
--       directly instead. household_members otherwise stays completely
--       closed to apply_server_op / service-role callers (see (b) below and
--       apply_one_op's household_members guard, unchanged) -- this is a
--       narrowly-scoped exception for this ONE already-authorized insert,
--       not a general opening.
--
--   (b) supabase/functions/extract-slip/index.ts wrote every slip_queue
--       change (failure and completion) directly via the admin client,
--       same bug as (a): status/merchant/total_cents/openai_cost_cents
--       existed ONLY on the server and the calling device. FIX (in that
--       file, alongside this migration): every write now goes through
--       `rpc('apply_server_op', { p_op })` with an 'update' op, so it takes
--       the household's advisory lock and appends an oplog row like any
--       other writer. `apply_server_op` (0001 ~1188-1206) already funnels
--       into the SAME private.apply_one_op used by client pushes via
--       sync_push, called here with the service_role key -- which carries
--       no authenticated JWT `sub`, so `auth.uid()` is NULL for this call.
--       apply_one_op is re-issued below with ONE behavior change riding on
--       that: the 0009 slip_queue column-stripping (openai_cost_cents/
--       created_by) is now gated on `v_actor_uid IS NOT NULL` -- i.e. an
--       authenticated CLIENT call via sync_push -- so the server's own
--       authoritative openai_cost_cents write via apply_server_op is no
--       longer silently discarded. household_members stays blocked for
--       apply_server_op callers: that table's own guard (0007) rejects
--       outright whenever `v_caller (auth.uid()) IS NULL`, which is
--       unconditional and untouched by this migration.
--
--   DB-11 (indexes only -- no new constraints on existing data): the
--       following FK/filter columns had no index at all (checked against
--       0001-0009): envelopes(household_id), transactions(household_id),
--       transactions(envelope_id), meter_readings(household_id),
--       invitations(household_id). envelope_contributions(household_id) is
--       NOT added here -- 0008 already created
--       idx_envelope_contributions_household_envelope(household_id,
--       envelope_id), which covers household_id as its leading column.
-- ============================================================================

-- ----------------------------------------------------------------------
-- DB-6(a): public.join_household_via_invite. Body is 0007's CURRENT
-- definition, byte-for-byte, with the oplog-append addition described
-- above (new v_inserted flag, the advisory lock, and the oplog INSERT
-- gated on v_inserted so a unique_violation race-loser never double-appends
-- an oplog row for a membership another concurrent request already
-- recorded).
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
  v_inserted boolean := false;
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
    RAISE EXCEPTION 'invite code is invalid' USING ERRCODE = 'insufficient_privilege';
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
-- DB-6(b): private.apply_one_op. Body is 0009's CURRENT definition,
-- byte-for-byte, with ONE change: the slip_queue column-stripping added in
-- 0009 is now gated on `v_actor_uid IS NOT NULL` (see the comment inline)
-- so the privileged apply_server_op/service-role path -- used by
-- extract-slip's now-oplog-routed slip_queue writes -- is exempt, while a
-- CLIENT push via sync_push (which always carries an authenticated
-- v_actor_uid) is still fully stripped exactly as before.
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
-- DB-11: missing FK/filter indexes. No new constraints, purely additive.
-- ----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_envelopes_household_id ON public.envelopes USING btree (household_id);
CREATE INDEX IF NOT EXISTS idx_transactions_household_id ON public.transactions USING btree (household_id);
CREATE INDEX IF NOT EXISTS idx_transactions_envelope_id ON public.transactions USING btree (envelope_id);
CREATE INDEX IF NOT EXISTS idx_meter_readings_household_id ON public.meter_readings USING btree (household_id);
CREATE INDEX IF NOT EXISTS idx_invitations_household_id ON public.invitations USING btree (household_id);

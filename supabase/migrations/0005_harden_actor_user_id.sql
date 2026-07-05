-- ============================================================================
-- 0005_harden_actor_user_id.sql
--
-- Audit 2026-07-05 fix — L2: private.apply_one_op writes oplog.actor_user_id
-- straight from the client-supplied `(p_op->>'actor_user_id')::uuid`, with NO
-- check that it equals the authenticated caller. Neither the household-level
-- authorization in `sync_push` nor the per-op `household_members` guard added
-- in 0002 ever validates the *attribution* field — only WHERE the op is
-- allowed to write, never WHO it claims wrote it. So an authorized household
-- member can push an otherwise-valid op (e.g. a normal `transactions` insert)
-- with `actor_user_id` set to a DIFFERENT member's uuid, and the oplog row —
-- which is fanned out to every other client via the `supabase_realtime`
-- publication on `public.oplog` (0001 line 915) and readable by all household
-- members (oplog_select RLS) — attributes the change to the impersonated
-- user. No privilege escalation and no data-integrity loss (the
-- household_members guard still blocks force-joining/role changes), but the
-- "who changed this" attribution is spoofable among already-trusted household
-- members.
--
-- FIX: `apply_one_op` now writes `oplog.actor_user_id` from `auth.uid()` —
-- the authenticated caller resolved by Postgres/PostgREST from the request's
-- JWT — never from the wire payload. A client can no longer claim to be
-- anyone but itself.
--
-- This is a FORWARD migration (CREATE OR REPLACE), matching 0002/0004's
-- pattern. `apply_one_op` was last fully redefined in 0002
-- (0004 only redefined the sibling `sync_row_state`, never this function), so
-- the body below is 0002's CURRENT definition, byte-for-byte, with ONLY the
-- actor_user_id handling changed (see the `v_actor_uid` declaration and its
-- use in the oplog INSERT below) — every other fix already in 0002 (the
-- households insert special-case, the per-op household_members
-- authorization, the households update/delete/increment household_id scope
-- fix) is preserved unchanged.
--
-- Idempotent: pure CREATE OR REPLACE FUNCTION + REVOKE; safe to re-run and
-- safe on a fresh `supabase db reset`.
-- ============================================================================

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
  v_target_uid text;
  -- 0005 (L2 fix): the authenticated caller, resolved server-side by
  -- Postgres/PostgREST from the request's JWT — NEVER from the wire
  -- payload. This is what oplog.actor_user_id is written from below,
  -- instead of the client-supplied `p_op->>'actor_user_id'`, closing the
  -- attribution-spoofing gap (a caller could otherwise claim any uuid as
  -- the op's author).
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
  -- 0002 IMPORTANT-1 (security): per-op authorization for household_members
  -- writes, enforced REGARDLESS of the household-level authorization in
  -- sync_push. sync_push authorizes a whole household for the caller (incl.
  -- the owner self-bootstrap path); that gate must NOT be read as "the caller
  -- may write ANY membership row for that household". Adding OTHER members and
  -- changing roles is the sole job of join_household_via_invite / owner RPCs
  -- (SECURITY DEFINER), which bypass sync_push entirely. So sync_push is not a
  -- path to write another user's membership: through it a caller may only
  -- touch their OWN household_members row, and only to
  --   (a) INSERT their bootstrap owner row (payload.user_id = caller), or
  --   (b) DELETE it — soft-delete — to leave the household (target row's
  --       user_id = caller).
  -- Everything else is rejected here, per-op:
  --   * an INSERT whose payload.user_id != caller  -> a bootstrap batch cannot
  --     smuggle in membership inserts that force-join OTHER user_ids;
  --   * a DELETE of another user's membership row;
  --   * ANY update/increment on a membership row -> roles/memberships are never
  --     mutated through sync_push, so no member (existing or bootstrapping) can
  --     elevate themselves or anyone else to owner via an update.
  -- This is the tightest rule that still lets legitimate bootstrap and
  -- leave-household (own soft-delete) work.
  IF v_table = 'household_members' THEN
    v_caller := (select auth.uid())::text;
    IF v_op_type = 'insert' THEN
      IF v_caller IS NULL OR (v_payload->>'user_id') IS DISTINCT FROM v_caller THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
      END IF;
    ELSIF v_op_type = 'delete' THEN
      EXECUTE format('SELECT user_id FROM public.household_members WHERE id = %L', v_row_id)
        INTO v_target_uid;
      IF v_caller IS NULL OR v_target_uid IS DISTINCT FROM v_caller THEN
        RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
      END IF;
    ELSE
      -- update / increment on a membership row is never allowed via sync_push.
      RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'forbidden_member');
    END IF;
  END IF;

  BEGIN  -- per-op savepoint
    -- Record first so a duplicate op_id short-circuits to 'applied'
    -- (duplicate-ack, spec §6.11) before any apply work happens.
    --
    -- 0005 (L2 fix): actor_user_id is written from `v_actor_uid` (the
    -- authenticated caller, `auth.uid()`) — NOT from the client-supplied
    -- `(p_op->>'actor_user_id')::uuid` as before. The wire payload's
    -- actor_user_id field is now ignored entirely for this purpose, so a
    -- caller can no longer attribute an op to a different household
    -- member.
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
        -- (a household IS its own scope — its id is the household id). Selecting
        -- household_id here raised 42703 ("column household_id does not exist"),
        -- so EVERY households update/delete/increment op was rejected (e.g.
        -- UpdateHouseholdPaydayDayUseCase's payday_day update never synced).
        -- Scope on the row's own id instead: v_actual is the target
        -- household's id (or NULL if it does not exist), compared to v_hh.
        EXECUTE format('SELECT id FROM public.households WHERE id = %L', v_row_id)
          INTO v_actual;
      ELSE
        EXECUTE format('SELECT household_id FROM public.%I WHERE id = %L', v_table, v_row_id)
          INTO v_actual;
      END IF;
      IF v_actual IS DISTINCT FROM v_hh THEN
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
        -- MINOR-3 (defensive note): the household row is created with
        -- id = v_row_id, but this op's oplog row was written with
        -- household_id = v_hh (the op's top-level household_id). For a
        -- well-formed households insert a client always sets row_id = household_id
        -- (see CreateHouseholdUseCase / toWireOp), so the two are equal and the
        -- DEFERRABLE oplog->households FK is satisfied at COMMIT. A MALFORMED op
        -- with row_id != household_id would create households(v_row_id) while the
        -- oplog row still references the non-existent households(v_hh) — the
        -- deferred FK then fails at COMMIT and aborts the whole sync_push
        -- transaction. That is self-inflicted (the client would have to hand-craft
        -- an inconsistent op) and fails safe (nothing is committed); legit clients
        -- never hit it, so no extra guard is added here.
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

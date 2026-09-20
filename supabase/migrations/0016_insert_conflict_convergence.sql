-- ============================================================================
-- 0016_insert_conflict_convergence.sql
--
-- SEC2-5 (server half). FORWARD migration (CREATE OR REPLACE only); it does
-- not edit 0001-0015, so historical replay stays intact. Idempotent: safe to
-- re-run and safe on a fresh `supabase db reset`.
--
-- Function re-issued below, copied from its LIVE definition and nothing
-- older:
--   private.apply_one_op  -- 0015 (SEC2-11), copied BYTE-FOR-BYTE with the
--                            documented change below and nothing else.
--
-- THE BUG
-- -------
-- Several client writes use DETERMINISTIC row ids (uuidv5 over stable
-- inputs) precisely so two devices doing the same thing produce the same
-- row: `envelope_contributions` rows written at rollover
-- (src/domain/budgets/PersistentContributions.ts,
-- StartNewPeriodUseCase.ts), the rollover envelope copies
-- (`rolloverEnvelopeId`) and the baby-step seeds. Same id, but NOT
-- necessarily the same VALUE: device B can roll the same period over before
-- its first pull finished, or from a different offline allocation, so its
-- `amount_cents` differs from device A's.
--
-- The generic insert path below answers that with
-- `INSERT ... ON CONFLICT (id) DO NOTHING` and STILL reports
-- `status:'applied'`. The losing device therefore marks its op pushed and
-- keeps its own figure; and when it later pulls the winner's insert op, the
-- client applies it with `INSERT OR IGNORE` (src/data/sync/SyncEngine.ts
-- `applyOne`), which is a no-op against the row it already has. Neither side
-- ever moves: the two devices show different money for the same row,
-- permanently, with no self-heal anywhere in the protocol.
--
-- THE FIX
-- -------
-- The generic insert path now detects the suppressed insert
-- (`GET DIAGNOSTICS ... ROW_COUNT` = 0 after the `ON CONFLICT DO NOTHING`
-- statement) and returns `status:'rejected', code:'row_exists'` instead of a
-- false `applied` -- but ONLY for a row that is genuinely DIFFERENT, and
-- only when it belongs to the SAME household.
--
--   SAME HOUSEHOLD. It must: `row_id` is the op's own row id and sync_push
--   has already authorized `household_id` for this caller. A row under that
--   id belonging to ANOTHER household is the same cross-household reach the
--   update/delete path has always refused, so it keeps that path's
--   `wrong_household` answer rather than being handed the new code (which
--   the client acts on by copying the server row down -- something it must
--   never do for a household it is not in; `sync_row_state` would refuse it
--   anyway). No value comparison is made in that case either.
--
--   GENUINELY DIFFERENT. A suppressed insert is USUALLY benign: the common
--   case by far is two phones rolling the same period over and producing
--   the SAME deterministic rows with the SAME numbers; divergent amounts
--   are the rare case. Rejecting the benign one would be a regression for
--   every client already in the field, because 1.1.130/1.1.134 do not know
--   `row_exists`: it falls through their "unexpected reject code" branch,
--   which retries to the cap -- stalling that household's entire push queue
--   on every round in between -- and then dead-letters the op and surfaces
--   it as "couldn't be saved to the cloud". So the existing row is compared
--   against the incoming payload first:
--     * over the PAYLOAD's own keys only, as
--       `col IS DISTINCT FROM 'literal'` -- the SAME
--       unknown-literal-to-column-type coercion the INSERT itself performs
--       via `format('%L', e.value)`. Representation differences that are not
--       real differences therefore cannot register: a timestamptz compares
--       as a timestamptz whatever text form it arrived in, `'50000'`
--       compares as the integer 50000, and a boolean sent as JSON `true` or
--       as SQLite's `1` coerces to the same boolean (both are valid boolean
--       literals, and whichever form arrived is the form the INSERT would
--       have written). JSON `null` renders as the NULL keyword, and
--       `IS DISTINCT FROM NULL` is the null-safe test.
--     * on the payload AFTER the column allowlist and the slip_queue
--       ownership pinning this function already applies, so every key is a
--       real column holding the value that WOULD have been inserted.
--     * EXCLUDING `created_at` / `updated_at`: pure bookkeeping stamped from
--       each device's own clock, so two devices always differ there.
--   Identical (or nothing left to compare) => today's behaviour EXACTLY:
--   `status:'applied'`, oplog row kept, nothing changes for anyone.
--
-- The client half (src/data/sync/SyncEngine.ts) treats `row_exists` as its
-- own outcome: the op is marked pushed (it is superseded, not failed -- NOT
-- dead-lettered and NOT retried), and the authoritative row is fetched with
-- the existing `sync_row_state` transport call and written over the local
-- row. That is what makes both devices converge on the SERVER's value.
--
-- IDEMPOTENT RE-DELIVERY IS UNAFFECTED
-- ------------------------------------
-- A client retrying the SAME op_id after a lost response never reaches the
-- insert at all: the first statement inside the per-op savepoint is the
-- oplog append (`INSERT INTO public.oplog ... ON CONFLICT (op_id) DO
-- NOTHING RETURNING true`), and a NULL `v_inserted` short-circuits to
-- `status:'applied', code:'duplicate'` before any apply work happens. So
-- `row_exists` can only ever fire for a DIFFERENT op_id targeting an id that
-- already exists -- exactly the divergence case. (Verified by reading the
-- 0015 body re-issued below; pinned by supabase/tests/oplog_protocol.test.sql
-- probe 21.)
--
-- And because the oplog append happens BEFORE the apply, a rejection must
-- UNDO it: the new branch deletes the just-appended oplog row exactly as the
-- existing `forbidden_column` / `row_missing` / `wrong_household` branches
-- do, so a rejected op is never published to the household's pull stream.
-- The benign-duplicate path deletes NOTHING -- it keeps the oplog row and
-- the `applied` answer, which is precisely today's behaviour.
--
-- CHANGE SET vs the 0015 body (the ONLY differences):
--   1. DECLARE: three new variables, `v_ins_rows int;`, `v_cmp text;` and
--      `v_differs boolean;`.
--   2. The `v_op_type = 'insert'` apply branch: after the two
--      `EXECUTE format('INSERT ... ON CONFLICT (id) DO NOTHING')` statements
--      (both unchanged), capture ROW_COUNT and, when it is 0:
--        (a) resolve the existing row's household; a different one deletes
--            the oplog row and returns `wrong_household`;
--        (b) otherwise compare the existing row against the payload's own
--            non-bookkeeping keys; a real difference deletes the oplog row
--            and returns `row_exists`;
--        (c) otherwise fall through to the UNCHANGED `applied` return.
-- Everything else -- validation, the SEC2-11 `server:` device_id guard, the
-- slip_queue column ownership rules, the household_members per-op
-- authorization, the oplog append, the column allowlist, the
-- update/delete/increment paths and the EXCEPTION handler -- is byte-for-byte
-- 0015.
-- ============================================================================

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
  -- SEC2-5: rows the generic insert actually wrote. 0 means the
  -- `ON CONFLICT (id) DO NOTHING` suppressed it, i.e. that id is taken.
  v_ins_rows int;
  -- SEC2-5: the `col IS DISTINCT FROM 'literal'` predicate built from the
  -- payload, and the answer it evaluates to against the existing row.
  v_cmp      text;
  v_differs  boolean;
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
        -- SEC2-5: the `ON CONFLICT (id) DO NOTHING` is KEPT -- the row that is
        -- already there is the authoritative one and must not be overwritten
        -- by a late arrival -- but it is no longer reported as `applied`; see
        -- the ROW_COUNT check below.
        EXECUTE format(
          'INSERT INTO public.%I (id, household_id%s) VALUES (%L, %L%s) ON CONFLICT (id) DO NOTHING',
          v_table,
          CASE WHEN v_cols IS NULL THEN '' ELSE ', ' || v_cols END,
          v_row_id, v_hh,
          CASE WHEN v_vals IS NULL THEN '' ELSE ', ' || v_vals END);
      END IF;

      -- ----------------------------------------------------------------
      -- SEC2-5: did the insert actually write a row? ROW_COUNT is set by
      -- the EXECUTE above (either branch); 0 means the id was already
      -- taken and `DO NOTHING` swallowed the statement.
      --
      -- Reporting that as `applied` is what strands two devices on two
      -- different VALUES for the SAME deterministic id forever (see this
      -- file's header). But a suppressed insert is NOT automatically a
      -- divergence: the overwhelmingly common case is two phones rolling
      -- the same period over and writing the SAME rows with the SAME
      -- numbers. Rejecting those would be a regression on every client
      -- already in the field -- 1.1.130/1.1.134 do not know `row_exists`,
      -- so it falls through their "unexpected code" branch: retried to the
      -- cap, stalling that household's whole push queue on every round in
      -- between, then dead-lettered and shown to the user as "couldn't be
      -- saved to the cloud". For a benign duplicate.
      --
      -- So the value is checked, and only a REAL difference is rejected:
      --
      --   * the comparison runs over the PAYLOAD's own keys, against the
      --     row already in the table, using `col IS DISTINCT FROM
      --     'literal'` -- the SAME unknown-literal-to-column-type coercion
      --     the INSERT above performs via `format('%L', e.value)`. That is
      --     what keeps representation differences from reading as real
      --     ones: a timestamptz compares as a timestamptz whatever text
      --     form it arrived in, `'50000'` compares as the integer 50000,
      --     and a boolean sent as JSON `true` or as SQLite's `1` both
      --     coerce to the same boolean (both are valid boolean literals --
      --     and whichever form arrived is the form the INSERT would have
      --     written, so the two paths cannot disagree). A JSON `null`
      --     renders as the NULL keyword, and `IS DISTINCT FROM NULL` is
      --     the null-safe test, never a null result.
      --   * `v_payload` at this point has ALREADY been through the column
      --     allowlist (unknown keys were rejected `forbidden_column`) and
      --     the slip_queue ownership pinning (openai_cost_cents stripped,
      --     created_by forced), so every key is a real column holding the
      --     value that WOULD have been inserted.
      --   * `created_at` / `updated_at` are excluded. They are pure
      --     bookkeeping stamped from each device's own clock, so two
      --     devices ALWAYS differ there; comparing them would reject every
      --     benign duplicate, which is the whole thing this check exists
      --     to avoid.
      --
      -- Identical (or payload-empty) => fall through to the unchanged
      -- `applied` return at the bottom, oplog row and all: byte-for-byte
      -- today's behaviour, so nothing changes for anyone.
      --
      -- The existing row must belong to THIS household -- `row_id` is the
      -- op's own row id, and sync_push has already authorized `v_hh` for
      -- this caller. If it does not, this is the same cross-household
      -- reach the update/delete path above has always refused, so it gets
      -- that path's `wrong_household` answer, not the new code (and no
      -- value comparison, which would read another household's row).
      --
      -- Every rejection deletes the oplog row appended at the top of this
      -- savepoint first, exactly as the other rejection branches do -- a
      -- rejected op must never reach the household's pull stream.
      -- ----------------------------------------------------------------
      GET DIAGNOSTICS v_ins_rows = ROW_COUNT;
      IF v_ins_rows = 0 THEN
        IF v_table = 'households' THEN
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

        SELECT string_agg(format('%I IS DISTINCT FROM %L', e.key, e.value), ' OR ')
          INTO v_cmp
        FROM jsonb_each_text(v_payload) e
        WHERE e.key NOT IN ('created_at', 'updated_at');

        IF v_cmp IS NULL THEN
          -- Nothing left to compare (empty payload, or bookkeeping only):
          -- the row is already there and nothing contradicts it.
          v_differs := false;
        ELSE
          EXECUTE format('SELECT (%s) FROM public.%I WHERE id = %L', v_cmp, v_table, v_row_id)
            INTO v_differs;
        END IF;

        IF coalesce(v_differs, false) THEN
          DELETE FROM public.oplog WHERE op_id = v_op_id::uuid;
          RETURN jsonb_build_object('op_id', v_op_id, 'status', 'rejected', 'code', 'row_exists');
        END IF;
        -- Benign duplicate -- fall through to the `applied` return below.
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

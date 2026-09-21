-- ============================================================================
-- 0018_debt_total_paid_server_derived.sql
--
-- FORWARD migration (CREATE OR REPLACE only); it does not edit 0001-0017, so
-- historical replay stays intact. Idempotent: safe to re-run and safe on a
-- fresh `supabase db reset`.
--
-- Function re-issued below, copied from its LIVE definition and nothing
-- older:
--   private.apply_one_op  -- 0016 (SEC2-5), copied BYTE-FOR-BYTE with the
--                            documented change below and nothing else.
--                            (0017 re-issues only
--                            public.check_and_reserve_notify_send_v2 and does
--                            NOT redefine apply_one_op; 0016 is the latest
--                            live body. Verified by grepping every migration
--                            for `CREATE OR REPLACE FUNCTION
--                            private.apply_one_op`.)
--
-- THE BUG
-- -------
-- A debt payment is pushed by the client as TWO INDEPENDENT `increment` ops
-- on public.debts (src/domain/debtSnowball/LogDebtPaymentUseCase.ts):
--
--   1. {field: 'outstanding_balance_cents', delta: -X, clamp: 'floor_zero'}
--   2. {field: 'total_paid_cents',          delta: +X, clamp: 'none'}
--
-- The increment path below applies each one blindly -- `greatest(0, col +
-- delta)` for floor_zero, `col + delta` otherwise -- and the two ops know
-- nothing about each other. The client sizes BOTH deltas from the row as it
-- is at write time, which makes ONE device self-consistent, but it cannot see
-- another device's concurrent payment.
--
-- So: a debt owes exactly X. Device A and device B each log a payment of X
-- while offline (both read balance = X, both size their deltas X). Both push.
-- The balance decrements clamp: X -> 0 -> 0. But `total_paid_cents` carries
-- `clamp: 'none'` and has no such floor, so it climbs 0 -> X -> 2X. The
-- household's debt row now claims 2X was paid against a debt that only ever
-- owed X -- money that was never paid. Worse, every client then CONVERGES
-- onto that wrong number: SyncEngine.reconcileIncrementedRows
-- (src/data/sync/SyncEngine.ts) fetches the server row after each pull and
-- writes it over the local row precisely because the server is supposed to be
-- the truth for a non-idempotent op.
--
-- The same over-credit happens without any concurrency at all whenever the
-- balance clamp bites: a payment larger than the balance (an overpayment, or
-- a stale screen) decrements the balance by only what was owed but credits
-- `total_paid_cents` with the whole payment.
--
-- THE FIX (server-side; the wire protocol is UNCHANGED)
-- ----------------------------------------------------
-- `total_paid_cents` stops being an independently-writable column and becomes
-- SERVER-DERIVED from the movement the balance decrement actually achieved --
-- the same treatment `is_paid_off` already gets from the
-- `derive_debt_is_paid_off` trigger (0001 §9g), and for the same reason: a
-- value that is a pure function of the balance must never be able to
-- independently diverge from it.
--
--   (a) An `increment` on debts.outstanding_balance_cents with a NEGATIVE
--       delta now moves BOTH columns in ONE statement:
--
--         outstanding_balance_cents = <today's expression, unchanged>
--         total_paid_cents = total_paid_cents
--                            + (outstanding_balance_cents - <same expression>)
--
--       Postgres evaluates every SET expression against the OLD row, so both
--       bare `outstanding_balance_cents` references on the right-hand side
--       are the pre-update balance: the credit is exactly
--       `old_balance - new_balance`, i.e. what the decrement ACTUALLY
--       applied after the clamp. One statement, so it is atomic against
--       anything else in the same transaction, and every caller
--       (public.sync_push -- 0007; public.apply_server_op -- 0001 §9f) has
--       already taken the per-household advisory lock
--       `pg_advisory_xact_lock(hashtextextended(household_id, 0))` before
--       reaching this function, which serializes writers for the household
--       outright. Nothing here needs its own FOR UPDATE.
--
--       The BALANCE expression itself is byte-for-byte today's, including
--       the clamp switch: `greatest(0, col + delta)` for `floor_zero`,
--       `col + delta` for anything else. So for the unclamped case the
--       credit is simply `-delta`, exactly as the client intended, and the
--       balance still goes wherever it goes today.
--
--   (b) An `increment` on debts.total_paid_cents applies NOTHING to the row
--       -- the column is derived by (a) now, and applying the client's
--       +X on top would double-count every payment. The op is still
--       ACCEPTED: the oplog row appended at the top of the savepoint is
--       KEPT, and the answer is `status:'applied', code:null`, byte-for-byte
--       what every client sees today.
--
--       That last part is the backward-compatibility requirement, not a
--       nicety. Older builds stay in the field forever. 1.1.130/1.1.134 do
--       not know any new reject code: a rejection would fall through their
--       "unexpected reject code" branch, be retried to the cap -- stalling
--       that household's entire push queue on every round in between -- and
--       then dead-letter the op and surface it to the user as "couldn't be
--       saved to the cloud", for an op the server deliberately ignored.
--       Keeping the oplog row also keeps the op in the household's pull
--       stream, so other devices still see it and the seq sequence has no
--       holes.
--
--   Positive deltas on outstanding_balance_cents -- a debt being INCREASED
--   rather than paid down -- fall through to the unchanged generic
--   increment path and must NOT touch total_paid_cents: money borrowed is
--   not money repaid. (No client code path produces one today: the only
--   `opType: 'increment'` producers in src/ are
--   LogDebtPaymentUseCase.ts's two ops -- balance always -actualApplied,
--   total_paid always +actualApplied, with actualApplied > 0 -- and the
--   generic createSyncedRepo.increment helper, which nothing calls. The
--   guard is written for the ops that could arrive, not the ops that do.)
--
--   A NULL/non-numeric delta behaves exactly as today. `(v_delta)::numeric
--   < 0` is NULL for a missing delta, so the IF is false and the op takes
--   the unchanged generic path (which writes NULL into a NOT NULL column
--   and is rejected 23502 by the EXCEPTION handler, as today); a
--   non-numeric delta raises 22P02 from the cast, the same SQLSTATE the
--   generic path's own cast raises, so the reject code the client sees is
--   unchanged.
--
-- EXISTING DATA IS NOT REPAIRED
-- -----------------------------
-- This migration deliberately does NOT try to correct historical
-- `total_paid_cents` values. There is no reliable source of truth to correct
-- them FROM: the oplog is pruned, `initial_balance_cents` is a client-entered
-- figure that later edits move, and a legitimately over-credited row is
-- indistinguishable from a debt whose balance was manually revised upward
-- after payments. Guessing would destroy correct data in every household
-- that never hit the bug. Rows already over-credited stay as they are and
-- stop drifting further from the next payment on; a household that wants the
-- figure corrected can edit the debt.
--
-- CHANGE SET vs the 0016 body (the ONLY differences):
--   1. DECLARE: one new variable, `v_bal_expr text;`.
--   2. The `v_op_type = 'increment'` APPLY branch (the one at the bottom, not
--      the field-allowlist check near the top, which is untouched): two new
--      leading arms for debts.total_paid_cents (no-op) and for
--      debts.outstanding_balance_cents with a negative delta (the two-column
--      single statement). The existing floor_zero / else arms are unchanged
--      and still handle every other table, field and delta sign.
-- Everything else -- validation, the SEC2-11 `server:` device_id guard, the
-- slip_queue column ownership rules, the household_members per-op
-- authorization, the oplog append, the column allowlist, the SEC2-5
-- row_exists convergence logic on the insert path, the update/delete paths,
-- the EXCEPTION handler, search_path, SECURITY DEFINER, ownership and grants
-- -- is byte-for-byte 0016.
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
  -- 0018: the debts balance-decrement expression, built ONCE so the same
  -- text is used for the new balance AND for the amount credited to
  -- total_paid_cents (old balance minus new balance). See the increment
  -- apply branch below.
  v_bal_expr text;
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
      -- different VALUES for the SAME deterministic id forever (see
      -- 0016's header). But a suppressed insert is NOT automatically a
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
      -- ----------------------------------------------------------------
      -- 0018: debts.total_paid_cents is SERVER-DERIVED from the balance
      -- decrement (see this file's header). Two arms are inserted ahead of
      -- the unchanged generic arms below; everything that is not a debts
      -- money column still takes exactly the path it took in 0016.
      -- ----------------------------------------------------------------
      IF v_table = 'debts' AND v_field = 'total_paid_cents' THEN
        -- (b) The client's own +X op. The column is derived by the arm
        -- below now, so applying this on top would double-count the
        -- payment. Apply NOTHING to the row -- but the op is still
        -- ACCEPTED: the oplog row stays (so the op reaches every other
        -- device's pull stream and the seq sequence has no holes) and the
        -- answer is the unchanged `status:'applied', code:null` at the
        -- bottom of this savepoint. A rejection here would dead-letter the
        -- op on every build in the field, none of which knows a new code.
        NULL;
      ELSIF v_table = 'debts' AND v_field = 'outstanding_balance_cents'
            AND (v_delta)::numeric < 0 THEN
        -- (a) A payment. Build the balance expression ONCE -- byte-for-byte
        -- the generic arms' expression, clamp switch included -- and use it
        -- twice in ONE statement: once as the new balance, once to work out
        -- what the decrement ACTUALLY achieved.
        --
        -- Postgres evaluates every SET expression against the OLD row, so
        -- the bare `outstanding_balance_cents` in the second expression is
        -- the PRE-update balance: the credit is exactly
        -- `old_balance - new_balance`. Pay X against a debt owing X and
        -- total_paid gains X; pay X against a debt owing less (an
        -- overpayment, or a second device's concurrent payment that
        -- already cleared it) and total_paid gains only what was really
        -- owed -- 0 if the debt was already settled.
        --
        -- Single statement => atomic, and every caller already holds the
        -- per-household advisory lock, so no FOR UPDATE is needed.
        v_bal_expr := CASE
          WHEN v_clamp = 'floor_zero'
            THEN format('greatest(0, outstanding_balance_cents + (%L)::numeric)', v_delta)
          ELSE format('outstanding_balance_cents + (%L)::numeric', v_delta)
        END;
        EXECUTE format(
          'UPDATE public.debts SET outstanding_balance_cents = %1$s, '
          || 'total_paid_cents = total_paid_cents + (outstanding_balance_cents - (%1$s)) '
          || 'WHERE id = %2$L',
          v_bal_expr, v_row_id);
      ELSIF v_clamp = 'floor_zero' THEN
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

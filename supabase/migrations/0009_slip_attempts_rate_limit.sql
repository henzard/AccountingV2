-- ============================================================================
-- 0009_slip_attempts_rate_limit.sql
--
-- Deep-review remediation, continued (0008 is reserved by another agent).
-- This is a FORWARD migration (new table + CREATE OR REPLACE); it does not
-- edit 0001-0007 so historical replay stays intact. Idempotent: safe to
-- re-run and safe on a fresh `supabase db reset`.
--
--   DB-2 (HIGH)  check_and_reserve_slip_slot (0003) counts slip_queue rows by
--       client-writable created_at/created_by, and its reservation
--       (UPDATE ... WHERE status = 'pending') is idempotent against a row
--       whose status a client can also write. So the 25/user & 50/household
--       per-24h limit on paid OpenAI calls (supabase/functions/extract-slip)
--       was bypassable by: (a) back-dating created_at on a locally-inserted
--       slip_queue row before it syncs, so it never falls inside the
--       function's own 24h window; (b) resetting a slip's status back to
--       'failed' after extraction and re-triggering extraction for the same
--       slip_id for a free re-run; (c) firing calls in parallel to race the
--       count-then-reserve window.
--       FIX: a new server-clock-only public.slip_extraction_attempts table
--       (attempted_at defaults to now(), never client-supplied) is the sole
--       source for both the 24h household/user counts AND a new 60-second
--       per-slip_id lease, so back-dating slip_queue.created_at or flipping
--       slip_queue.status can no longer influence either the count or the
--       reservation. check_and_reserve_slip_slot keeps its exact signature
--       and return shape (`{allowed: boolean, reason?: string}`), so
--       supabase/functions/extract-slip/index.ts (~156-171), which only
--       reads `.allowed` / `.reason` off the result, needs no change.
--
--       apply_one_op is also updated to stop slip_queue.openai_cost_cents and
--       .created_by from ever taking a client-supplied value via sync_push
--       (see the comment on the slip_queue special-case below for why
--       `status` is deliberately left writable, unlike DB-2's original
--       "exclude status/openai_cost_cents/raw_response_json" framing --
--       src/domain/slipScanning/ExtractSlipUseCase.ts and ConfirmSlipUseCase
--       both legitimately push `status` transitions, and the rate limiter no
--       longer depends on it at all, so locking it would break real syncing
--       for zero security benefit).
--
--   DB-12 (small, non-SQL)  supabase/functions/notify-event/index.ts pruned a
--       device's FCM token on ANY INVALID_ARGUMENT error, not just ones about
--       the token itself (e.g. a malformed message body would also look like
--       a dead token and get the device wrongly unregistered). Fixed directly
--       in that file + its Deno test (no SQL involved) -- see the
--       __tests__/notify-event.test.ts changes alongside this migration.
-- ============================================================================

-- ----------------------------------------------------------------------
-- DB-2: server-clock-only ledger of extraction attempts. RLS is enabled with
-- NO policies -- only check_and_reserve_slip_slot (SECURITY DEFINER, runs as
-- the table owner, bypasses RLS) ever reads/writes it; no authenticated/anon
-- grant is issued either.
-- ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.slip_extraction_attempts (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id text NOT NULL,
    household_id text NOT NULL,
    slip_id text NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slip_extraction_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_slip_extraction_attempts_household_attempted
  ON public.slip_extraction_attempts USING btree (household_id, attempted_at);

CREATE INDEX IF NOT EXISTS idx_slip_extraction_attempts_user_attempted
  ON public.slip_extraction_attempts USING btree (user_id, attempted_at);

CREATE INDEX IF NOT EXISTS idx_slip_extraction_attempts_slip_attempted
  ON public.slip_extraction_attempts USING btree (slip_id, attempted_at);

-- ----------------------------------------------------------------------
-- DB-2: public.check_and_reserve_slip_slot. Body is 0003's CURRENT (and
-- only) definition, same signature and same `{allowed, reason?}` return
-- shape, with the household/user COUNT source switched from slip_queue
-- (client-writable created_at) to slip_extraction_attempts (server-clock
-- attempted_at, populated only by this function), and a new 60-second
-- per-slip_id lease that closes the "reset status to failed, re-extract for
-- free" race independently of slip_queue.status.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_reserve_slip_slot(p_household_id text, p_user_id text, p_slip_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cutoff        timestamptz;
  v_household_cnt int;
  v_user_cnt      int;
  v_caller_id     text;
BEGIN
  -- Verify the RPC caller matches the claimed user_id.
  v_caller_id := auth.uid()::text;
  IF v_caller_id IS NULL OR v_caller_id <> p_user_id THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthorized');
  END IF;

  -- Serialize all concurrent calls for this household.
  PERFORM pg_advisory_xact_lock(hashtext(p_household_id));

  -- DB-2: 60-second lease per slip_id, keyed off the server-clock
  -- attempted_at column -- NOT slip_queue.status, which a client can reset
  -- (e.g. back to 'failed') to make an idempotent status-scoped reservation
  -- look available again. A second reservation attempt for the SAME slip
  -- within the lease is refused outright, before it can consume any of the
  -- 24h household/user budget.
  IF EXISTS (
    SELECT 1 FROM public.slip_extraction_attempts
    WHERE slip_id = p_slip_id
      AND attempted_at >= NOW() - INTERVAL '60 seconds'
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'lease_active');
  END IF;

  v_cutoff := NOW() - INTERVAL '24 hours';

  -- DB-2: counted from slip_extraction_attempts.attempted_at (this
  -- function's own server-side timestamp), not slip_queue.created_at (client
  -- writable, and back-datable before the row ever syncs) -- so back-dating
  -- a slip_queue row can no longer exempt it from the 24h window.
  SELECT COUNT(*) INTO v_household_cnt
  FROM public.slip_extraction_attempts
  WHERE household_id = p_household_id
    AND attempted_at >= v_cutoff;

  IF v_household_cnt >= 50 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'household_limit');
  END IF;

  SELECT COUNT(*) INTO v_user_cnt
  FROM public.slip_extraction_attempts
  WHERE household_id = p_household_id
    AND user_id = p_user_id
    AND attempted_at >= v_cutoff;

  IF v_user_cnt >= 25 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit');
  END IF;

  -- Record the attempt BEFORE the reservation UPDATE below, so both the 60s
  -- lease and the 24h counts are correct even when the UPDATE finds nothing
  -- to reserve (slot_not_reserved) -- an attempt/slot was still spent, so a
  -- caller cannot get free retries by hammering an already-processing slip.
  INSERT INTO public.slip_extraction_attempts (user_id, household_id, slip_id)
  VALUES (p_user_id, p_household_id, p_slip_id);

  -- Reserve the slot: transition slip from pending -> processing atomically.
  UPDATE public.slip_queue
  SET status     = 'processing',
      updated_at = NOW()
  WHERE id           = p_slip_id
    AND status       = 'pending'
    AND household_id = p_household_id
    AND created_by   = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'slot_not_reserved');
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_reserve_slip_slot(text, text, text) TO service_role;

-- ----------------------------------------------------------------------
-- DB-2 -- RECONCILIATION NOTE: three migrations in this batch (0007, 0008,
-- 0009) each CREATE OR REPLACE this function, so each one's body must
-- contain every earlier one's changes or a later migration silently reverts
-- an earlier fix. This body is derived from 0008's CURRENT definition (which
-- is itself 0007's DB-1/DB-9/SYNC-4 body + 'envelope_contributions' added to
-- c_tables -- see 0008's own reconciliation note), byte-for-byte, with
-- ONE addition on top: a slip_queue-only special-case that strips
-- openai_cost_cents from any insert/update payload (it is computed
-- server-side, in raw ZAR cents, by the extract-slip edge function's
-- service_role write -- never by a client) and pins created_by to the
-- authenticated caller on insert (never the payload's claimed value) --
-- WITHOUT rejecting the whole op the way an unknown/disallowed column
-- normally would. A hard forbidden_column rejection was ruled out here
-- because src/domain/slipScanning/ExtractSlipUseCase.ts pushes
-- openai_cost_cents in the SAME combined update op as the legitimate
-- status='completed' transition (merchant/slip_date/total_cents/
-- raw_response_json alongside it) -- rejecting that whole op would silently
-- stop OTHER devices in the household from ever seeing the slip complete via
-- oplog (this device's own local copy is already correct; only the
-- oplog fan-out to siblings depends on this op being accepted). Silently
-- dropping just the protected keys (the value the client sent is redundant
-- anyway -- the edge function already wrote the authoritative value directly
-- via its service_role admin client, bypassing sync_push entirely) closes
-- the tamper vector with no functional loss. `status` and
-- `raw_response_json` are deliberately left fully writable: the rate limiter
-- above no longer reads slip_queue at all, so there is nothing left for a
-- writable `status` to bypass.
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
  -- 0009 (DB-2): slip_queue system-owned columns. Strip openai_cost_cents
  -- from the payload entirely (the client's value, if any, is simply
  -- ignored -- never applied), and force created_by to the authenticated
  -- caller on insert (ignoring whatever the payload claims), so a caller can
  -- never attribute a slip to someone else and skew that other user's rate
  -- limit / cost accounting. Done BEFORE the forbidden_column allowlist
  -- check below so a legitimate combined payload (e.g. ExtractSlipUseCase's
  -- completed-transition, which includes openai_cost_cents alongside
  -- status/merchant/etc.) is never rejected wholesale -- only the protected
  -- keys' values are discarded/overridden.
  -- --------------------------------------------------------------------
  IF v_table = 'slip_queue' THEN
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
  -- enumeration of rejected cases).
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

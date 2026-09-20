-- ============================================================================
-- 0008_envelope_contributions.sql
--
-- Makes savings REAL: a ledger of money moved INTO a persistent envelope
-- ('sinking_fund' | 'emergency_fund' | 'savings' | 'baby_step').
--
-- Persistent envelopes keep ONE row across every budget period, so nothing
-- recorded that a period had actually funded them: `envelopes.allocated_cents`
-- is the MONTHLY contribution the user budgets, and reading it as "saved"
-- meant a fund showed the same figure forever however many months had been
-- budgeted -- and Baby Step 1 "completed" the instant someone typed R1,000
-- into the allocation field. With this table a persistent envelope's saved
-- balance is DERIVED, exactly as period-envelope spend already is:
--
--   saved_cents = SUM(envelope_contributions.amount_cents)
--               - SUM(transactions.amount_cents)
--
-- Rows are append-only and carry deterministic ids (uuidv5 over
-- household:envelope:period, the same pattern as `rolloverEnvelopeId`), so a
-- double rollover -- and two offline devices rolling the same period
-- transition over independently -- converge on ONE row: `apply_one_op`'s
-- `INSERT ... ON CONFLICT (id) DO NOTHING` makes the duplicate a no-op
-- instead of double-funding the envelope.
--
-- DEPLOY ORDER: this migration MUST be applied before a client carrying the
-- matching local migration 0016 ships. Until it is, every
-- `envelope_contributions` op is rejected by `apply_one_op` with
-- `unsupported` (the table is not in its allowlist), so contributions would
-- stay device-local and never replicate.
--
-- The two function redefinitions below are FORWARD migrations
-- (CREATE OR REPLACE), matching 0002/0004/0005's pattern: each body is the
-- CURRENT definition of that function, byte-for-byte, with ONLY the
-- `c_tables` allowlist extended by 'envelope_contributions'.
--   * private.apply_one_op  -- last fully defined in 0005
--   * public.sync_row_state -- last fully defined in 0004
-- `public.sync_push` needs no change: it has no table allowlist of its own
-- and delegates every op to `private.apply_one_op`.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE POLICY guarded by DROP
-- POLICY IF EXISTS + pure CREATE OR REPLACE FUNCTION; safe to re-run and safe
-- on a fresh `supabase db reset`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.envelope_contributions (
    id text NOT NULL,
    household_id text NOT NULL,
    envelope_id text NOT NULL,
    amount_cents bigint NOT NULL,
    period_start text NOT NULL,
    source text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    deleted_at timestamptz
);

ALTER TABLE public.envelope_contributions
    DROP CONSTRAINT IF EXISTS envelope_contributions_pkey;
ALTER TABLE ONLY public.envelope_contributions
    ADD CONSTRAINT envelope_contributions_pkey PRIMARY KEY (id);

ALTER TABLE public.envelope_contributions
    DROP CONSTRAINT IF EXISTS envelope_contributions_household_id_fkey;
ALTER TABLE ONLY public.envelope_contributions
    ADD CONSTRAINT envelope_contributions_household_id_fkey
    FOREIGN KEY (household_id) REFERENCES public.households(id);

CREATE INDEX IF NOT EXISTS idx_envelope_contributions_household_envelope
    ON public.envelope_contributions USING btree (household_id, envelope_id);

-- RLS: same household-membership read scope every other synced table uses.
-- Writes never go through PostgREST directly -- only through the SECURITY
-- DEFINER sync RPCs -- so there is no INSERT/UPDATE/DELETE policy here,
-- matching baby_steps/envelopes/transactions.
ALTER TABLE public.envelope_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS envelope_contributions_select ON public.envelope_contributions;
CREATE POLICY envelope_contributions_select ON public.envelope_contributions
  FOR SELECT TO authenticated
  USING (private.is_household_member(household_id));

GRANT SELECT ON public.envelope_contributions TO authenticated, anon;
GRANT ALL ON public.envelope_contributions TO service_role;

-- ----------------------------------------------------------------------
-- private.apply_one_op -- reconciliation note (added when 0008 was
-- reassigned to this agent): this body MUST be 0007's CURRENT definition
-- (DB-1/DB-9 membership hardening + SYNC-4 row_missing), not 0005's,
-- because 0007 is applied before 0008 in migration order. The original
-- author based this file on 0005 (the last body at the time 0008 was
-- authored), which -- applied after 0007 -- would have SILENTLY REVERTED
-- every one of 0007's security fixes via CREATE OR REPLACE. Fixed: the
-- body below is 0007's CURRENT definition, byte-for-byte, with ONLY the
-- `c_tables` allowlist extended by 'envelope_contributions'. That table
-- needs no other special-case here: it is a plain household-scoped,
-- append-only table (household_id + envelope_id + deterministic id),
-- and the existing generic INSERT branch's `ON CONFLICT (id) DO NOTHING`
-- already gives it the same double-apply/double-rollover safety as any
-- other allowlisted table -- no household_members-style per-op
-- authorization branch applies to it.
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
-- public.sync_row_state -- 0004's body with 'envelope_contributions' added
-- to the table allowlist. Nothing else changed.
-- ----------------------------------------------------------------------


CREATE OR REPLACE FUNCTION public.sync_row_state(p_household_id text, p_table text, p_row_id text)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
DECLARE
  c_tables constant text[] := array['households', 'household_members', 'envelopes', 'envelope_contributions', 'transactions', 'debts', 'meter_readings', 'baby_steps', 'slip_queue'];
  v_row jsonb;
BEGIN
  IF NOT (p_table = ANY (c_tables)) THEN
    RAISE EXCEPTION 'unsupported table: %', p_table USING ERRCODE = '22023';
  END IF;
  IF NOT private.is_household_member(p_household_id) THEN
    RETURN NULL;
  END IF;
  IF p_table = 'households' THEN
    -- households has NO household_id column (a household IS its own scope — its
    -- id is the household id). Scope on the row's own id = p_household_id, the
    -- membership-verified scope, mirroring apply_one_op's households special-case
    -- (migration 0002). p_row_id is ignored: for a well-formed households op
    -- row_id = household_id, and scoping on the authenticated scope prevents
    -- ever returning a row outside the caller's household.
    EXECUTE format('SELECT to_jsonb(t) FROM public.households t WHERE t.id = %L',
                   p_household_id)
      INTO v_row;
  ELSE
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = %L AND t.household_id = %L',
                   p_table, p_row_id, p_household_id)
      INTO v_row;
  END IF;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_row_state(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_row_state(text, text, text) TO authenticated;

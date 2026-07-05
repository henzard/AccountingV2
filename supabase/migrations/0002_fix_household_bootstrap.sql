-- ============================================================================
-- 0002_fix_household_bootstrap.sql
--
-- Fixes the CRITICAL oplog-sync bootstrap bug: a brand-new user could never
-- create their first household on a real remote — every households + owner
-- membership insert pushed through public.sync_push was rejected. Three
-- independent defects combined to make create-household impossible; each is
-- fixed below. This is a FORWARD migration (CREATE OR REPLACE + ALTER); it
-- does not edit 0001 so historical replay stays intact.
--
--   BUG 1  private.apply_one_op hardcoded `INSERT INTO public.<t>
--          (id, household_id, ...)` for every table. `public.households` has
--          NO household_id column (a household IS its own scope — its id is
--          the household id), so a households insert op raised
--          `column "household_id" does not exist`. FIX: special-case
--          v_table = 'households' in the insert branch to omit household_id.
--
--   BUG 2  apply_one_op writes the oplog row (household_id = H) BEFORE the
--          entity row, but oplog_household_id_fkey required households(H) to
--          already exist — so a households insert op FK-violated on the oplog
--          write itself. FIX: make oplog_household_id_fkey DEFERRABLE
--          INITIALLY DEFERRED so it is validated at COMMIT, by which time the
--          same sync_push transaction has inserted the household.
--
--   BUG 3  public.sync_push rejected every op for a household the caller is
--          not YET a member of ('not_member'), so the owner's own first
--          household + membership could never apply — a bootstrap deadlock.
--          FIX: authorize an op batch for household H if the caller is a
--          member OR the batch self-bootstraps H (contains a household_members
--          insert with role='owner' AND user_id = auth.uid() for H) AND H has
--          NO existing active members. The "no existing members" guard, checked
--          UNDER the per-household advisory lock, blocks hijacking an existing
--          (member-having) household; the user_id = caller guard blocks making
--          anyone but yourself the owner.
-- ============================================================================

-- ----------------------------------------------------------------------
-- BUG 2: defer the oplog -> households FK to COMMIT.
-- ----------------------------------------------------------------------
ALTER TABLE public.oplog DROP CONSTRAINT oplog_household_id_fkey;
ALTER TABLE public.oplog
  ADD CONSTRAINT oplog_household_id_fkey
  FOREIGN KEY (household_id) REFERENCES public.households(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ----------------------------------------------------------------------
-- BUG 1: private.apply_one_op — special-case the households insert so it
-- does NOT inject a (non-existent) household_id column. Every other branch
-- is byte-for-byte identical to 0001.
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

  BEGIN  -- per-op savepoint
    -- Record first so a duplicate op_id short-circuits to 'applied'
    -- (duplicate-ack, spec §6.11) before any apply work happens.
    INSERT INTO public.oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
    VALUES (v_op_id::uuid, v_hh, v_table, v_row_id, v_op_type, v_payload,
            (p_op->>'actor_user_id')::uuid, p_op->>'device_id', (p_op->>'client_created_at')::timestamptz)
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
      EXECUTE format('SELECT household_id FROM public.%I WHERE id = %L', v_table, v_row_id)
        INTO v_actual;
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
-- BUG 3: public.sync_push — allow secure owner self-bootstrap of a NEW
-- household. Membership (or a valid bootstrap) is resolved once per distinct
-- household under the per-household advisory lock; every op for an
-- unauthorized household is rejected 'not_member'. Input order + the
-- deadlock-safe ORDER BY 1 lock acquisition are preserved.
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
  -- (else AB/BA deadlock). See the hashtextextended note in 0001.
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
    -- authorize — the "no existing members" guard below (checked under the
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
      -- valid for a household with NO existing active members. This is the
      -- anti-hijack guard — you cannot insert yourself as owner of a
      -- household that already has members.
      IF v_bootstrap AND EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = v_hh AND deleted_at IS NULL
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

-- 0019_backfill_unlogged_rows.sql
--
-- WHY. Phones do not read the data tables. After the one-off snapshot taken
-- when a device first joins a household, a phone converges purely by pulling
-- public.oplog through sync_pull. Every legitimate writer therefore goes
-- through private.apply_one_op (sync_push for phones, apply_server_op for
-- server code), which appends the oplog row AND applies it.
--
-- A row written straight into a data table (SQL editor, a script, an AI
-- assistant using the service key, the table editor in the dashboard) has NO
-- oplog row. It exists on the server and is invisible to every phone that has
-- already joined the household -- which is exactly what was reported: rows
-- added to public.transactions for a household never appeared in the app.
--
-- WHAT. private.backfill_unlogged_rows(p_household_id) appends a synthetic
-- `insert` op for every row of a synced DATA table that has no oplog row at
-- all. Phones then pull it like any other op. It only ever APPENDS to the
-- oplog: it never touches a data row, so it cannot change any balance on the
-- server. Locally the op is applied with INSERT OR IGNORE, so a phone that
-- already has the row (it restored after the row was written, or the row
-- predates the oplog going live) treats it as a no-op.
--
--   * Idempotent: a second run finds the ops it wrote and adds nothing.
--   * Holds the same per-household advisory lock sync_push / apply_server_op
--     take, so a concurrent push cannot commit a higher seq first and let a
--     puller's cursor step over these ops.
--   * Payload mirrors a client insert: every column except id / household_id
--     (they travel in the op envelope), timestamps in the client's
--     `YYYY-MM-DDTHH:MM:SS.mmmZ` form. envelopes.spent_cents is left out: it
--     is server-derived and the phones' local table does not have it.
--   * households / household_members are deliberately NOT covered: membership
--     has its own authorization rules and must never be minted by a repair.
--
-- It cannot see a row that was UPDATED or DELETED outside the oplog -- there
-- is nothing to compare against. Writers must use apply_server_op; see
-- docs/server-side-data-changes.md.

CREATE OR REPLACE FUNCTION private.backfill_unlogged_rows(p_household_id text DEFAULT NULL)
RETURNS TABLE (backfilled_table text, backfilled_household text, backfilled_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- Parents before children, so a phone applies an envelope before the
  -- transactions that point at it.
  c_tables constant text[] := array[
    'envelopes', 'debts', 'baby_steps', 'envelope_contributions',
    'meter_readings', 'slip_queue', 'transactions'];
  v_table   text;
  v_hh      text;
  v_payload text;
BEGIN
  -- Same lock, same key, as sync_push and apply_server_op. Sorted so two
  -- concurrent backfills cannot deadlock each other.
  FOR v_hh IN
    SELECT h.id FROM public.households h
    WHERE p_household_id IS NULL OR h.id = p_household_id
    ORDER BY h.id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hh, 0));
  END LOOP;

  FOREACH v_table IN ARRAY c_tables LOOP
    SELECT pg_catalog.string_agg(
             pg_catalog.format(
               '%L, %s',
               a.attname,
               CASE
                 WHEN t.typname = 'timestamptz' THEN pg_catalog.format(
                   'pg_catalog.to_char(r.%I AT TIME ZONE ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')',
                   a.attname)
                 ELSE pg_catalog.format('r.%I', a.attname)
               END),
             ', ' ORDER BY a.attnum)
      INTO v_payload
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = ('public.' || pg_catalog.quote_ident(v_table))::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname NOT IN ('id', 'household_id')
      AND NOT (v_table = 'envelopes' AND a.attname = 'spent_cents');

    RETURN QUERY EXECUTE pg_catalog.format(
      $q$
      WITH ins AS (
        INSERT INTO public.oplog
          (op_id, household_id, table_name, row_id, op_type, payload,
           actor_user_id, device_id, client_created_at)
        SELECT pg_catalog.gen_random_uuid(), r.household_id, %1$L, r.id, 'insert',
               pg_catalog.jsonb_build_object(%2$s),
               NULL, 'server:backfill', r.created_at
        FROM public.%1$I r
        WHERE ($1::text IS NULL OR r.household_id = $1::text)
          AND NOT EXISTS (
            SELECT 1 FROM public.oplog o
            WHERE o.table_name = %1$L
              AND o.row_id = r.id
              AND o.household_id = r.household_id)
        ORDER BY r.created_at, r.id
        RETURNING household_id
      )
      SELECT %1$L::text, ins.household_id::text, pg_catalog.count(*)::bigint
      FROM ins GROUP BY ins.household_id
      $q$,
      v_table, v_payload)
    USING p_household_id;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION private.backfill_unlogged_rows(text) FROM PUBLIC;

-- One-off repair for every household, reported through NOTICEs so the
-- `supabase db push` output records exactly what was repaired.
DO $do$
DECLARE
  rec   record;
  total bigint := 0;
BEGIN
  FOR rec IN SELECT * FROM private.backfill_unlogged_rows(NULL) LOOP
    RAISE NOTICE 'backfill_unlogged_rows: % row(s) of % for household %',
      rec.backfilled_rows, rec.backfilled_table, rec.backfilled_household;
    total := total + rec.backfilled_rows;
  END LOOP;
  RAISE NOTICE 'backfill_unlogged_rows: % row(s) backfilled in total', total;
END;
$do$;

-- supabase/tests/backfill_unlogged_rows.test.sql
--
-- pgTAP for 0019: private.backfill_unlogged_rows.
--
-- Phones converge only by pulling public.oplog, so a row written straight into
-- a data table (SQL editor / script / assistant using the service key) is
-- invisible to every phone already in the household. The backfill appends a
-- synthetic `insert` op for each such row. It must: reach a member through
-- sync_pull, carry a client-shaped payload, leave rows that already have an op
-- alone, be idempotent, respect the household argument, never touch a data
-- row, and never be callable by an app user.

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ---------------------------------------------------------------------------
-- Seed (as postgres, RLS bypassed)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000b1', 'backfill-owner@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'backfill-other@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-bf', 'Backfill Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-bf-other', 'Other Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-bf', 'hh-bf', '00000000-0000-0000-0000-0000000000b1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-bf-other', 'hh-bf-other', '00000000-0000-0000-0000-0000000000b2', 'owner', '2026-01-01T00:00:00.000Z');

-- Rows written STRAIGHT into the data tables -- no oplog rows. This is the
-- reported situation: an assistant inserted transactions with the service key.
insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-bf-raw', 'hh-bf', 'Groceries', 500000, 12345, 'spending', '2026-01-25', '2026-02-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z'),
  ('env-bf-other', 'hh-bf-other', 'Fuel', 100000, 0, 'spending', '2026-01-25', '2026-02-01T08:00:00.000Z', '2026-02-01T08:00:00.000Z');

insert into public.transactions (id, household_id, envelope_id, amount_cents, payee, transaction_date, is_business_expense, created_at, updated_at)
values
  ('tx-bf-raw-1', 'hh-bf', 'env-bf-raw', 25000, 'Woolworths', '2026-02-02', false, '2026-02-02T09:30:15.250Z', '2026-02-02T09:30:15.250Z'),
  ('tx-bf-raw-2', 'hh-bf', 'env-bf-raw', -5000, 'Woolworths refund', '2026-02-03', true, '2026-02-03T10:00:00.000Z', '2026-02-03T10:00:00.000Z'),
  ('tx-bf-other', 'hh-bf-other', 'env-bf-other', 9900, 'Engen', '2026-02-02', false, '2026-02-02T09:00:00.000Z', '2026-02-02T09:00:00.000Z');

-- A row that DID arrive through the oplog: it must be left alone.
insert into public.transactions (id, household_id, envelope_id, amount_cents, payee, transaction_date, is_business_expense, created_at, updated_at)
values ('tx-bf-logged', 'hh-bf', 'env-bf-raw', 1000, 'Spar', '2026-02-04', false, '2026-02-04T09:00:00.000Z', '2026-02-04T09:00:00.000Z');
insert into public.oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
values ('00000000-0000-0000-0000-00000000bf01', 'hh-bf', 'transactions', 'tx-bf-logged', 'insert', '{"amount_cents":1000}'::jsonb, 'devA', '2026-02-04T09:00:00.000Z');

-- ===========================================================================
-- 1. Scoped run: only hh-bf is repaired
-- ===========================================================================
select is(
  (select coalesce(sum(backfilled_rows), 0)::int from private.backfill_unlogged_rows('hh-bf')),
  3,
  'scoped run backfills the 3 unlogged rows of hh-bf (1 envelope + 2 transactions)');

select is(
  (select count(*)::int from public.oplog where household_id = 'hh-bf' and device_id = 'server:backfill'),
  3,
  'exactly 3 synthetic ops were appended for hh-bf');

select is(
  (select count(*)::int from public.oplog where household_id = 'hh-bf-other'),
  0,
  'the other household is untouched by a scoped run');

select is(
  (select count(*)::int from public.oplog where row_id = 'tx-bf-logged'),
  1,
  'a row that already has an oplog row gets no second op');

-- ===========================================================================
-- 2. The op is shaped like a client insert
-- ===========================================================================
select is(
  (select op_type from public.oplog where row_id = 'tx-bf-raw-1'),
  'insert',
  'the synthetic op is an insert');

select is(
  (select payload->>'amount_cents' from public.oplog where row_id = 'tx-bf-raw-1'),
  '25000',
  'payload carries the amount');

select is(
  (select jsonb_typeof(payload->'amount_cents') from public.oplog where row_id = 'tx-bf-raw-2'),
  'number',
  'a negative amount stays a JSON number');

select is(
  (select payload->'is_business_expense' from public.oplog where row_id = 'tx-bf-raw-2'),
  'true'::jsonb,
  'booleans stay JSON booleans');

select is(
  (select payload->>'created_at' from public.oplog where row_id = 'tx-bf-raw-1'),
  '2026-02-02T09:30:15.250Z',
  'timestamps use the client form YYYY-MM-DDTHH:MM:SS.mmmZ');

select ok(
  not ((select payload from public.oplog where row_id = 'tx-bf-raw-1') ?| array['id', 'household_id']),
  'id and household_id travel in the op envelope, not the payload');

select ok(
  not ((select payload from public.oplog where row_id = 'env-bf-raw') ? 'spent_cents'),
  'envelopes.spent_cents (server-derived, absent on phones) is not sent');

select ok(
  (select payload from public.oplog where row_id = 'env-bf-raw') ? 'allocated_cents',
  'the envelope payload still carries its real columns');

select ok(
  (select seq from public.oplog where row_id = 'env-bf-raw')
    < (select min(seq) from public.oplog where row_id in ('tx-bf-raw-1', 'tx-bf-raw-2')),
  'the envelope op is ordered before the transactions that point at it');

-- ===========================================================================
-- 3. It never touches a data row
-- ===========================================================================
select is(
  (select amount_cents from public.transactions where id = 'tx-bf-raw-1'),
  25000,
  'the data row is unchanged');

select is(
  (select spent_cents from public.envelopes where id = 'env-bf-raw'),
  12345,
  'the envelope row is unchanged');

-- ===========================================================================
-- 4. Idempotent
-- ===========================================================================
select is(
  (select coalesce(sum(backfilled_rows), 0)::int from private.backfill_unlogged_rows('hh-bf')),
  0,
  'a second run adds nothing');

-- ===========================================================================
-- 5. A member actually receives it; an app user cannot run the repair
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from public.sync_pull('hh-bf', 0, 200) where device_id = 'server:backfill'),
  3,
  'a household member pulls the backfilled ops through sync_pull');

select throws_ok(
  $$ select * from private.backfill_unlogged_rows('hh-bf') $$,
  '42501',
  NULL,
  'an authenticated app user cannot execute the repair');

reset role;

-- ===========================================================================
-- 6. Unscoped run covers every household
-- ===========================================================================
select is(
  (select coalesce(sum(backfilled_rows), 0)::int
     from private.backfill_unlogged_rows(NULL) where backfilled_household = 'hh-bf-other'),
  2,
  'an unscoped run repairs the other household too (1 envelope + 1 transaction)');

select * from finish();
rollback;

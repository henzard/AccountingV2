-- debt_total_paid.test.sql
--
-- Contract for 0018_debt_total_paid_server_derived.sql: debts.total_paid_cents
-- is SERVER-DERIVED from the movement the balance decrement actually achieved,
-- so two devices paying the same debt can no longer credit money that was
-- never paid.
--
-- Seed pattern mirrors oplog_protocol.test.sql / security_followups.test.sql:
-- insert auth.users + households + household_members + the entity rows as
-- `postgres` (RLS bypassed), then `set local role authenticated` + `set local
-- request.jwt.claims` so the SECURITY DEFINER RPCs see the calling user's
-- membership via auth.uid(); `reset role` back to postgres for raw assertions.
-- private.apply_one_op is not directly executable (and is SECURITY DEFINER
-- reading auth.uid()), so every probe drives it through public.sync_push
-- exactly as a client does -- with a REALISTIC row state seeded first and the
-- jwt claims the function actually reads. Whole file is begin/rollback.
--
-- No real concurrency is available from a single pgTAP session/transaction, so
-- the two-device race (Sections C and D) runs the two possible INTERLEAVINGS
-- of the four ops sequentially -- pair-after-pair, and the two pairs
-- interleaved -- and checks the same invariant after each. The server's own
-- per-household advisory lock (taken by sync_push / apply_server_op before
-- apply_one_op is reached) is what reduces the real concurrent case to exactly
-- one of these orderings.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- ---------------------------------------------------------------------------
-- Seed (as postgres, RLS bypassed)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000d1', 'debt-payer@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'other-owner@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-dt', 'Debt Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-dt-other', 'Other Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-dt', 'hh-dt', '00000000-0000-0000-0000-0000000000d1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-dt-other', 'hh-dt-other', '00000000-0000-0000-0000-0000000000d2', 'owner', '2026-01-01T00:00:00.000Z');

-- One debt per scenario, each in the state a real client would find it in.
insert into public.debts (
  id, household_id, creditor_name, debt_type, outstanding_balance_cents,
  interest_rate_percent, minimum_payment_cents, initial_balance_cents,
  total_paid_cents, created_at, updated_at)
values
  ('debt-pay',   'hh-dt',       'Visa',   'credit_card', 50000, 19.9, 1000, 50000,   0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('debt-over',  'hh-dt',       'Store',  'credit_card', 10000, 19.9, 1000, 10000,   0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('debt-race1', 'hh-dt',       'Car',    'vehicle',     40000,  9.5, 2000, 40000,   0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('debt-race2', 'hh-dt',       'Car 2',  'vehicle',     40000,  9.5, 2000, 40000,   0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('debt-lone',  'hh-dt',       'Loan',   'personal',    10000, 12.0, 500,  10777, 777, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('debt-up',    'hh-dt',       'Ovrdrft','personal',    10000, 12.0, 500,  10900, 900, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('debt-alien', 'hh-dt-other', 'Alien',  'personal',    10000, 12.0, 500,  10000,   0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- An envelope for the "every other table/field is unchanged" probe. This is
-- the same vehicle oplog_protocol.test.sql probe 7 uses for the generic
-- increment path.
insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-dt-inc', 'hh-dt', 'Groceries', 0, 50, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Act as the debt household's owner (authenticated).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- ===========================================================================
-- Section A: an ordinary payment. Balance down by the payment, total paid up
-- by exactly the same amount -- the two ops still describe one payment.
-- 50000 owed, 30000 paid.
-- ===========================================================================
create temporary table t_pay as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000001',
    'household_id', 'hh-dt',
    'table', 'debts',
    'row_id', 'debt-pay',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -30000, 'clamp', 'floor_zero'),
    'device_id', 'dev-a'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000002',
    'household_id', 'hh-dt',
    'table', 'debts',
    'row_id', 'debt-pay',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 30000, 'clamp', 'none'),
    'device_id', 'dev-a')
)) as result;

reset role;

select is(
  (select result -> 0 ->> 'status' from t_pay),
  'applied', 'A1: the balance-decrement op is applied');

select is(
  (select result -> 1 ->> 'status' from t_pay),
  'applied', 'A2: the total_paid_cents op is still reported applied (protocol unchanged)');

select is(
  (select outstanding_balance_cents from public.debts where id = 'debt-pay'),
  20000, 'A3: balance went down by the payment (50000 - 30000)');

select is(
  (select total_paid_cents from public.debts where id = 'debt-pay'),
  30000::bigint, 'A4: total_paid_cents went up by exactly the same amount');

-- ===========================================================================
-- Section B: an OVERPAYMENT -- 25000 paid against a debt that owes 10000.
-- The balance clamps at 0 and total_paid_cents is credited ONLY with what was
-- actually owed, not with the whole payment.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_over as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000003',
    'household_id', 'hh-dt',
    'table', 'debts',
    'row_id', 'debt-over',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -25000, 'clamp', 'floor_zero'),
    'device_id', 'dev-a'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000004',
    'household_id', 'hh-dt',
    'table', 'debts',
    'row_id', 'debt-over',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 25000, 'clamp', 'none'),
    'device_id', 'dev-a')
)) as result;

reset role;

select is(
  (select result -> 0 ->> 'status' from t_over),
  'applied', 'B1: the over-sized balance-decrement op is applied');

select is(
  (select result -> 1 ->> 'status' from t_over),
  'applied', 'B2: the over-sized total_paid_cents op is still reported applied');

select is(
  (select outstanding_balance_cents from public.debts where id = 'debt-over'),
  0, 'B3: balance clamps at 0, exactly as before');

select is(
  (select total_paid_cents from public.debts where id = 'debt-over'),
  10000::bigint, 'B4: total_paid_cents gains ONLY the 10000 that was owed, not the 25000 paid');

select is(
  (select is_paid_off from public.debts where id = 'debt-over'),
  true, 'B5: the 0001 §9g trigger still derives is_paid_off from the new balance');

-- ===========================================================================
-- Section C: the two-device race, interleaving 1 -- device A's whole pair,
-- then device B's whole pair. Both paid 40000 against a debt owing 40000.
-- Before 0018 the balance clamped at 0 but total_paid_cents reached 80000:
-- 40000 of money that was never paid.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- Device A's pair first; then, as a SEPARATE statement (so the order is
-- deterministic, not left to the planner), device B's pair.
create temporary table t_race1a as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000011',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race1',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -40000, 'clamp', 'floor_zero'),
    'device_id', 'dev-a'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000012',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race1',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 40000, 'clamp', 'none'),
    'device_id', 'dev-a')
)) as result;

create temporary table t_race1b as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000013',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race1',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -40000, 'clamp', 'floor_zero'),
    'device_id', 'dev-b'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000014',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race1',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 40000, 'clamp', 'none'),
    'device_id', 'dev-b')
)) as result;

reset role;

select is(
  (select
     (select count(*)::int from t_race1a, jsonb_array_elements(result) e where e ->> 'status' = 'applied')
   + (select count(*)::int from t_race1b, jsonb_array_elements(result) e where e ->> 'status' = 'applied')),
  4, 'C1: all four ops of both devices are applied -- no device is dead-lettered');

select is(
  (select outstanding_balance_cents from public.debts where id = 'debt-race1'),
  0, 'C2: interleaving 1 -- the balance is 0');

select is(
  (select total_paid_cents from public.debts where id = 'debt-race1'),
  40000::bigint, 'C3: interleaving 1 -- total_paid_cents is 40000, NOT 80000 (the second payment paid nothing)');

-- ===========================================================================
-- Section D: the two-device race, interleaving 2 -- the two pairs INTERLEAVED
-- (A balance, B balance, A total_paid, B total_paid). Same invariant.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_race2 as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000021',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race2',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -40000, 'clamp', 'floor_zero'),
    'device_id', 'dev-a'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000022',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race2',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -40000, 'clamp', 'floor_zero'),
    'device_id', 'dev-b'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000023',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race2',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 40000, 'clamp', 'none'),
    'device_id', 'dev-a'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000024',
    'household_id', 'hh-dt', 'table', 'debts', 'row_id', 'debt-race2',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 40000, 'clamp', 'none'),
    'device_id', 'dev-b')
)) as result;

reset role;

select is(
  (select count(*)::int from t_race2, jsonb_array_elements(result) e where e ->> 'status' = 'applied'),
  4, 'D1: interleaving 2 -- all four ops applied');

select is(
  (select outstanding_balance_cents from public.debts where id = 'debt-race2'),
  0, 'D2: interleaving 2 -- the balance is 0');

select is(
  (select total_paid_cents from public.debts where id = 'debt-race2'),
  40000::bigint, 'D3: interleaving 2 -- total_paid_cents is 40000, NOT 80000');

-- ===========================================================================
-- Section E: a LONE total_paid_cents increment (no balance op with it) leaves
-- the row completely untouched -- but is still reported `applied` with a null
-- code and still gets an oplog row, so every build in the field sees exactly
-- what it sees today and other devices still pull the op.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_lone as
select public.sync_push(jsonb_build_array(jsonb_build_object(
  'v', '1',
  'op_id', 'd0000000-0000-0000-0000-000000000031',
  'household_id', 'hh-dt',
  'table', 'debts',
  'row_id', 'debt-lone',
  'op_type', 'increment',
  'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 5000, 'clamp', 'none'),
  'device_id', 'dev-a'
))) as result;

reset role;

select is(
  (select result -> 0 ->> 'status' from t_lone),
  'applied', 'E1: a lone total_paid_cents increment is reported applied');

select ok(
  (select result -> 0 -> 'code' from t_lone) = 'null'::jsonb,
  'E2: ...with a null code -- not a reject, not a new code an older build cannot read');

select is(
  (select total_paid_cents from public.debts where id = 'debt-lone'),
  777::bigint, 'E3: the row is untouched -- total_paid_cents is still 777');

select is(
  (select outstanding_balance_cents from public.debts where id = 'debt-lone'),
  10000, 'E4: the row is untouched -- the balance is still 10000');

select cmp_ok(
  (select seq from public.oplog where op_id = 'd0000000-0000-0000-0000-000000000031'),
  '>', 0::bigint,
  'E5: the op is still in the oplog with a seq, so other devices still pull it');

-- ===========================================================================
-- Section F: a POSITIVE delta on outstanding_balance_cents (a debt growing,
-- not being paid) keeps today's behaviour exactly and must NOT move
-- total_paid_cents -- money borrowed is not money repaid.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_up as
select public.sync_push(jsonb_build_array(jsonb_build_object(
  'v', '1',
  'op_id', 'd0000000-0000-0000-0000-000000000041',
  'household_id', 'hh-dt',
  'table', 'debts',
  'row_id', 'debt-up',
  'op_type', 'increment',
  'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', 5000, 'clamp', 'none'),
  'device_id', 'dev-a'
))) as result;

reset role;

select is(
  (select result -> 0 ->> 'status' from t_up),
  'applied', 'F1: a positive balance increment is applied');

select is(
  (select outstanding_balance_cents from public.debts where id = 'debt-up'),
  15000, 'F2: the balance grew by the delta, exactly as before');

select is(
  (select total_paid_cents from public.debts where id = 'debt-up'),
  900::bigint, 'F3: total_paid_cents is NOT reduced (or otherwise touched) by a positive delta');

-- ===========================================================================
-- Section G: the generic increment path for every other table/field is
-- untouched -- envelopes.spent_cents with floor_zero still clamps at 0
-- (the same behaviour oplog_protocol.test.sql probe 7 pins).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_env as
select public.sync_push(jsonb_build_array(jsonb_build_object(
  'v', '1',
  'op_id', 'd0000000-0000-0000-0000-000000000051',
  'household_id', 'hh-dt',
  'table', 'envelopes',
  'row_id', 'env-dt-inc',
  'op_type', 'increment',
  'payload', jsonb_build_object('field', 'spent_cents', 'delta', -100, 'clamp', 'floor_zero'),
  'device_id', 'dev-a'
))) as result;

reset role;

select is(
  (select result -> 0 ->> 'status' from t_env),
  'applied', 'G1: an increment on another table is applied, unchanged');

select is(
  (select spent_cents from public.envelopes where id = 'env-dt-inc'),
  0, 'G2: envelopes.spent_cents floor_zero still clamps at 0 (50 + -100 -> 0)');

-- ===========================================================================
-- Section H: a NON-MEMBER pushing the same payment pair is still rejected
-- not_member, pre-oplog, and cannot move another household's debt.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_alien as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000061',
    'household_id', 'hh-dt-other', 'table', 'debts', 'row_id', 'debt-alien',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'outstanding_balance_cents', 'delta', -10000, 'clamp', 'floor_zero'),
    'device_id', 'dev-a'),
  jsonb_build_object(
    'v', '1',
    'op_id', 'd0000000-0000-0000-0000-000000000062',
    'household_id', 'hh-dt-other', 'table', 'debts', 'row_id', 'debt-alien',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'total_paid_cents', 'delta', 10000, 'clamp', 'none'),
    'device_id', 'dev-a')
)) as result;

reset role;

select is(
  (select result -> 0 ->> 'code' from t_alien),
  'not_member', 'H1: a non-member''s balance-decrement op is still rejected not_member');

select is(
  (select result -> 1 ->> 'code' from t_alien),
  'not_member', 'H2: a non-member''s total_paid_cents op is still rejected not_member');

select is(
  (select outstanding_balance_cents || '/' || total_paid_cents from public.debts where id = 'debt-alien'),
  '10000/0'::text, 'H3: the other household''s debt is untouched');

select is(
  (select count(*)::int from public.oplog
     where op_id in ('d0000000-0000-0000-0000-000000000061', 'd0000000-0000-0000-0000-000000000062')),
  0, 'H4: neither rejected op reached the oplog');

-- ===========================================================================
-- Section I: privileges on the re-issued function are unchanged.
-- ===========================================================================
select ok(
  not has_function_privilege('authenticated', 'private.apply_one_op(jsonb)', 'execute'),
  'I1: authenticated still cannot execute private.apply_one_op directly');

select ok(
  has_function_privilege('authenticated', 'public.sync_push(jsonb)', 'execute'),
  'I2: authenticated can still execute sync_push');

select * from finish();
rollback;

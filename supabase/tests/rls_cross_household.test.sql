begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Seed: two auth users
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@test.local');

-- Two households; membership triggers populate user_households
insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-a', 'Household A', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-b', 'Household B', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-a', 'hh-a', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-b', 'hh-b', '00000000-0000-0000-0000-00000000000b', 'owner', '2026-01-01T00:00:00.000Z');

insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-b', 'hh-b', 'Groceries B', 10000, 0, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.transactions (id, household_id, envelope_id, amount_cents, transaction_date, created_at, updated_at)
values
  ('txn-b', 'hh-b', 'env-b', 1000, '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.debts (id, household_id, creditor_name, debt_type, outstanding_balance_cents, interest_rate_percent, minimum_payment_cents, created_at, updated_at)
values
  ('debt-b', 'hh-b', 'Creditor B', 'credit_card', 50000, 19.99, 2500, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- Act as user A (authenticated)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from public.households where id = 'hh-a'),
  1, 'member sees own household');

select is(
  (select count(*)::int from public.households where id = 'hh-b'),
  0, 'cross-household SELECT on households returns zero rows');

select is(
  (select count(*)::int from public.envelopes where household_id = 'hh-b'),
  0, 'cross-household SELECT on envelopes returns zero rows');

select is(
  (select count(*)::int from public.transactions where household_id = 'hh-b'),
  0, 'cross-household SELECT on transactions returns zero rows');

select is(
  (select count(*)::int from public.debts where household_id = 'hh-b'),
  0, 'cross-household SELECT on debts returns zero rows');

-- Anonymous sees nothing at all
set local role anon;
set local request.jwt.claims to '{}';
select is(
  (select count(*)::int from public.households),
  0, 'anon sees zero households');

select * from finish();
rollback;

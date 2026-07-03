begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Seed: two auth users
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'user-c@test.local');

-- Two households; membership triggers populate user_households
insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-a', 'Household A', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-b', 'Household B', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-a', 'hh-a', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-b', 'hh-b', '00000000-0000-0000-0000-00000000000b', 'owner', '2026-01-01T00:00:00.000Z');

-- A third household with a UUID-format id, needed because
-- validate_slip_path() only accepts UUID-shaped path segments (the hh-a /
-- hh-b fixtures above are not UUID-shaped). One active member (user a) and
-- one soft-deleted (removed) member (user c) who must NOT retain access.
insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'Slip Path Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at, deleted_at)
values
  ('hm-slip-active', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z', null),
  ('hm-slip-removed', '11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000c', 'member', '2026-01-01T00:00:00.000Z', now());

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

-- ---------------------------------------------------------------------------
-- validate_slip_path: an active member passes, a soft-deleted (removed)
-- member does NOT keep access (CodeRabbit finding on PR #114 — the inline
-- membership check was missing the deleted_at IS NULL filter that
-- private.is_household_member correctly has).
-- ---------------------------------------------------------------------------
select is(
  public.validate_slip_path('11111111-1111-1111-1111-111111111111'),
  true, 'validate_slip_path: an active member is granted access to their household''s slip path');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  public.validate_slip_path('11111111-1111-1111-1111-111111111111'),
  false, 'validate_slip_path: a soft-deleted (removed) member is rejected, not granted access');

-- ---------------------------------------------------------------------------
-- user_consent: slip-scan consent now has a write path (INSERT + UPDATE
-- RLS policies + grants), mirroring user_preferences (CodeRabbit finding:
-- merge_user_consent was dropped with no replacement direct-write path).
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into public.user_consent (user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000000a', now(), now());

select is(
  (select count(*)::int from public.user_consent where user_id = '00000000-0000-0000-0000-00000000000a'),
  1, 'user_consent: an authenticated user can INSERT their own consent row');

update public.user_consent
set slip_scan_consent_at = now(), updated_at = now()
where user_id = '00000000-0000-0000-0000-00000000000a';

select isnt(
  (select slip_scan_consent_at from public.user_consent where user_id = '00000000-0000-0000-0000-00000000000a'),
  null, 'user_consent: an authenticated user can UPDATE their own consent row');

select throws_ok(
  $$insert into public.user_consent (user_id, created_at, updated_at)
    values ('00000000-0000-0000-0000-00000000000b', now(), now())$$,
  '42501',
  null,
  'user_consent: an authenticated user cannot INSERT a consent row for another user');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

insert into public.user_consent (user_id, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000000b', now(), now());

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

with attempted_update as (
  update public.user_consent
  set slip_scan_consent_at = now()
  where user_id = '00000000-0000-0000-0000-00000000000b'
  returning 1
)
select is(
  (select count(*)::int from attempted_update),
  0, 'user_consent: an authenticated user cannot UPDATE another user''s consent row (RLS filters it out)');

-- Anonymous sees nothing at all
set local role anon;
set local request.jwt.claims to '{}';
select is(
  (select count(*)::int from public.households),
  0, 'anon sees zero households');

select * from finish();
rollback;

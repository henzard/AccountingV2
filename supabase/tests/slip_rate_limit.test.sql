-- slip_rate_limit.test.sql
--
-- Contract for the 0009 DB-2 fix: public.check_and_reserve_slip_slot's
-- household/user counts and per-slip lease now come from the server-clock
-- public.slip_extraction_attempts table, not from client-writable
-- slip_queue.created_at/status. This file proves:
--   * a slip_queue row with a heavily back-dated created_at is STILL counted
--     against the 24h window (the old bug: back-dating exempted it);
--   * the 26th reservation attempt for the same user in the same hour is
--     denied user_limit despite every underlying slip being back-dated;
--   * a second reservation attempt for the SAME slip_id within 60 seconds is
--     denied lease_active, independent of slip_queue.status.
--
-- Follows household_bootstrap.test.sql's convention: stays as `postgres`
-- throughout and only sets the request.jwt.claims GUC, since
-- check_and_reserve_slip_slot is SECURITY DEFINER and (as of 0007 DB-4) has
-- no EXECUTE grant for `authenticated` at all -- calling it as postgres
-- (which bypasses grants entirely) isolates this file from that unrelated
-- hardening fix while still exercising the function's real auth.uid() check
-- via the GUC. Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000b1', 'slip-user@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'slip-lease-user@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-slip-rl', 'Slip Rate Limit Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-slip-rl-b', 'Second Household Same User', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-slip-rl-1', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-slip-rl-2', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', 'member', '2026-01-01T00:00:00.000Z'),
  ('hm-slip-rl-3', 'hh-slip-rl-b', '00000000-0000-0000-0000-0000000000b1', 'owner', '2026-01-01T00:00:00.000Z');

-- 26 slip_queue rows, ALL back-dated 10 days (well outside any created_at-
-- based 24h window). Seeded 'processing' because that is what the client's
-- capture step really writes -- 0013: seeding 'pending' is how this file
-- previously hid a function that could never reserve a real slip.
insert into public.slip_queue (id, household_id, created_by, image_uris, status, created_at, updated_at)
select 'slip-rl-' || g, 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b1', '[]', 'processing',
       now() - interval '10 days', now() - interval '10 days'
from generate_series(1, 26) g;

-- 0013: call exactly as production does -- the extract-slip edge function uses
-- the service-role client, whose JWT carries NO `sub`, so auth.uid() IS NULL.
-- (Same no-sub simulation rls_cross_household.test.sql uses.)
set local request.jwt.claims to '{}';

-- ===========================================================================
-- Probe 1: the first 25 reservations for this user all succeed even though
-- every slip's created_at is 10 days old -- the count comes from
-- slip_extraction_attempts.attempted_at (now()), not slip_queue.created_at.
-- ===========================================================================
select lives_ok(
  $$
  do $do$
  declare
    i int;
    res jsonb;
  begin
    for i in 1..25 loop
      res := public.check_and_reserve_slip_slot(
        'hh-slip-rl', '00000000-0000-0000-0000-0000000000b1', 'slip-rl-' || i);
      if coalesce((res ->> 'allowed')::boolean, false) is not true then
        raise exception 'slip-rl-% was not allowed: %', i, res;
      end if;
    end loop;
  end
  $do$;
  $$,
  'P1: 25 back-dated slips all reserve successfully (limit not yet hit)');

select is(
  (select count(*)::int from public.slip_extraction_attempts
     where household_id = 'hh-slip-rl'
       and user_id = '00000000-0000-0000-0000-0000000000b1'),
  25, 'P2: each of the 25 reservations recorded one server-clock attempt row');

-- ===========================================================================
-- Probe 3: the 26th attempt in the same hour is denied user_limit, despite
-- slip-rl-26's created_at also being 10 days old.
-- ===========================================================================
select is(
  (public.check_and_reserve_slip_slot(
     'hh-slip-rl', '00000000-0000-0000-0000-0000000000b1', 'slip-rl-26') ->> 'reason'),
  'user_limit',
  'P3: the 26th attempt in the same hour is denied user_limit despite back-dated created_at');

select is(
  (select count(*)::int from public.slip_extraction_attempts where slip_id = 'slip-rl-26'),
  0, 'P4: the denied 26th attempt recorded nothing and reserved nothing');

-- ===========================================================================
-- Probe 5/6/7 (lease): a fresh slip for a DIFFERENT user in the same
-- household reserves successfully once, then a second reservation attempt
-- for the SAME slip_id within 60 seconds is denied lease_active -- even
-- though nothing about slip_queue.status changed (still 'processing', not
-- reset to 'pending' or 'failed').
-- ===========================================================================
insert into public.slip_queue (id, household_id, created_by, image_uris, status, created_at, updated_at)
values
  ('slip-rl-lease', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', '[]', 'processing', now(), now()),
  ('slip-rl-retry', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', '[]', 'failed', now(), now()),
  ('slip-rl-other-hh', 'hh-slip-rl-b', '00000000-0000-0000-0000-0000000000b1', '[]', 'processing', now(), now());

select is(
  (public.check_and_reserve_slip_slot(
     'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', 'slip-rl-lease') ->> 'allowed')::boolean,
  true, 'P5: the first reservation of a fresh slip succeeds');

select is(
  (public.check_and_reserve_slip_slot(
     'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', 'slip-rl-lease') ->> 'reason'),
  'lease_active',
  'P6: a second reservation for the SAME slip within 60 seconds is denied lease_active');

select is(
  (select status from public.slip_queue where id = 'slip-rl-lease'),
  'processing', 'P7: the leased slip remains processing (unaffected by the denied re-reservation)');

-- ===========================================================================
-- Probe 8/9 (0013 C1): a slip whose earlier extraction FAILED can be reserved
-- again and goes back to 'processing' -- the retry path.
-- ===========================================================================
select is(
  (public.check_and_reserve_slip_slot(
     'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', 'slip-rl-retry') ->> 'allowed')::boolean,
  true, 'P8: a failed slip can be reserved for a retry');

select is(
  (select status from public.slip_queue where id = 'slip-rl-retry'),
  'processing', 'P9: the retried slip is back to processing');

-- ===========================================================================
-- Probe 10 (0013): the per-user cap spans households. User b1 has used all 25
-- attempts in hh-slip-rl; a fresh slip in their OTHER household is refused.
-- ===========================================================================
select is(
  (public.check_and_reserve_slip_slot(
     'hh-slip-rl-b', '00000000-0000-0000-0000-0000000000b1', 'slip-rl-other-hh') ->> 'reason'),
  'user_limit',
  'P10: the 24h user cap follows the user across households');

-- ===========================================================================
-- Probe 11 (0013 C2 regression pin): the function must never self-check
-- auth.uid() -- its only caller has none.
-- ===========================================================================
select ok(
  (select prosrc not like '%auth.uid%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_and_reserve_slip_slot'),
  'P11: check_and_reserve_slip_slot does not reference auth.uid()');

select * from finish();
rollback;

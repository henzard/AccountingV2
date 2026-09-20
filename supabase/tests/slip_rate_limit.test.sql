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
select plan(7);

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000b1', 'slip-user@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'slip-lease-user@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values ('hh-slip-rl', 'Slip Rate Limit Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-slip-rl-1', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-slip-rl-2', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', 'member', '2026-01-01T00:00:00.000Z');

-- 26 slip_queue rows, ALL back-dated 10 days (well outside any created_at-
-- based 24h window), pending reservation.
insert into public.slip_queue (id, household_id, created_by, image_uris, status, created_at, updated_at)
select 'slip-rl-' || g, 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b1', '[]', 'pending',
       now() - interval '10 days', now() - interval '10 days'
from generate_series(1, 26) g;

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

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
  (select count(*)::int from public.slip_queue
     where household_id = 'hh-slip-rl' and status = 'processing'),
  25, 'P2: all 25 back-dated slips transitioned to processing');

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
  (select status from public.slip_queue where id = 'slip-rl-26'),
  'pending', 'P4: the denied 26th slip stays pending, not reserved');

-- ===========================================================================
-- Probe 5/6/7 (lease): a fresh slip for a DIFFERENT user in the same
-- household reserves successfully once, then a second reservation attempt
-- for the SAME slip_id within 60 seconds is denied lease_active -- even
-- though nothing about slip_queue.status changed (still 'processing', not
-- reset to 'pending' or 'failed').
-- ===========================================================================
insert into public.slip_queue (id, household_id, created_by, image_uris, status, created_at, updated_at)
values ('slip-rl-lease', 'hh-slip-rl', '00000000-0000-0000-0000-0000000000b2', '[]', 'pending', now(), now());

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

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

select * from finish();
rollback;

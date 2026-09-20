-- invites.test.sql
--
-- Contract for the invite RPCs (Task 4). Written FIRST (TDD): every probe
-- below FAILS until public.create_invitation exists in 0001_baseline.sql.
--
-- Seed pattern mirrors rls_cross_household.test.sql / oplog_protocol.test.sql:
-- insert auth.users + households + household_members as `postgres` (RLS
-- bypassed), then `set local role authenticated` + `set local
-- request.jwt.claims` so the SECURITY DEFINER RPCs see the calling user's
-- identity via auth.uid(). Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ---------------------------------------------------------------------------
-- Seed (as postgres, RLS bypassed): one household with an owner and a plain
-- member, a joiner who is not yet a member, a spare user for the
-- expired/consumed probes, and a pre-seeded expired invitation row.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'member@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'joiner@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'spare@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-invite', 'Invite Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-owner', 'hh-invite', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-member', 'hh-invite', '00000000-0000-0000-0000-00000000000b', 'member', '2026-01-01T00:00:00.000Z');

-- Pre-seeded, already-expired invitation (raw insert — create_invitation
-- always sets a future expiry, so an expired row can only exist this way).
insert into public.invitations (id, code, household_id, created_by, expires_at)
values (
  gen_random_uuid(), 'EXPIRD', 'hh-invite',
  '00000000-0000-0000-0000-00000000000a', now() - interval '1 hour'
);

-- ===========================================================================
-- Probe 1: the owner can create an invitation
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

create temporary table t_invite as
select public.create_invitation('hh-invite') as result;

select ok(
  (select result ->> 'code' from t_invite) ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$',
  'P1: owner-created invitation code uses the unbiased 32-char alphabet');

select ok(
  (select (result ->> 'expires_at')::timestamptz from t_invite)
    between now() + interval '47 hours' and now() + interval '49 hours',
  'P1: invitation expires roughly 48 hours from now');

select is(
  (select count(*)::int from public.invitations
   where household_id = 'hh-invite'
     and created_by = '00000000-0000-0000-0000-00000000000a'
     and code = (select result ->> 'code' from t_invite)),
  1, 'P1: an invitations row was persisted for the owner''s code');

select is(
  (select result ->> 'id' from t_invite),
  (select id::text from public.invitations where code = (select result ->> 'code' from t_invite)),
  'P1: returned id matches the persisted invitations row');

-- ===========================================================================
-- Probe 2: a non-owner member cannot create an invitation
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select throws_ok(
  $$select public.create_invitation('hh-invite')$$,
  '42501'::character(5),
  null,
  'P2: a non-owner member cannot create an invitation');

-- ===========================================================================
-- Probe 3: a second user joins via the returned code and becomes a member
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';

select is(
  (public.join_household_via_invite((select result ->> 'code' from t_invite)) ->> 'household_id'),
  'hh-invite', 'P3: join_household_via_invite reports the correct household');

select is(
  (select count(*)::int from public.household_members
   where household_id = 'hh-invite'
     and user_id = '00000000-0000-0000-0000-00000000000c'
     and role = 'member'),
  1, 'P3: the joiner is now a household member');

-- Read as the table owner: since 0007 (DB-10) a plain member -- which the
-- joiner now is -- can no longer select invitation rows under RLS.
reset role;
select isnt(
  (select used_by from public.invitations where code = (select result ->> 'code' from t_invite)),
  null, 'P3: the invitation is marked used after a successful join');
set local role authenticated;

-- ===========================================================================
-- Probe 3b (0010 DB-6(a)): the OWNER sees the join via sync_pull -- proves
-- join_household_via_invite's new oplog append actually reaches other
-- devices, not just the joiner's own local insert (which the owner's
-- device never sees any other way).
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select ok(
  exists (
    select 1 from public.sync_pull('hh-invite', 0, 1000)
    where table_name = 'household_members'
      and op_type = 'insert'
      and payload ->> 'user_id' = '00000000-0000-0000-0000-00000000000c'
  ),
  'P3b: the owner sees the joiner''s household_members insert via sync_pull');

-- ===========================================================================
-- Probe 4: an expired code is rejected
--
-- 0007 DB-5: not-found / already-used / expired now all raise the SAME
-- generic message (an enumeration oracle otherwise), so this no longer
-- matches on '%expired%' specifically -- see Probe 5 below and the 0007
-- migration header for the client-side (mapJoinError) implication.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';

select is(
  public.join_household_via_invite('EXPIRD') ->> 'error',
  'invite_invalid',
  'P4: an expired invitation code is rejected with the generic invalid-code result');

-- ===========================================================================
-- Probe 5: an already-consumed code is rejected
--
-- 0007 DB-5: same generic message as Probe 4 (an already-expired vs.
-- already-used vs. never-existed code must be indistinguishable to the
-- caller).
-- ===========================================================================
select is(
  public.join_household_via_invite((select result ->> 'code' from t_invite)) ->> 'error',
  'invite_invalid',
  'P5: an already-consumed invitation code is rejected with the generic invalid-code result');

-- ===========================================================================
-- Probe 6: TOCTOU dup-membership guard. Concurrent joins via different
-- valid invites to the same household could previously both pass the
-- pre-insert EXISTS check and insert duplicate active (household_id,
-- user_id) rows. True concurrency isn't practical to drive from a single
-- pgTAP session (the EXISTS pre-check already short-circuits a same-session
-- re-join attempt with an "already a member" error before reaching the
-- INSERT), so this proves the index-level guard directly instead: the
-- partial unique index exists, and a duplicate active row raises
-- unique_violation — the exact condition join_household_via_invite's new
-- EXCEPTION WHEN unique_violation handler catches and treats as a no-op.
-- ===========================================================================
reset role;

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'household_members'
      and indexname = 'household_members_household_id_user_id_active_idx'
  ),
  'P6: a partial unique index on household_members(household_id, user_id) WHERE deleted_at IS NULL exists');

select throws_ok(
  $$insert into public.household_members (id, household_id, user_id, role, joined_at)
    values ('hm-dup', 'hh-invite', '00000000-0000-0000-0000-00000000000c', 'member', now())$$,
  '23505'::character(5),
  null,
  'P6: a second active membership row for an existing member raises unique_violation');

select is(
  (select count(*)::int from public.household_members
   where household_id = 'hh-invite'
     and user_id = '00000000-0000-0000-0000-00000000000c'
     and deleted_at is null),
  1, 'P6: the rejected duplicate insert left exactly one active row for the joiner');

-- ===========================================================================
-- Probe 7: a previously-removed (soft-deleted) member can rejoin via a fresh
-- invite — the pre-insert membership check ignores soft-deleted rows.
-- ===========================================================================
reset role;
update public.household_members
  set deleted_at = now()
  where id = 'hm-member';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
create temporary table t_rejoin as select public.create_invitation('hh-invite') as result;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
create temporary table t_rejoin_result as
select public.join_household_via_invite((select result ->> 'code' from t_rejoin)) as ok;

reset role;
select is(
  (select count(*)::int from public.household_members
   where household_id = 'hh-invite'
     and user_id = '00000000-0000-0000-0000-00000000000b'
     and deleted_at is null),
  1, 'P7: a soft-deleted member who rejoins has exactly one active membership again');

-- ===========================================================================
-- Probe 8 (0007 DB-5): guessing throttle. Ten failed join attempts with a
-- bogus code in the same hour are all rejected with the SAME generic
-- message (no not-found/used/expired oracle); the 11th is throttled outright
-- with a distinct message, before the code is even looked up.
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';

do $$
declare
  i int;
begin
  for i in 1..10 loop
    begin
      perform public.join_household_via_invite('BADCOD');
    exception when others then
      null; -- once 10 failures are on record the remaining calls raise the throttle error
    end;
  end loop;
end
$$;

select throws_like(
  $$select public.join_household_via_invite('BADCOD')$$,
  '%too many attempts%',
  'P8: the 11th bad invite code from the same caller within an hour is throttled');

reset role;
select cmp_ok(
  (select count(*)::int from public.invite_attempts
     where user_id = '00000000-0000-0000-0000-00000000000d'),
  '>=', 10::int,
  'P8: invite_attempts recorded at least the 10 throttled failures for that caller');

select * from finish();
rollback;

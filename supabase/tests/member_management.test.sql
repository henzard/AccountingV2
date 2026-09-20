-- member_management.test.sql
--
-- Contract for the member-management RPCs added in
-- 0011_member_management.sql: public.remove_household_member (owner-only
-- removal of a non-owner member, replicated via an oplog `delete` row) and
-- public.list_household_members (member-only roster with co-member emails).
--
-- Seed pattern mirrors invites.test.sql / rls_cross_household.test.sql:
-- insert auth.users + households + household_members as `postgres` (RLS
-- bypassed), then `set local role authenticated` + `set local
-- request.jwt.claims` so the SECURITY DEFINER RPCs see the calling user's
-- identity via auth.uid(). Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ---------------------------------------------------------------------------
-- Seed: one household with TWO owners (so "an owner cannot remove another
-- owner" is provable), one plain member, plus an outsider who belongs to a
-- different household entirely.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'owner1@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner2@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'member@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'outsider@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-mm', 'Member Mgmt Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-other', 'Other Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-mm-owner1', 'hh-mm', '00000000-0000-0000-0000-0000000000a1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-mm-owner2', 'hh-mm', '00000000-0000-0000-0000-0000000000a2', 'owner', '2026-01-02T00:00:00.000Z'),
  ('hm-mm-member', 'hh-mm', '00000000-0000-0000-0000-0000000000b1', 'member', '2026-01-03T00:00:00.000Z'),
  ('hm-other-owner', 'hh-other', '00000000-0000-0000-0000-0000000000c1', 'owner', '2026-01-01T00:00:00.000Z');

insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-mm', 'hh-mm', 'Groceries', 50000, 0, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ===========================================================================
-- Probe 1: privileges. Neither PUBLIC nor anon may execute either RPC;
-- authenticated may.
-- ===========================================================================
select ok(
  not has_function_privilege('anon', 'public.remove_household_member(text, text)', 'EXECUTE'),
  'P1: anon cannot execute remove_household_member');

select ok(
  has_function_privilege('authenticated', 'public.remove_household_member(text, text)', 'EXECUTE'),
  'P1: authenticated can execute remove_household_member');

select ok(
  not has_function_privilege('anon', 'public.list_household_members(text)', 'EXECUTE'),
  'P1: anon cannot execute list_household_members');

-- ===========================================================================
-- Probe 2: a plain (non-owner) member cannot remove anyone.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
  $$select public.remove_household_member('hh-mm', '00000000-0000-0000-0000-0000000000a2')$$,
  '42501'::character(5),
  null,
  'P2: a non-owner member cannot remove another member');

-- A non-member of the household is equally refused (the owner check is
-- scoped to THIS household, so belonging to some other household is no help).
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select throws_ok(
  $$select public.remove_household_member('hh-mm', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501'::character(5),
  null,
  'P2: an owner of a DIFFERENT household cannot remove a member here');

-- ===========================================================================
-- Probe 3: an owner cannot remove themselves, and cannot remove a co-owner.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$select public.remove_household_member('hh-mm', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501'::character(5),
  null,
  'P3: an owner cannot remove themselves (they must leave instead)');

select throws_ok(
  $$select public.remove_household_member('hh-mm', '00000000-0000-0000-0000-0000000000a2')$$,
  '42501'::character(5),
  null,
  'P3: an owner cannot remove another owner');

-- ===========================================================================
-- Probe 4: the roster. Before any removal, an active member sees all three
-- members WITH their emails; a non-member is refused outright.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from public.list_household_members('hh-mm')),
  3, 'P4: an active member sees all three active members');

select is(
  (select m.email from public.list_household_members('hh-mm') m
   where m.user_id = '00000000-0000-0000-0000-0000000000a1'),
  'owner1@test.local', 'P4: the roster carries each member''s auth.users email');

select is(
  (select m.role from public.list_household_members('hh-mm') m
   where m.user_id = '00000000-0000-0000-0000-0000000000b1'),
  'member', 'P4: the roster carries each member''s role');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select throws_ok(
  $$select * from public.list_household_members('hh-mm')$$,
  '42501'::character(5),
  null,
  'P4: a non-member cannot list a household''s members');

-- ===========================================================================
-- Probe 5: an owner removes the plain member.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (public.remove_household_member('hh-mm', '00000000-0000-0000-0000-0000000000b1') ->> 'removed'),
  'true', 'P5: the owner''s removal call reports removed: true');

reset role;
select isnt(
  (select deleted_at from public.household_members where id = 'hm-mm-member'),
  null, 'P5: the removed member''s row is soft-deleted, not hard-deleted');
set local role authenticated;

-- ===========================================================================
-- Probe 6: the removal is VISIBLE TO OTHER MEMBERS via sync_pull. Membership
-- changes reach other devices only as oplog rows, so without this append the
-- second owner's device would never learn of the removal.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select ok(
  exists (
    select 1 from public.sync_pull('hh-mm', 0, 1000)
    where table_name = 'household_members'
      and row_id = 'hm-mm-member'
      and op_type = 'delete'
  ),
  'P6: the co-owner sees the membership delete via sync_pull');

select is(
  (select count(*)::int from public.list_household_members('hh-mm')),
  2, 'P6: the removed member is gone from the roster');

-- ===========================================================================
-- Probe 7: the removed member loses RLS access to the household's envelopes,
-- and can no longer list its members.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from public.envelopes where household_id = 'hh-mm'),
  0, 'P7: the removed member can no longer select the household''s envelopes');

select throws_ok(
  $$select * from public.list_household_members('hh-mm')$$,
  '42501'::character(5),
  null,
  'P7: the removed member can no longer list the household''s members');

select * from finish();
rollback;

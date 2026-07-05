-- household_bootstrap.test.sql
--
-- Server-side contract for the household-bootstrap fix
-- (supabase/migrations/0002_fix_household_bootstrap.sql). Proves a brand-new
-- user can create their FIRST household + owner membership purely through
-- public.sync_push (no direct seeding), that the deferred oplog FK is
-- satisfiable, and that the anti-hijack guards hold:
--   * a different user cannot self-insert as owner of an existing household;
--   * a caller cannot name someone else as the bootstrap owner.
--
-- The bootstrap/hijack RPCs are SECURITY DEFINER and resolve identity via the
-- `request.jwt.claims` GUC (auth.uid()), independent of the session role, so
-- this file stays as `postgres` and only sets the claims GUC — that also lets
-- it call the `private` helper directly for a membership assertion. Direct
-- table selects run as postgres (RLS bypassed) purely to assert server state.
-- Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Users only — NO households / household_members pre-seeded: the household is
-- created through sync_push, which is the whole point.
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'attacker@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'caller@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'victim@test.local');

-- ===========================================================================
-- Act as the brand-new owner.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- The two ops CreateHouseholdUseCase emits: households insert THEN owner
-- household_members insert (payload has no id/household_id — they ride as
-- top-level row_id/household_id).
create temporary table t_boot as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'a1000000-0000-0000-0000-000000000001',
    'household_id', 'hh-boot',
    'table', 'households',
    'row_id', 'hh-boot',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Bootstrap Household', 'payday_day', 25, 'user_level', 1,
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devBoot',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-01-01T00:00:00Z'
  ),
  jsonb_build_object(
    'v', '1',
    'op_id', 'a1000000-0000-0000-0000-000000000002',
    'household_id', 'hh-boot',
    'table', 'household_members',
    'row_id', 'hm-owner',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000a', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devBoot',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'status' from t_boot), 'applied',
  'P1: household insert op applied (bootstrap, not not_member)');
select is((select res -> 1 ->> 'status' from t_boot), 'applied',
  'P2: owner membership insert op applied (bootstrap)');

select is(
  (select count(*)::int from public.households where id = 'hh-boot'),
  1, 'P3: household row created on the server');

select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-boot' and role = 'owner'
       and user_id = '00000000-0000-0000-0000-00000000000a' and deleted_at is null),
  1, 'P4: owner membership row created on the server');

-- BUG 2: the deferred oplog -> households FK is satisfiable now that the
-- household exists in this transaction.
select lives_ok('set constraints all immediate',
  'P5: deferred oplog->households FK satisfiable after bootstrap');

select is(private.is_household_member('hh-boot'), true,
  'P6: is_household_member now true for the new owner');

select ok(
  (public.create_invitation('hh-boot') ->> 'code') ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$',
  'P7: owner can now mint an invitation (returns a 6-char code)');

-- ===========================================================================
-- Anti-hijack: a DIFFERENT user tries to self-insert as owner of the now
-- existing (member-having) household.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

create temporary table t_hijack as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'b1000000-0000-0000-0000-000000000001',
    'household_id', 'hh-boot',
    'table', 'household_members',
    'row_id', 'hm-attacker',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000b', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devAttacker',
    'actor_user_id', '00000000-0000-0000-0000-00000000000b',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'status' from t_hijack), 'rejected',
  'P8: hijack of an existing household is rejected');
select is((select res -> 0 ->> 'code' from t_hijack), 'not_member',
  'P9: hijack rejection code is not_member');

select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-boot' and deleted_at is null),
  1, 'P10: no attacker membership added — owner remains sole member');

-- ===========================================================================
-- Owner-user mismatch: caller tries to bootstrap naming a DIFFERENT user as
-- owner. Must be rejected (a caller can only make THEMSELVES owner).
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';

create temporary table t_wrong as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1',
    'op_id', 'c1000000-0000-0000-0000-000000000001',
    'household_id', 'hh-wrong',
    'table', 'households',
    'row_id', 'hh-wrong',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Wrong', 'payday_day', 1, 'user_level', 1,
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devWrong',
    'actor_user_id', '00000000-0000-0000-0000-00000000000c',
    'client_created_at', '2026-01-01T00:00:00Z'
  ),
  jsonb_build_object(
    'v', '1',
    'op_id', 'c1000000-0000-0000-0000-000000000002',
    'household_id', 'hh-wrong',
    'table', 'household_members',
    'row_id', 'hm-victim',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000d', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devWrong',
    'actor_user_id', '00000000-0000-0000-0000-00000000000d',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'code' from t_wrong), 'not_member',
  'P11: bootstrap naming a different user as owner is rejected not_member');

select is(
  (select count(*)::int from public.households where id = 'hh-wrong'),
  0, 'P12: no household created when the owner user_id is not the caller');

select * from finish();
rollback;

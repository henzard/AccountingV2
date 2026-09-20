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
select plan(30);

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

-- ===========================================================================
-- IMPORTANT-1 injection: a legit bootstrap batch that ALSO smuggles in a
-- household_members insert for a DIFFERENT user_id. The bootstrap qualifies
-- the household, but the per-op membership check must reject ONLY the injected
-- op (attacker cannot force-join another user_id via sync_push).
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- P5 above ran `set constraints all immediate`, which flips the DEFERRABLE
-- oplog->households FK to immediate mode for the REST of this single
-- transaction. This injection section does a FRESH bootstrap (a new household),
-- which — exactly like production sync_push — writes the households op's oplog
-- row before the household row and relies on the FK staying deferred to COMMIT.
-- Restore deferred mode so this test exercises real sync_push behavior (in
-- production nothing calls SET CONSTRAINTS, so the FK is deferred throughout).
set constraints all deferred;

create temporary table t_inject as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'd1000000-0000-0000-0000-000000000001',
    'household_id', 'hh-inject', 'table', 'households', 'row_id', 'hh-inject',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Inject', 'payday_day', 25, 'user_level', 1,
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devInject',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-01-01T00:00:00Z'
  ),
  jsonb_build_object(
    'v', '1', 'op_id', 'd1000000-0000-0000-0000-000000000002',
    'household_id', 'hh-inject', 'table', 'household_members', 'row_id', 'hm-inj-owner',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000a', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devInject',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-01-01T00:00:00Z'
  ),
  -- Injected op: force-join a DIFFERENT user (victim, ...000d) into the household.
  jsonb_build_object(
    'v', '1', 'op_id', 'd1000000-0000-0000-0000-000000000003',
    'household_id', 'hh-inject', 'table', 'household_members', 'row_id', 'hm-inj-victim',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000d', 'role', 'member',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devInject',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 1 ->> 'status' from t_inject), 'applied',
  'P13: owner self-membership still applies in an injected batch');
select is((select res -> 2 ->> 'status' from t_inject), 'rejected',
  'P14: the smuggled foreign-user membership insert is rejected');
select is((select res -> 2 ->> 'code' from t_inject), 'forbidden_member',
  'P15: injected-membership rejection code is forbidden_member');
select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-inject' and user_id = '00000000-0000-0000-0000-00000000000d'
       and deleted_at is null),
  0, 'P16: the victim user_id was NOT force-joined');

-- ===========================================================================
-- IMPORTANT-2: a households UPDATE op (payday_day) must APPLY for the owner
-- (previously rejected 42703 because the ownership pre-check selected a
-- non-existent households.household_id column), and be rejected for a
-- non-member.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

create temporary table t_hhupd as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'e1000000-0000-0000-0000-000000000001',
    'household_id', 'hh-boot', 'table', 'households', 'row_id', 'hh-boot',
    'op_type', 'update',
    'payload', jsonb_build_object('payday_day', 10, 'updated_at', '2026-02-01T00:00:00Z'),
    'device_id', 'devBoot',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-02-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'status' from t_hhupd), 'applied',
  'P17: owner households UPDATE (payday_day) applies (no 42703)');
select is(
  (select payday_day from public.households where id = 'hh-boot'),
  10, 'P18: households.payday_day updated to 10');

-- Non-member (attacker, ...000b) tries to update the household -> not_member.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

create temporary table t_hhupd_bad as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'e1000000-0000-0000-0000-000000000002',
    'household_id', 'hh-boot', 'table', 'households', 'row_id', 'hh-boot',
    'op_type', 'update',
    'payload', jsonb_build_object('payday_day', 3, 'updated_at', '2026-03-01T00:00:00Z'),
    'device_id', 'devAttacker',
    'actor_user_id', '00000000-0000-0000-0000-00000000000b',
    'client_created_at', '2026-03-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'code' from t_hhupd_bad), 'not_member',
  'P19: a non-member households UPDATE is rejected not_member');
select is(
  (select payday_day from public.households where id = 'hh-boot'),
  10, 'P20: households.payday_day unchanged after the rejected update');

-- ===========================================================================
-- 0007 DB-1: a plain (non-owner) member cannot self-escalate by pushing
-- [delete own membership, insert own membership role=owner] in one batch.
-- The delete succeeds (they are not the last owner of hh-boot); the insert
-- must be rejected because the caller already has a (now soft-deleted) row
-- for this household -- rejoining/re-inserting goes through
-- join_household_via_invite, never sync_push.
-- ===========================================================================
reset role;

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000000e', 'plain-member@test.local');

-- Seed the plain member directly (as postgres, bypassing RLS) so this probe
-- is self-contained and does not depend on the invite flow under test
-- elsewhere.
insert into public.household_members (id, household_id, user_id, role, joined_at)
values ('hm-plain', 'hh-boot', '00000000-0000-0000-0000-00000000000e', 'member', '2026-01-01T00:00:00Z');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}';

create temporary table t_escalate as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'f1000000-0000-0000-0000-000000000001',
    'household_id', 'hh-boot', 'table', 'household_members', 'row_id', 'hm-plain',
    'op_type', 'delete',
    'payload', jsonb_build_object(),
    'device_id', 'devPlain',
    'actor_user_id', '00000000-0000-0000-0000-00000000000e',
    'client_created_at', '2026-01-01T00:00:00Z'
  ),
  jsonb_build_object(
    'v', '1', 'op_id', 'f1000000-0000-0000-0000-000000000002',
    'household_id', 'hh-boot', 'table', 'household_members', 'row_id', 'hm-plain-new',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000e', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devPlain',
    'actor_user_id', '00000000-0000-0000-0000-00000000000e',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 1 ->> 'status' from t_escalate), 'rejected',
  'P21: delete-then-reinsert-as-owner escalation insert leg is rejected');
select is((select res -> 1 ->> 'code' from t_escalate), 'forbidden_member',
  'P21: escalation insert leg rejection code is forbidden_member');

reset role;
select is(
  (select role from public.household_members where id = 'hm-plain'),
  'member', 'P22: the targeted member''s role column is unchanged (still member)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}';
select throws_ok(
  $$select public.create_invitation('hh-boot')$$,
  '42501'::character(5),
  null,
  'P23: the would-be escalator still cannot create an invitation (never became owner)');

-- ===========================================================================
-- 0007 DB-9: a foreign caller cannot bootstrap-hijack a household that has
-- EVER had a membership row, even if every row is now soft-deleted (the
-- household's last active member left). Simulated here via a direct
-- soft-delete (as postgres) rather than via sync_push, since the DB-9
-- last-owner delete guard now makes leaving-to-zero-active-members
-- unreachable through legitimate client traffic -- the server-side guard
-- must still hold regardless of how that historical state came about.
-- ===========================================================================
reset role;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000f', 'ex-owner@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'foreign-bootstrap@test.local');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}';
set constraints all deferred;

select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'f2000000-0000-0000-0000-000000000001',
    'household_id', 'hh-emptied', 'table', 'households', 'row_id', 'hh-emptied',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Emptied', 'payday_day', 1, 'user_level', 1,
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devEx',
    'actor_user_id', '00000000-0000-0000-0000-00000000000f',
    'client_created_at', '2026-01-01T00:00:00Z'
  ),
  jsonb_build_object(
    'v', '1', 'op_id', 'f2000000-0000-0000-0000-000000000002',
    'household_id', 'hh-emptied', 'table', 'household_members', 'row_id', 'hm-ex-owner',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000000000f', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devEx',
    'actor_user_id', '00000000-0000-0000-0000-00000000000f',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
));

reset role;
-- Simulate "the last member left": soft-delete the sole owner's row directly.
update public.household_members
  set deleted_at = now()
  where household_id = 'hh-emptied' and user_id = '00000000-0000-0000-0000-00000000000f';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}';

create temporary table t_foreign_boot as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'f2000000-0000-0000-0000-000000000003',
    'household_id', 'hh-emptied', 'table', 'household_members', 'row_id', 'hm-foreign',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000010', 'role', 'owner',
      'joined_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'devForeign',
    'actor_user_id', '00000000-0000-0000-0000-000000000010',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'status' from t_foreign_boot), 'rejected',
  'P24: bootstrap of a household with historical (now all soft-deleted) membership is rejected');
select is((select res -> 0 ->> 'code' from t_foreign_boot), 'not_member',
  'P25: rejection code is not_member (household never qualifies for bootstrap again)');
select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-emptied' and user_id = '00000000-0000-0000-0000-000000000010'),
  0, 'P26: the foreign caller gained no membership row at all');

-- ===========================================================================
-- 0007 DB-9: the sole active owner of hh-boot cannot leave via sync_push.
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

create temporary table t_last_owner as
select public.sync_push(jsonb_build_array(
  jsonb_build_object(
    'v', '1', 'op_id', 'f3000000-0000-0000-0000-000000000001',
    'household_id', 'hh-boot', 'table', 'household_members', 'row_id', 'hm-owner',
    'op_type', 'delete',
    'payload', jsonb_build_object(),
    'device_id', 'devBoot',
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'client_created_at', '2026-01-01T00:00:00Z'
  )
)) as res;

select is((select res -> 0 ->> 'status' from t_last_owner), 'rejected',
  'P27: the sole active owner cannot soft-delete their own membership');
select is((select res -> 0 ->> 'code' from t_last_owner), 'last_owner',
  'P28: rejection code is last_owner');
select is(
  (select deleted_at from public.household_members where id = 'hm-owner'),
  null, 'P29: the owner''s membership row is still active');

select * from finish();
rollback;

-- security_followups.test.sql
--
-- Contract for 0015_security_followups.sql (SEC2 wave). Seed pattern mirrors
-- invites.test.sql / account_deletion.test.sql / member_management.test.sql:
-- insert auth.users + households + household_members as `postgres` (RLS
-- bypassed), then `set local role authenticated` + `set local
-- request.jwt.claims` so the SECURITY DEFINER RPCs see the calling user's
-- identity via auth.uid(); `reset role` back to postgres for raw assertions.
-- Whole file is begin/rollback. No real concurrency is available from a
-- single pgTAP session/transaction, so the SEC2-8 "always has an owner"
-- probes (Section D) run the two possible ORDERINGS of a hypothetical race
-- sequentially instead, and check the invariant holds after each.

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ===========================================================================
-- Section A (SEC2-2(a)+(b)): the invite-guess throttle is not resettable by
-- calling delete_my_account_data.
-- ===========================================================================
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000f001', 'attacker@test.local');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}';

do $$
declare
  i int;
begin
  for i in 1..10 loop
    begin
      perform public.join_household_via_invite('BOGUS1');
    exception when others then
      null; -- once 10 failures are on record the remaining calls raise the throttle error
    end;
  end loop;
end
$$;

-- P1: the 11th bad-code attempt from the same caller is throttled.
select throws_like(
  $$select public.join_household_via_invite('BOGUS1')$$,
  '%too many attempts%',
  'P1: the 11th bad invite code from the same caller within an hour is throttled');

reset role;

-- P2: at least 10 invite_attempts rows recorded for the attacker.
select cmp_ok(
  (select count(*)::int from public.invite_attempts
     where user_id = '00000000-0000-0000-0000-00000000f001'),
  '>=', 10::int,
  'P2: invite_attempts recorded at least the 10 throttled failures for the attacker');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}';

create temporary table t_attacker_delete as
select public.delete_my_account_data() as result;

reset role;

-- P3: the attacker never joined any household, so nothing to leave.
select is(
  (select (result ->> 'households_left')::int from t_attacker_delete),
  0, 'P3: delete_my_account_data reports zero households left for the attacker');

-- P4 (SEC2-2(a)): invite_attempts for the attacker is UNTOUCHED by
-- delete_my_account_data -- still at least the 10 rows from before.
select cmp_ok(
  (select count(*)::int from public.invite_attempts
     where user_id = '00000000-0000-0000-0000-00000000f001'),
  '>=', 10::int,
  'P4: invite_attempts for the (self-deleted) attacker are NOT erased by delete_my_account_data');

-- P5: proof by effect -- an immediate further failed join from the SAME
-- caller (their session/JWT can still be valid; delete_my_account_data does
-- not revoke it, only the separate edge function's auth.admin.deleteUser
-- call does) is STILL throttled. If delete_my_account_data had reset the
-- throttle, this would succeed (raise "invite code is invalid" or similar)
-- instead of the throttle error.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f001","role":"authenticated"}';

select throws_like(
  $$select public.join_household_via_invite('BOGUS1')$$,
  '%too many attempts%',
  'P5: the throttle is NOT reset by looping delete_my_account_data (SEC2-2(a))');

reset role;

-- ===========================================================================
-- Section B (SEC2-2(d)): invite code length. create_invitation mints 10-char
-- codes; an existing 6-char code must still be accepted by
-- join_household_via_invite (length-agnostic lookup).
-- ===========================================================================
insert into public.households (id, name, payday_day, created_at, updated_at)
values ('hh-codelen', 'Code Length Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000f003', 'owner-codelen@test.local'),
  ('00000000-0000-0000-0000-00000000f004', 'joiner-oldcode@test.local');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values ('hm-codelen-owner', 'hh-codelen', '00000000-0000-0000-0000-00000000f003', 'owner', '2026-01-01T00:00:00.000Z');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f003","role":"authenticated"}';

create temporary table t_newcode as
select public.create_invitation('hh-codelen') as result;

-- P6: newly minted codes are 10 characters.
select ok(
  (select result ->> 'code' from t_newcode) ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$',
  'P6: create_invitation mints a 10-character code (SEC2-2(d))');

reset role;

-- A pre-existing 6-char code, seeded raw exactly like a code minted before
-- this migration shipped.
insert into public.invitations (id, code, household_id, created_by, expires_at)
values (
  gen_random_uuid(), 'OLD6CH', 'hh-codelen',
  '00000000-0000-0000-0000-00000000f003', now() + interval '1 hour'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f004","role":"authenticated"}';

-- P7: the old 6-char code still joins successfully.
select is(
  (public.join_household_via_invite('OLD6CH') ->> 'household_id'),
  'hh-codelen', 'P7: a pre-existing 6-character invite code still joins (join is length-agnostic)');

reset role;

-- ===========================================================================
-- Section C (SEC2-11): a client op claiming a `server:`-prefixed device_id
-- is rejected, pre-oplog, with the permanent `forbidden_column` code.
-- ===========================================================================
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-00000000f005', 'spoofer@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values ('hh-spoof', 'Spoof Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values ('hm-spoof-owner', 'hh-spoof', '00000000-0000-0000-0000-00000000f005', 'owner', '2026-01-01T00:00:00.000Z');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f005","role":"authenticated"}';

create temporary table t_spoof as
select public.sync_push(jsonb_build_array(jsonb_build_object(
  'v', '1',
  'op_id', 'b0000000-0000-0000-0000-000000000001',
  'household_id', 'hh-spoof',
  'table', 'envelopes',
  'row_id', 'env-spoof',
  'op_type', 'insert',
  'payload', jsonb_build_object(
    'name', 'Spoofed', 'allocated_cents', 0, 'period_start', '2026-01-01',
    'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
  'device_id', 'server:x'
))) as result;

-- P8: the op is rejected with the permanent forbidden_column code.
select is(
  (select result -> 0 ->> 'code' from t_spoof),
  'forbidden_column', 'P8: a client op claiming a server: device_id is rejected forbidden_column (SEC2-11)');

reset role;

-- P9: no oplog row was ever written for the rejected op (pre-oplog reject).
select is(
  (select count(*)::int from public.oplog where op_id = 'b0000000-0000-0000-0000-000000000001'),
  0, 'P9: the rejected spoofed-device_id op never reached the oplog');

-- ===========================================================================
-- Section D (SEC2-8): a household always has an owner across the two
-- possible orderings of a race between delete_my_account_data and
-- remove_household_member. True concurrency is not testable from a single
-- pgTAP session, so this runs both orderings sequentially and checks the
-- invariant after each step.
-- ===========================================================================

-- --- Ordering 1: owner deletes their account FIRST (promotes the oldest
--     other member), then the NEW owner removes a plain member. ---
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000f010', 'race1-owner@test.local'),
  ('00000000-0000-0000-0000-00000000f011', 'race1-old@test.local'),
  ('00000000-0000-0000-0000-00000000f012', 'race1-new@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values ('hh-race1', 'Race Household 1', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-race1-owner', 'hh-race1', '00000000-0000-0000-0000-00000000f010', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-race1-old', 'hh-race1', '00000000-0000-0000-0000-00000000f011', 'member', '2026-01-02T00:00:00.000Z'),
  ('hm-race1-new', 'hh-race1', '00000000-0000-0000-0000-00000000f012', 'member', '2026-01-03T00:00:00.000Z');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f010","role":"authenticated"}';

select public.delete_my_account_data();

reset role;

-- P10: the longest-standing remaining member (old) was promoted to owner.
select is(
  (select role from public.household_members where id = 'hm-race1-old'),
  'owner', 'P10: ordering 1 -- the departing owner''s replacement is the longest-standing member');

-- P11: the household has exactly one active owner after step 1.
select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-race1' and role = 'owner' and deleted_at is null),
  1, 'P11: ordering 1 -- exactly one active owner after the owner''s account deletion');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f011","role":"authenticated"}';

select public.remove_household_member('hh-race1', '00000000-0000-0000-0000-00000000f012');

reset role;

-- P12: the removed member is gone.
select isnt(
  (select deleted_at from public.household_members where id = 'hm-race1-new'),
  null, 'P12: ordering 1 -- the new owner successfully removed the remaining plain member');

-- P13: the household still has exactly one active owner.
select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-race1' and role = 'owner' and deleted_at is null),
  1, 'P13: ordering 1 -- exactly one active owner after the subsequent removal');

-- --- Ordering 2 (reversed): owner removes a plain member FIRST, then
--     deletes their own account (promoting the sole remaining member). ---
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000f020', 'race2-owner@test.local'),
  ('00000000-0000-0000-0000-00000000f021', 'race2-remaining@test.local'),
  ('00000000-0000-0000-0000-00000000f022', 'race2-removed@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values ('hh-race2', 'Race Household 2', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-race2-owner', 'hh-race2', '00000000-0000-0000-0000-00000000f020', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-race2-remaining', 'hh-race2', '00000000-0000-0000-0000-00000000f021', 'member', '2026-01-02T00:00:00.000Z'),
  ('hm-race2-removed', 'hh-race2', '00000000-0000-0000-0000-00000000f022', 'member', '2026-01-03T00:00:00.000Z');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f020","role":"authenticated"}';

select public.remove_household_member('hh-race2', '00000000-0000-0000-0000-00000000f022');

reset role;

-- P14: the removed member is gone.
select isnt(
  (select deleted_at from public.household_members where id = 'hm-race2-removed'),
  null, 'P14: ordering 2 -- the owner removed the member first');

-- P15: the household still has exactly one active owner (the original one).
select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-race2' and role = 'owner' and deleted_at is null),
  1, 'P15: ordering 2 -- exactly one active owner after the removal');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f020","role":"authenticated"}';

select public.delete_my_account_data();

reset role;

-- P16: the sole remaining member was promoted to owner.
select is(
  (select role from public.household_members where id = 'hm-race2-remaining'),
  'owner', 'P16: ordering 2 -- the sole remaining member was promoted after the owner deleted their account');

-- P17: the household never ends up ownerless -- exactly one active owner.
select is(
  (select count(*)::int from public.household_members
     where household_id = 'hh-race2' and role = 'owner' and deleted_at is null),
  1, 'P17: ordering 2 -- exactly one active owner after the owner''s account deletion');

-- ===========================================================================
-- Section E (SEC2-10): prune crons exist; the broken cleanup cron is gone.
-- ===========================================================================
select ok(
  exists (select 1 from cron.job where jobname = 'prune-invite-attempts'),
  'P18: the prune-invite-attempts cron job is scheduled');

select ok(
  exists (select 1 from cron.job where jobname = 'prune-slip-extraction-attempts'),
  'P19: the prune-slip-extraction-attempts cron job is scheduled');

select ok(
  not exists (select 1 from cron.job where jobname = 'cleanup-old-slip-images'),
  'P20: the broken cleanup-old-slip-images cron job is unscheduled (SEC2-9)');

-- ===========================================================================
-- Section F: has_function_privilege is unchanged for every re-issued
-- function.
-- ===========================================================================
select ok(
  has_function_privilege('authenticated', 'public.create_invitation(text)', 'execute'),
  'P21: authenticated can still execute create_invitation');

select ok(
  has_function_privilege('authenticated', 'public.join_household_via_invite(text)', 'execute'),
  'P22: authenticated can still execute join_household_via_invite');

select ok(
  has_function_privilege('authenticated', 'public.delete_my_account_data()', 'execute'),
  'P23: authenticated can still execute delete_my_account_data');

select ok(
  not has_function_privilege('anon', 'public.delete_my_account_data()', 'execute'),
  'P24: anon still cannot execute delete_my_account_data');

select ok(
  has_function_privilege('authenticated', 'public.remove_household_member(text, text)', 'execute'),
  'P25: authenticated can still execute remove_household_member');

select ok(
  not has_function_privilege('anon', 'public.remove_household_member(text, text)', 'execute'),
  'P26: anon still cannot execute remove_household_member');

select ok(
  not has_function_privilege('authenticated', 'private.apply_one_op(jsonb)', 'execute'),
  'P27: authenticated still cannot execute private.apply_one_op directly (only via SECURITY DEFINER wrappers)');

select ok(
  has_function_privilege('service_role', 'public.cleanup_old_slip_images()', 'execute'),
  'P28: service_role can still execute cleanup_old_slip_images');

select ok(
  not has_function_privilege('authenticated', 'public.cleanup_old_slip_images()', 'execute'),
  'P29: authenticated still cannot execute cleanup_old_slip_images');

select * from finish();
rollback;

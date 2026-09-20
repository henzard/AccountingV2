-- account_deletion.test.sql
--
-- Contract for public.delete_my_account_data() (migration
-- 0012_account_deletion.sql), the server half of the in-app "delete my
-- account" path promised by docs/privacy-policy.md and required by Google
-- Play.
--
-- Seed pattern mirrors invites.test.sql / household_bootstrap.test.sql:
-- insert auth.users + households + household_members as `postgres` (RLS
-- bypassed), then `set local role authenticated` + `set local
-- request.jwt.claims` so the SECURITY DEFINER RPC sees the caller's identity
-- via auth.uid(); `reset role` back to postgres for the raw assertions.
-- Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ---------------------------------------------------------------------------
-- Seed (as postgres, RLS bypassed).
--
--   hh-solo   -- user A alone (owner). Deleting A must soft-delete the
--                membership and leave the financial rows unreachable-but-
--                present (retention purge is a separate job).
--   hh-team   -- user B (owner, joined Jan 1), user C (member, joined Jan 2),
--                user D (member, joined Mar 1). Deleting B must promote C --
--                the LONGEST-STANDING other active member, not D.
--   hh-other  -- user E alone. Every one of E's rows must survive untouched.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'solo@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'oldmember@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'newmember@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'bystander@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-solo', 'Solo Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-team', 'Team Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-other', 'Other Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-solo', 'hh-solo', '00000000-0000-0000-0000-0000000000a1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-team-owner', 'hh-team', '00000000-0000-0000-0000-0000000000b1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-team-old', 'hh-team', '00000000-0000-0000-0000-0000000000c1', 'member', '2026-01-02T00:00:00.000Z'),
  ('hm-team-new', 'hh-team', '00000000-0000-0000-0000-0000000000d1', 'member', '2026-03-01T00:00:00.000Z'),
  ('hm-other', 'hh-other', '00000000-0000-0000-0000-0000000000e1', 'owner', '2026-01-01T00:00:00.000Z');

-- Financial row in the solo household: must SURVIVE the deletion (unreachable,
-- not purged -- see the RETENTION note in 0012).
insert into public.envelopes (id, household_id, name, allocated_cents, period_start, created_at, updated_at)
values ('env-solo', 'hh-solo', 'Groceries', 50000, '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- User-scoped rows for A (to be erased) and E (must be untouched).
insert into public.user_fcm_tokens (user_id, token)
values
  ('00000000-0000-0000-0000-0000000000a1', 'tok-a-phone'),
  ('00000000-0000-0000-0000-0000000000a1', 'tok-a-tablet'),
  ('00000000-0000-0000-0000-0000000000e1', 'tok-e-phone')
on conflict do nothing;

insert into public.user_consent (user_id, slip_scan_consent_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e1', now(), now(), now());

insert into public.user_preferences (user_id, theme_preference)
values
  ('00000000-0000-0000-0000-0000000000a1', 'dark'),
  ('00000000-0000-0000-0000-0000000000e1', 'light');

insert into public.invite_attempts (user_id)
values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e1');

insert into public.slip_extraction_attempts (user_id, household_id, slip_id)
values
  ('00000000-0000-0000-0000-0000000000a1', 'hh-solo', 'slip-a'),
  ('00000000-0000-0000-0000-0000000000e1', 'hh-other', 'slip-e');

-- Attribution columns that cannot be deleted (the rows belong to a household
-- other members still use) and must be anonymised instead.
insert into public.invitations (id, code, household_id, created_by, expires_at, used_by, used_at)
values
  (gen_random_uuid(), 'AAAAAA', 'hh-solo', '00000000-0000-0000-0000-0000000000a1',
   now() + interval '1 hour', null, null),
  (gen_random_uuid(), 'BBBBBB', 'hh-team', '00000000-0000-0000-0000-0000000000b1',
   now() - interval '1 hour', '00000000-0000-0000-0000-0000000000a1', now() - interval '2 hours'),
  (gen_random_uuid(), 'EEEEEE', 'hh-other', '00000000-0000-0000-0000-0000000000e1',
   now() + interval '1 hour', null, null);

insert into public.slip_queue (id, household_id, created_by, image_uris, status, created_at, updated_at)
values
  ('slip-a', 'hh-solo', '00000000-0000-0000-0000-0000000000a1', 'a.jpg', 'completed',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('slip-e', 'hh-other', '00000000-0000-0000-0000-0000000000e1', 'e.jpg', 'completed',
   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- ===========================================================================
-- Probe 0: grants. authenticated may call it; anon may not.
-- ===========================================================================
select ok(
  has_function_privilege('authenticated', 'public.delete_my_account_data()', 'execute'),
  'P0: authenticated can execute delete_my_account_data');

select ok(
  not has_function_privilege('anon', 'public.delete_my_account_data()', 'execute'),
  'P0: anon cannot execute delete_my_account_data');

-- ===========================================================================
-- Probe 1: user A -- SOLE active member of hh-solo.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

create temporary table t_solo as
select public.delete_my_account_data() as result;

reset role;

select is(
  (select (result ->> 'households_left')::int from t_solo),
  1, 'P1: one household left');

select is(
  (select (result ->> 'sole_member_households')::int from t_solo),
  1, 'P1: that household is reported as a sole-member household');

select is(
  (select (result ->> 'ownership_transfers')::int from t_solo),
  0, 'P1: a sole member triggers no ownership transfer');

select isnt(
  (select deleted_at from public.household_members where id = 'hm-solo'),
  null, 'P1: the sole member''s membership row is soft-deleted');

select is(
  (select count(*)::int from public.oplog
   where table_name = 'household_members' and row_id = 'hm-solo' and op_type = 'delete'),
  1, 'P1: exactly one oplog delete row was appended for the membership');

-- Compared as timestamptz, not text: jsonb_build_object renders a timestamptz
-- in ISO-8601 ("...T...+00:00") while ::text uses Postgres' own format, so a
-- string comparison would fail on formatting alone even when the instants match.
select is(
  (select (payload ->> 'deleted_at')::timestamptz from public.oplog
   where table_name = 'household_members' and row_id = 'hm-solo' and op_type = 'delete'),
  (select deleted_at from public.household_members where id = 'hm-solo'),
  'P1: the oplog delete payload carries the same tombstone the row got');

-- RETENTION: the household's financial rows are deliberately NOT purged here.
select is(
  (select count(*)::int from public.envelopes where id = 'env-solo' and deleted_at is null),
  1, 'P1: the household''s financial rows are left in place (retention purge is a separate job)');

-- ===========================================================================
-- Probe 2: every user-scoped row for A is gone; E''s identical rows survive.
-- ===========================================================================
select is(
  (select count(*)::int from public.user_fcm_tokens where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'P2: all of the deleted user''s FCM tokens are gone');

select is(
  (select count(*)::int from public.user_consent where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'P2: the deleted user''s consent row is gone');

select is(
  (select count(*)::int from public.user_preferences where user_id = '00000000-0000-0000-0000-0000000000a1'::uuid),
  0, 'P2: the deleted user''s preferences row is gone');

-- SEC2-2(a) (0015_security_followups.sql): delete_my_account_data no longer
-- deletes invite_attempts. This used to assert the opposite (count = 0);
-- see security_followups.test.sql for the throttle-not-resettable proof
-- this change exists for.
select is(
  (select count(*)::int from public.invite_attempts where user_id = '00000000-0000-0000-0000-0000000000a1'),
  1, 'P2: the deleted user''s invite attempts are NOT touched (SEC2-2(a): erasing them let the throttle be reset)');

select is(
  (select count(*)::int from public.slip_extraction_attempts where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'P2: the deleted user''s slip extraction attempts are gone');

select is(
  (select created_by from public.invitations where code = 'AAAAAA'),
  'deleted-user', 'P2: invitations.created_by is tombstoned (the column is NOT NULL)');

select is(
  (select used_by from public.invitations where code = 'BBBBBB'),
  'deleted-user',
  'P2: a CONSUMED invitation''s used_by is tombstoned, not nulled (null means unused)');

select is(
  (select created_by from public.slip_queue where id = 'slip-a'),
  'deleted-user', 'P2: slip_queue.created_by is tombstoned');

select is(
  (select count(*)::int from public.oplog
   where table_name = 'slip_queue' and row_id = 'slip-a' and op_type = 'update'
     and payload ->> 'created_by' = 'deleted-user'),
  1, 'P2: the slip anonymisation was replicated as an oplog update op');

-- Bystander E: nothing of theirs was touched.
select is(
  (select count(*)::int from public.user_fcm_tokens where user_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'P2: another user''s FCM token is untouched');

select is(
  (select count(*)::int from public.user_consent where user_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'P2: another user''s consent row is untouched');

select is(
  (select count(*)::int from public.user_preferences where user_id = '00000000-0000-0000-0000-0000000000e1'::uuid),
  1, 'P2: another user''s preferences row is untouched');

select is(
  (select count(*)::int from public.invite_attempts where user_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'P2: another user''s invite attempts are untouched');

select is(
  (select created_by from public.slip_queue where id = 'slip-e'),
  '00000000-0000-0000-0000-0000000000e1', 'P2: another user''s slip attribution is untouched');

select is(
  (select deleted_at from public.household_members where id = 'hm-other'),
  null, 'P2: another user''s membership is untouched');

-- ===========================================================================
-- Probe 3: a second call by the same (already-deleted) user is a no-op.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

create temporary table t_solo_again as
select public.delete_my_account_data() as result;

reset role;

select is(
  (select (result ->> 'households_left')::int from t_solo_again),
  0, 'P3: the second call leaves no further households');

select is(
  (select (result ->> 'fcm_tokens_deleted')::int from t_solo_again),
  0, 'P3: the second call deletes no further tokens');

select is(
  (select (result ->> 'slips_anonymised')::int from t_solo_again),
  0, 'P3: the second call anonymises no further slips (the tombstone no longer matches)');

select is(
  (select count(*)::int from public.oplog
   where table_name = 'household_members' and row_id = 'hm-solo' and op_type = 'delete'),
  1, 'P3: the second call appended no duplicate oplog row');

-- ===========================================================================
-- Probe 4: user B -- last active OWNER of hh-team, other active members
-- remain. Ownership must pass to C (joined Jan 2), NOT D (joined Mar 1).
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

create temporary table t_owner as
select public.delete_my_account_data() as result;

reset role;

select is(
  (select (result ->> 'ownership_transfers')::int from t_owner),
  1, 'P4: the departing last owner transferred ownership exactly once');

select is(
  (select role from public.household_members where id = 'hm-team-old'),
  'owner', 'P4: the LONGEST-STANDING other active member was promoted to owner');

select is(
  (select role from public.household_members where id = 'hm-team-new'),
  'member', 'P4: the newer member was not promoted');

select isnt(
  (select deleted_at from public.household_members where id = 'hm-team-owner'),
  null, 'P4: the departing owner''s membership row is soft-deleted');

-- The promotion is visible to the household's other devices, which converge
-- purely by pulling public.oplog via sync_pull.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

select is(
  (select count(*)::int
   from public.sync_pull('hh-team', 0, 500) o
   where o.table_name = 'household_members'
     and o.row_id = 'hm-team-old'
     and o.op_type = 'update'
     and o.payload ->> 'role' = 'owner'),
  1, 'P4: the promoted member sees the ownership change through sync_pull');

select is(
  (select count(*)::int
   from public.sync_pull('hh-team', 0, 500) o
   where o.table_name = 'household_members'
     and o.row_id = 'hm-team-owner'
     and o.op_type = 'delete'),
  1, 'P4: the remaining member sees the departure through sync_pull');

reset role;

-- ===========================================================================
-- Probe 5: user D -- a plain member of a household that still has an owner.
-- No promotion, just a clean departure.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

create temporary table t_member as
select public.delete_my_account_data() as result;

reset role;

select is(
  (select (result ->> 'ownership_transfers')::int from t_member),
  0, 'P5: a plain member leaving triggers no ownership transfer');

select isnt(
  (select deleted_at from public.household_members where id = 'hm-team-new'),
  null, 'P5: the plain member''s membership row is soft-deleted');

select is(
  (select role from public.household_members where id = 'hm-team-old'),
  'owner', 'P5: the household keeps its owner');

select * from finish();
rollback;

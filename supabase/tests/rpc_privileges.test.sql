-- rpc_privileges.test.sql
--
-- Contract for two 0007 grant/RLS hardening fixes:
--   DB-4  check_and_reserve_notify_send / check_and_reserve_slip_slot /
--         cleanup_old_slip_images must be unreachable via the PostgREST RPC
--         endpoint for both anon and authenticated -- service_role only.
--   DB-10 invitations_select must only let the invitation's own creator or a
--         current household owner read it, not every member.
--
-- Follows the seed/role-switch pattern of invites.test.sql / oplog_protocol
-- .test.sql. Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ===========================================================================
-- DB-4: none of the three service_role-only RPCs are executable by anon or
-- authenticated at the grant level (has_function_privilege is independent of
-- RLS -- it reflects the actual GRANT/REVOKE state on the function).
-- ===========================================================================
select ok(
  not has_function_privilege('anon', 'public.check_and_reserve_notify_send(text, integer)', 'execute'),
  'DB-4: anon cannot execute check_and_reserve_notify_send');

select ok(
  not has_function_privilege('authenticated', 'public.check_and_reserve_notify_send(text, integer)', 'execute'),
  'DB-4: authenticated cannot execute check_and_reserve_notify_send');

select ok(
  not has_function_privilege('anon', 'public.check_and_reserve_slip_slot(text, text, text)', 'execute'),
  'DB-4: anon cannot execute check_and_reserve_slip_slot');

select ok(
  not has_function_privilege('authenticated', 'public.check_and_reserve_slip_slot(text, text, text)', 'execute'),
  'DB-4: authenticated cannot execute check_and_reserve_slip_slot');

select ok(
  not has_function_privilege('anon', 'public.cleanup_old_slip_images()', 'execute'),
  'DB-4: anon cannot execute cleanup_old_slip_images');

select ok(
  not has_function_privilege('authenticated', 'public.cleanup_old_slip_images()', 'execute'),
  'DB-4: authenticated cannot execute cleanup_old_slip_images');

-- ===========================================================================
-- DB-10: a non-owner member cannot select another member's live invitation;
-- the owner (and the invitation's own creator) still can.
-- ===========================================================================
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'rpc-owner@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'rpc-member@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values ('hh-rpc', 'RPC Privileges Household', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-rpc-owner', 'hh-rpc', '00000000-0000-0000-0000-0000000000a1', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-rpc-member', 'hh-rpc', '00000000-0000-0000-0000-0000000000a2', 'member', '2026-01-01T00:00:00.000Z');

insert into public.invitations (id, code, household_id, created_by, expires_at)
values ('a0000000-0000-0000-0000-0000000000c1', 'RPCINV', 'hh-rpc', '00000000-0000-0000-0000-0000000000a1', now() + interval '48 hours');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from public.invitations where id = 'a0000000-0000-0000-0000-0000000000c1'),
  1, 'DB-10: the invitation''s creator (owner) can see it');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from public.invitations where id = 'a0000000-0000-0000-0000-0000000000c1'),
  0, 'DB-10: a non-owner member cannot see the owner''s invitation');

select * from finish();
rollback;

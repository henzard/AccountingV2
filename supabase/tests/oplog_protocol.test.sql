-- oplog_protocol.test.sql
--
-- Contract for the server half of the oplog sync protocol (Task 3, spec §6/§7).
-- Written FIRST (TDD): every probe below FAILS until sync_push / sync_pull /
-- sync_row_state / apply_server_op + the oplog table exist in 0001_baseline.sql.
--
-- Seed pattern mirrors rls_cross_household.test.sql: insert auth.users +
-- households + household_members as `postgres`, then `set local role
-- authenticated` + `set local request.jwt.claims` so the SECURITY DEFINER RPCs
-- see the calling user's membership via auth.uid(). Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ---------------------------------------------------------------------------
-- Seed (as postgres, RLS bypassed)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@test.local');

insert into public.households (id, name, payday_day, created_at, updated_at)
values
  ('hh-a', 'Household A', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-b', 'Household B', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('hh-c', 'Household C', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

insert into public.household_members (id, household_id, user_id, role, joined_at)
values
  ('hm-a', 'hh-a', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-b', 'hh-b', '00000000-0000-0000-0000-00000000000b', 'owner', '2026-01-01T00:00:00.000Z'),
  ('hm-c', 'hh-c', '00000000-0000-0000-0000-00000000000a', 'owner', '2026-01-01T00:00:00.000Z');

-- An envelope in hh-b (another household) for the wrong_household probe.
insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-b', 'hh-b', 'Groceries B', 10000, 0, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- Envelopes in hh-a pre-seeded for the delete + increment probes.
insert into public.envelopes (id, household_id, name, allocated_cents, spent_cents, envelope_type, period_start, created_at, updated_at)
values
  ('env-del', 'hh-a', 'Deletable', 0, 0, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('env-inc', 'hh-a', 'Incrementable', 0, 50, 'spending', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- 600 oplog rows for hh-c so sync_pull's 500 cap is exercised deterministically.
insert into public.oplog (op_id, household_id, table_name, row_id, op_type, device_id)
select gen_random_uuid(), 'hh-c', 'envelopes', 'row-' || g, 'update', 'seed-dev'
from generate_series(1, 600) g;

-- ---------------------------------------------------------------------------
-- Act as user A (authenticated) — membership resolved via auth.uid()
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- ===========================================================================
-- Probe 1: push insert -> op applied, row in entity table, oplog seq assigned
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000001',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-a1',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Groceries A', 'period_start', '2026-01-01',
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z',
      'allocated_cents', 5000, 'spent_cents', 0, 'envelope_type', 'spending'),
    'actor_user_id', '00000000-0000-0000-0000-00000000000a',
    'device_id', 'dev-a',
    'client_created_at', '2026-01-01T00:00:00Z'
  ))) -> 0 ->> 'status',
  'applied', 'P1: insert op returns applied');

select is(
  (select count(*)::int from public.envelopes where id = 'env-a1'),
  1, 'P1: insert op created the entity row');

select cmp_ok(
  (select seq from public.oplog where op_id = 'a0000000-0000-0000-0000-000000000001'),
  '>', 0::bigint, 'P1: oplog seq assigned');

-- ===========================================================================
-- Probe 2: duplicate op_id resend -> applied, no double row
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000001',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-a1',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Groceries A', 'period_start', '2026-01-01',
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z',
      'allocated_cents', 5000, 'spent_cents', 0, 'envelope_type', 'spending'),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'status',
  'applied', 'P2: duplicate op_id resend returns applied');

select is(
  (select count(*)::int from public.envelopes where id = 'env-a1'),
  1, 'P2: duplicate resend did not create a second row');

-- ===========================================================================
-- Probe 3: push for a household the caller is not a member of -> not_member
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000003',
    'household_id', 'hh-b',
    'table', 'envelopes',
    'row_id', 'env-x',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'X', 'period_start', '2026-01-01',
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'code',
  'not_member', 'P3: push to non-member household rejected not_member');

-- ===========================================================================
-- Probe 4: update with household_id in payload -> forbidden_column
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000004',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-a1',
    'op_type', 'update',
    'payload', jsonb_build_object('household_id', 'hh-b', 'name', 'Hijack'),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'code',
  'forbidden_column', 'P4: update setting household_id rejected forbidden_column');

-- ===========================================================================
-- Probe 5: update targeting another household's row -> wrong_household
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000005',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-b',
    'op_type', 'update',
    'payload', jsonb_build_object('name', 'Stolen'),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'code',
  'wrong_household', 'P5: update targeting foreign row rejected wrong_household');

-- ===========================================================================
-- Probe 6: delete -> deleted_at set, row still present (soft delete)
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000006',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-del',
    'op_type', 'delete',
    'payload', jsonb_build_object(),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'status',
  'applied', 'P6: delete op returns applied');

select isnt(
  (select deleted_at from public.envelopes where id = 'env-del'),
  null, 'P6: delete sets deleted_at');

select is(
  (select count(*)::int from public.envelopes where id = 'env-del'),
  1, 'P6: soft delete leaves the row present');

-- ===========================================================================
-- Probe 7: increment with floor_zero clamps at 0
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000007',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-inc',
    'op_type', 'increment',
    'payload', jsonb_build_object('field', 'spent_cents', 'delta', -100, 'clamp', 'floor_zero'),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'status',
  'applied', 'P7: increment op returns applied');

select is(
  (select spent_cents from public.envelopes where id = 'env-inc'),
  0, 'P7: increment floor_zero clamps at 0 (50 + -100 -> 0)');

-- ===========================================================================
-- Probe 8: one bad op in a batch of 3 -> the other 2 applied (not atomic).
-- Batch is idempotent (op1/op3 inserts, op2 a pure rejection) so re-running
-- across the 3 assertions is safe.
-- ===========================================================================
select is(
  (public.sync_push(jsonb_build_array(
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008a',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-8a', 'op_type', 'insert',
      'payload', jsonb_build_object('name', 'Batch1', 'period_start', '2026-01-01',
        'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
      'device_id', 'dev-a'),
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008b',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-a1', 'op_type', 'update',
      'payload', jsonb_build_object('household_id', 'hh-b'),
      'device_id', 'dev-a'),
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008c',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-8c', 'op_type', 'insert',
      'payload', jsonb_build_object('name', 'Batch3', 'period_start', '2026-01-01',
        'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
      'device_id', 'dev-a')
  )) -> 0 ->> 'status'),
  'applied', 'P8: first op in batch applied');

select is(
  (public.sync_push(jsonb_build_array(
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008a',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-8a', 'op_type', 'insert',
      'payload', jsonb_build_object('name', 'Batch1', 'period_start', '2026-01-01',
        'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
      'device_id', 'dev-a'),
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008b',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-a1', 'op_type', 'update',
      'payload', jsonb_build_object('household_id', 'hh-b'),
      'device_id', 'dev-a'),
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008c',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-8c', 'op_type', 'insert',
      'payload', jsonb_build_object('name', 'Batch3', 'period_start', '2026-01-01',
        'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
      'device_id', 'dev-a')
  )) -> 1 ->> 'status'),
  'rejected', 'P8: middle (bad) op in batch rejected');

select is(
  (public.sync_push(jsonb_build_array(
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008a',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-8a', 'op_type', 'insert',
      'payload', jsonb_build_object('name', 'Batch1', 'period_start', '2026-01-01',
        'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
      'device_id', 'dev-a'),
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008b',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-a1', 'op_type', 'update',
      'payload', jsonb_build_object('household_id', 'hh-b'),
      'device_id', 'dev-a'),
    jsonb_build_object('v', 1, 'op_id', 'a0000000-0000-0000-0000-00000000008c',
      'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-8c', 'op_type', 'insert',
      'payload', jsonb_build_object('name', 'Batch3', 'period_start', '2026-01-01',
        'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
      'device_id', 'dev-a')
  )) -> 2 ->> 'status'),
  'applied', 'P8: third op in batch applied despite middle failure');

-- ===========================================================================
-- Probe 9: sync_pull ordering, cursor, and 500 cap
-- ===========================================================================
-- Ascending order (function orders by seq; window preserves output order).
select ok(
  not exists (
    select 1 from (
      select seq, lag(seq) over () as prev
      from public.sync_pull('hh-a', 0, 200)
    ) s
    where s.prev is not null and s.seq < s.prev
  ),
  'P9: sync_pull returns rows in ascending seq order');

-- Cursor excludes rows at/before p_after_seq.
select is(
  (select count(*)::int
   from public.sync_pull('hh-a',
     (select seq from public.oplog where op_id = 'a0000000-0000-0000-0000-000000000001'),
     200)
   where seq <= (select seq from public.oplog where op_id = 'a0000000-0000-0000-0000-000000000001')),
  0, 'P9: sync_pull excludes rows at/before the cursor');

-- 500 cap: hh-c has 600 rows, request 1000, expect exactly 500.
select is(
  (select count(*)::int from public.sync_pull('hh-c', 0, 1000)),
  500, 'P9: sync_pull caps p_limit at 500');

-- ===========================================================================
-- Probe 10: sync_row_state returns row for members, null for non-members
-- ===========================================================================
select isnt(
  public.sync_row_state('hh-a', 'envelopes', 'env-a1'),
  null, 'P10: member gets the row state');

select is(
  public.sync_row_state('hh-b', 'envelopes', 'env-b'),
  null, 'P10: non-member gets null row state');

-- ===========================================================================
-- Probe 11: insert whose row already exists with same id -> applied no-op
-- ===========================================================================
select is(
  public.sync_push(jsonb_build_array(jsonb_build_object(
    'v', 1,
    'op_id', 'a0000000-0000-0000-0000-000000000011',
    'household_id', 'hh-a',
    'table', 'envelopes',
    'row_id', 'env-a1',
    'op_type', 'insert',
    'payload', jsonb_build_object(
      'name', 'Should Not Overwrite', 'period_start', '2026-01-01',
      'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
    'device_id', 'dev-a'
  ))) -> 0 ->> 'status',
  'applied', 'P11: insert onto existing id returns applied (no-op)');

select is(
  (select name from public.envelopes where id = 'env-a1'),
  'Groceries A', 'P11: existing row not overwritten by the no-op insert');

-- ===========================================================================
-- Probe 12: two sequential pushes get monotonically increasing seq
-- ===========================================================================
select public.sync_push(jsonb_build_array(jsonb_build_object(
  'v', 1, 'op_id', 'a0000000-0000-0000-0000-0000000012a1',
  'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-s1', 'op_type', 'insert',
  'payload', jsonb_build_object('name', 'Seq1', 'period_start', '2026-01-01',
    'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
  'device_id', 'dev-a')));

select public.sync_push(jsonb_build_array(jsonb_build_object(
  'v', 1, 'op_id', 'a0000000-0000-0000-0000-0000000012b2',
  'household_id', 'hh-a', 'table', 'envelopes', 'row_id', 'env-s2', 'op_type', 'insert',
  'payload', jsonb_build_object('name', 'Seq2', 'period_start', '2026-01-01',
    'created_at', '2026-01-01T00:00:00Z', 'updated_at', '2026-01-01T00:00:00Z'),
  'device_id', 'dev-a')));

select cmp_ok(
  (select seq from public.oplog where op_id = 'a0000000-0000-0000-0000-0000000012b2'),
  '>',
  (select seq from public.oplog where op_id = 'a0000000-0000-0000-0000-0000000012a1'),
  'P12: later push gets a higher seq than the earlier push');

select * from finish();
rollback;

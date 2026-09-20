-- notify_throttle.test.sql
--
-- Contract for the 0017 fix: public.check_and_reserve_notify_send_v2 is the
-- bucket-aware, per-sender-locked replacement for
-- public.check_and_reserve_notify_send. This file proves:
--   * the hourly cap is enforced PER BUCKET, not per sender;
--   * the 'over_budget' bucket has its own counter, so a sender who has
--     exhausted the ordinary 'default' bucket can still get an over-budget
--     alert through (REG-15: the push that matters most used to be the one
--     the limit rejected);
--   * a legacy NULL-bucket row (written by the untouched v1 function during
--     a mixed-version window) counts against the 'default' bucket, so the
--     cap cannot be sidestepped by racing the two functions;
--   * notify_send_log really carries the new bucket column;
--   * anon and authenticated cannot execute the new RPC (0007's DB-4
--     treatment of the v1 function, carried forward).
--
-- Follows slip_rate_limit.test.sql's convention: stays as `postgres`
-- throughout, since check_and_reserve_notify_send_v2 is SECURITY DEFINER with
-- no EXECUTE grant for `authenticated` at all -- calling it as postgres
-- (which bypasses grants entirely) isolates the behavioural probes from the
-- privilege probes below. Whole file is begin/rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ===========================================================================
-- Probes 1-3: the cap is enforced within a bucket.
-- Sender 'sender-a', bucket 'default', limit 2 -> allow, allow, deny.
-- ===========================================================================
select ok(
  public.check_and_reserve_notify_send_v2('sender-a', 'default', 2),
  'REG-15: first default-bucket send is reserved');

select ok(
  public.check_and_reserve_notify_send_v2('sender-a', 'default', 2),
  'REG-15: second default-bucket send is reserved (still under the cap)');

select ok(
  not public.check_and_reserve_notify_send_v2('sender-a', 'default', 2),
  'REG-15: third default-bucket send is denied (cap of 2 reached)');

-- ===========================================================================
-- Probes 4-5: the over_budget bucket is an INDEPENDENT counter for the SAME
-- sender. 'default' is exhausted above, yet the first over_budget send still
-- goes through; its own cap of 1 then applies to it alone.
-- ===========================================================================
select ok(
  public.check_and_reserve_notify_send_v2('sender-a', 'over_budget', 1),
  'REG-15: over_budget send is reserved even though the default bucket is exhausted');

select ok(
  not public.check_and_reserve_notify_send_v2('sender-a', 'over_budget', 1),
  'REG-15: over_budget bucket enforces its own cap independently');

-- ===========================================================================
-- Probe 6: a row written by the untouched v1 function carries bucket NULL.
-- v2 counts NULL as 'default', so it cannot be used to overshoot the cap.
-- ===========================================================================
insert into public.notify_send_log (sender_id) values ('sender-b');

select ok(
  not public.check_and_reserve_notify_send_v2('sender-b', 'default', 1),
  'SEC2-12: a legacy NULL-bucket row counts against the default bucket');

-- ===========================================================================
-- Probe 7: the column the bucket dimension rides on actually exists.
-- ===========================================================================
select has_column('public', 'notify_send_log', 'bucket',
  '0017: notify_send_log has a bucket column');

-- ===========================================================================
-- Probes 8-9: the RPC is service_role-only, exactly like its v1 counterpart
-- (0007 DB-4). A client that could call it directly could burn another
-- member's budget, or reserve without ever sending.
-- ===========================================================================
select ok(
  not has_function_privilege('anon',
    'public.check_and_reserve_notify_send_v2(text, text, integer)', 'execute'),
  'DB-4: anon cannot execute check_and_reserve_notify_send_v2');

select ok(
  not has_function_privilege('authenticated',
    'public.check_and_reserve_notify_send_v2(text, text, integer)', 'execute'),
  'DB-4: authenticated cannot execute check_and_reserve_notify_send_v2');

select * from finish();
rollback;

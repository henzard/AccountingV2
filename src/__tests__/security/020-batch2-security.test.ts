import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0001_baseline.sql'),
  'utf8',
);

// The original suite (against migration 020_batch2_security_hardening.sql)
// also asserted on lookup_invite_by_code (dropped, superseded by
// join_household_via_invite) and merge_household (dropped, part of the old
// sync protocol). Those invariants no longer apply and were deleted along
// with the migration file that carried them; the pgTAP suite at
// supabase/tests/ covers the surviving behavior against the real database.

describe('notify_send_log rate-limiting infrastructure (baseline)', () => {
  it('SEC-RT-007: notify_send_log table exists with rate-limiting index, RLS, and reservation function', () => {
    expect(sql).toContain('CREATE TABLE public.notify_send_log');
    expect(sql).toContain('idx_notify_send_log_sender_sent');
    expect(sql).toMatch(/ALTER TABLE public\.notify_send_log ENABLE ROW LEVEL SECURITY/);
    expect(sql).toContain('check_and_reserve_notify_send');
  });
});

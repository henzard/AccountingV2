import fs from 'fs';
import path from 'path';
import { sliceMigrationSection } from '../../__test-utils__/migrationSlice';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/020_batch2_security_hardening.sql'),
  'utf8',
);

describe('020 batch2 security migration', () => {
  it('SEC-RT-006: lookup_invite_by_code filters used and expired invites', () => {
    const fn = sliceMigrationSection(
      sql,
      'CREATE OR REPLACE FUNCTION public.lookup_invite_by_code',
      'GRANT EXECUTE ON FUNCTION public.lookup_invite_by_code',
    );
    expect(fn).toContain('UPPER(TRIM(invite_code))');
    expect(fn).toContain('used_by IS NULL');
    expect(fn).toContain('expires_at::timestamptz > NOW()');
  });

  it('SEC-RT-008: merge_household does not update user_level on conflict', () => {
    const fn = sliceMigrationSection(
      sql,
      'CREATE OR REPLACE FUNCTION public.merge_household(r public.households)',
      'GRANT EXECUTE ON FUNCTION public.merge_household',
    );
    expect(fn).toContain('user_level');
    expect(fn).not.toMatch(/ON CONFLICT[\s\S]*user_level\s*=/);
  });

  it('SEC-RT-007: notify_send_log table for rate limiting', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.notify_send_log');
    expect(sql).toContain('idx_notify_send_log_sender_sent');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.notify_send_log FROM authenticated, anon');
    expect(sql).toContain('check_and_reserve_notify_send');
  });
});

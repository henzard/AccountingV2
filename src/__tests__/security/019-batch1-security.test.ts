import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/019_batch1_security_hardening.sql',
);

describe('019 batch1 security migration', () => {
  let sql: string;

  beforeAll(() => {
    sql = fs.readFileSync(migrationPath, 'utf8');
  });

  it('SEC-RT-001/002: defines join_household_via_invite and revokes household_members insert', () => {
    expect(sql).toMatch(/join_household_via_invite/i);
    expect(sql).toMatch(/REVOKE INSERT ON public\.household_members/i);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.user_households/i);
  });

  it('SEC-RT-004: restores completed slip overwrite guard', () => {
    expect(sql).toMatch(/slip_queue\.status\s*!=\s*'completed'/i);
  });

  it('SEC-RT-005: inv_insert requires household owner membership', () => {
    expect(sql).toMatch(/CREATE POLICY inv_insert/i);
    expect(sql).toMatch(/hm\.role\s*=\s*'owner'/i);
  });

  it('SEC-RT-003: revokes DML on sync tables and adds delete_sync_row', () => {
    expect(sql).toMatch(/delete_sync_row/i);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.envelopes/i);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.transactions/i);
  });

  it('merge_household_member blocks joining existing household via sync', () => {
    expect(sql).toMatch(/join_household_via_invite to join an existing household/i);
  });
});

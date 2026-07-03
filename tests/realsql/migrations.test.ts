import { openMigratedDb, applyMigrationsAfter } from './harness/openMigratedDb';

describe('local migration chain (real SQLite)', () => {
  it('applies every migration in journal order to an empty database', () => {
    const db = openMigratedDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const expected of [
      'households',
      'household_members',
      'envelopes',
      'transactions',
      'baby_steps',
      'pending_sync',
      'audit_events',
      'slip_queue',
    ]) {
      expect(tables).toContain(expected);
    }
    db.close();
  });

  it('applies the chain to a database with seeded rows at 0006', () => {
    const db = openMigratedDb('0006_round_betty_brant');
    db.prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES ('hh-1', 'Test Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at)
       VALUES ('hm-1', 'hh-1', 'user-1', 'owner', '2026-01-01T00:00:00.000Z')`,
    ).run();
    // Apply the remaining migrations (0007+) on top of the seeded DB.
    expect(() => applyMigrationsAfter(db, '0006_round_betty_brant')).not.toThrow();
    const cols = (
      db.prepare('PRAGMA table_info(household_members)').all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain('updated_at'); // 0007 applied
    db.close();
  });
});

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { DrizzleUserConsentRepository } from '../../src/data/repositories/DrizzleUserConsentRepository';

interface UserConsentRow {
  user_id: string;
  slip_scan_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface OplogRow {
  op_id: string;
  household_id: string | null;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string;
}

describe('DrizzleUserConsentRepository (real SQLite)', () => {
  it('first call: upserts a new row and appends exactly one INSERT oplog op with household_id null', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw);
    const repo = new DrizzleUserConsentRepository(db as any);

    await repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z');

    const row = raw
      .prepare('SELECT * FROM user_consent WHERE user_id = ?')
      .get('user-1') as UserConsentRow;
    expect(row.slip_scan_consent_at).toBe('2026-04-13T00:00:00.000Z');

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('user-1') as OplogRow[];
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe('insert');
    expect(ops[0].table_name).toBe('user_consent');
    expect(ops[0].household_id).toBeNull();
    expect(JSON.parse(ops[0].payload)).toEqual(
      expect.objectContaining({
        user_id: 'user-1',
        slip_scan_consent_at: '2026-04-13T00:00:00.000Z',
      }),
    );

    raw.close();
  });

  it('second call: updates the existing row and appends exactly one UPDATE oplog op', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw);
    const repo = new DrizzleUserConsentRepository(db as any);

    await repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z');
    await repo.setSlipScanConsent('user-1', '2026-05-01T00:00:00.000Z');

    const row = raw
      .prepare('SELECT * FROM user_consent WHERE user_id = ?')
      .get('user-1') as UserConsentRow;
    expect(row.slip_scan_consent_at).toBe('2026-05-01T00:00:00.000Z');

    // Only ONE user_consent row ever exists (upsert, not a duplicate insert).
    const rowCount = (raw.prepare('SELECT COUNT(*) AS n FROM user_consent').get() as { n: number })
      .n;
    expect(rowCount).toBe(1);

    const ops = raw
      .prepare('SELECT * FROM oplog WHERE row_id = ? ORDER BY rowid')
      .all('user-1') as OplogRow[];
    expect(ops).toHaveLength(2); // insert (first call) + update (second call)
    expect(ops[0].op_type).toBe('insert');
    expect(ops[1].op_type).toBe('update');
    expect(JSON.parse(ops[1].payload)).toEqual(
      expect.objectContaining({ slip_scan_consent_at: '2026-05-01T00:00:00.000Z' }),
    );

    raw.close();
  });
});

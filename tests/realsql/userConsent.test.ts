import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { DrizzleUserConsentRepository } from '../../src/data/repositories/DrizzleUserConsentRepository';

interface UserConsentRow {
  user_id: string;
  slip_scan_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

const mockUpsert = jest.fn();
const mockEq = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEq }));

// `user_consent` writes go through the module-level `supabase` singleton
// (same pattern as userPreferences.ts), so it must be mocked here — the
// real client throws at import time when Expo config env vars aren't
// present, which is always true in this node-environment test tier.
jest.mock('../../src/data/remote/supabaseClient', () => ({
  supabase: {
    from: () => ({ upsert: mockUpsert, update: mockUpdate }),
  },
}));

describe('DrizzleUserConsentRepository (real SQLite)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
    mockEq.mockResolvedValue({ error: null });
  });

  it('first call: upserts a new local row, appends NO oplog row, and upserts remote with created_at', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw);
    const repo = new DrizzleUserConsentRepository(db as any);

    await repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z');

    const row = raw
      .prepare('SELECT * FROM user_consent WHERE user_id = ?')
      .get('user-1') as UserConsentRow;
    expect(row.slip_scan_consent_at).toBe('2026-04-13T00:00:00.000Z');

    // `user_consent` is a per-user table — spec §8 keeps it OUTSIDE the
    // household-scoped oplog entirely (the server's apply_one_op table
    // allowlist doesn't include it, so an oplog row here would be
    // permanently rejected once a pusher exists). It must never produce
    // an oplog row; it writes locally plus direct-upserts to Supabase.
    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('user-1');
    expect(ops).toHaveLength(0);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        slip_scan_consent_at: '2026-04-13T00:00:00.000Z',
        created_at: expect.any(String),
        updated_at: expect.any(String),
      },
      { onConflict: 'user_id' },
    );

    raw.close();
  });

  it('second call: updates the existing local row (still one row, still no oplog); remote upsert omits created_at', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw);
    const repo = new DrizzleUserConsentRepository(db as any);

    await repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z');
    mockUpsert.mockClear();
    await repo.setSlipScanConsent('user-1', '2026-05-01T00:00:00.000Z');

    const row = raw
      .prepare('SELECT * FROM user_consent WHERE user_id = ?')
      .get('user-1') as UserConsentRow;
    expect(row.slip_scan_consent_at).toBe('2026-05-01T00:00:00.000Z');

    // Only ONE user_consent row ever exists (upsert, not a duplicate insert).
    const rowCount = (raw.prepare('SELECT COUNT(*) AS n FROM user_consent').get() as { n: number })
      .n;
    expect(rowCount).toBe(1);

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('user-1');
    expect(ops).toHaveLength(0);

    // Remote payload omits `created_at` on the update path so a repeat
    // upsert can't clobber the row's original creation time server-side.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        slip_scan_consent_at: '2026-05-01T00:00:00.000Z',
        updated_at: expect.any(String),
      },
      { onConflict: 'user_id' },
    );

    raw.close();
  });

  it('remote upsert failure does not block or throw from the local write (best-effort, matches userPreferences.ts)', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'offline' } });
    const raw = openMigratedDb();
    const db = drizzle(raw);
    const repo = new DrizzleUserConsentRepository(db as any);

    await expect(
      repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z'),
    ).resolves.toBeUndefined();

    const row = raw
      .prepare('SELECT * FROM user_consent WHERE user_id = ?')
      .get('user-1') as UserConsentRow;
    expect(row.slip_scan_consent_at).toBe('2026-04-13T00:00:00.000Z');

    raw.close();
  });

  describe('clearSlipScanConsent (SET-1 revoke)', () => {
    it('clears an existing consent row back to null locally and remotely, appending no oplog row', async () => {
      const raw = openMigratedDb();
      const db = drizzle(raw);
      const repo = new DrizzleUserConsentRepository(db as any);

      await repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z');
      const rowBeforeRevoke = raw
        .prepare('SELECT * FROM user_consent WHERE user_id = ?')
        .get('user-1') as UserConsentRow;
      mockUpsert.mockClear();
      mockUpdate.mockClear();
      mockEq.mockClear();

      await repo.clearSlipScanConsent('user-1');

      const row = raw
        .prepare('SELECT * FROM user_consent WHERE user_id = ?')
        .get('user-1') as UserConsentRow;
      // This is the column's pre-existing "not consented" state (see
      // userConsent.ts: `null = not consented`) — the same state the local
      // hasConsented check and the extract-slip edge function's consent gate
      // already treat as no consent. Row is not deleted; created_at/user_id
      // are untouched.
      expect(row.slip_scan_consent_at).toBeNull();
      expect(row.user_id).toBe('user-1');
      expect(row.created_at).toBe(rowBeforeRevoke.created_at);

      const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('user-1');
      expect(ops).toHaveLength(0);

      expect(mockUpdate).toHaveBeenCalledWith({
        slip_scan_consent_at: null,
        updated_at: expect.any(String),
      });
      expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');

      raw.close();
    });

    it('a failed server update fails the revoke and leaves the LOCAL consent untouched', async () => {
      const raw = openMigratedDb();
      const db = drizzle(raw);
      const repo = new DrizzleUserConsentRepository(db as any);

      await repo.setSlipScanConsent('user-1', '2026-04-13T00:00:00.000Z');
      mockEq.mockResolvedValueOnce({ error: { message: 'offline' } });

      // The server row is what the extract-slip gate and a later restore read:
      // a withdrawal it never received must not be reported as done.
      await expect(repo.clearSlipScanConsent('user-1')).rejects.toThrow(/withdraw consent/i);

      const row = raw
        .prepare('SELECT * FROM user_consent WHERE user_id = ?')
        .get('user-1') as UserConsentRow;
      expect(row.slip_scan_consent_at).toBe('2026-04-13T00:00:00.000Z');

      raw.close();
    });
  });
});

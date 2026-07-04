// setSlipScanConsent now writes via a raw SQL local upsert plus a direct
// `supabase.from('user_consent').upsert(...)` call (per-user table, kept
// OUTSIDE the household-scoped oplog — see DrizzleUserConsentRepository.ts)
// rather than a mockable Drizzle .insert().values().onConflictDoUpdate()
// chain, so its write-path behavior is proven against real SQLite (plus a
// mocked supabase client) in tests/realsql/userConsent.test.ts instead.
// This file keeps the read-path (`get`) coverage, which is unaffected.
//
// The module-level `supabase` singleton import must be mocked here too —
// the real client throws at import time without Expo config env vars.
jest.mock('../../remote/supabaseClient', () => ({
  supabase: { from: () => ({ upsert: jest.fn().mockResolvedValue({ error: null }) }) },
}));

import { DrizzleUserConsentRepository } from '../DrizzleUserConsentRepository';

describe('DrizzleUserConsentRepository', () => {
  it('returns null when no consent row exists', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: jest.fn().mockResolvedValue([]) }) }),
      }),
    } as any;
    const repo = new DrizzleUserConsentRepository(db);
    expect(await repo.get('u1')).toBeNull();
  });

  it('returns the row when consent exists', async () => {
    const row = {
      userId: 'u1',
      slipScanConsentAt: '2026-04-13T00:00:00.000Z',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    };
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: jest.fn().mockResolvedValue([row]) }) }),
      }),
    } as any;
    const repo = new DrizzleUserConsentRepository(db);
    expect(await repo.get('u1')).toEqual(row);
  });
});

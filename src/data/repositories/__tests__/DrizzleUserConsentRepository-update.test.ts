// The setSlipScanConsent write-path behavior formerly tested here now
// depends on a real local SQLite upsert plus a direct
// `supabase.from('user_consent').upsert(...)` call — see
// DrizzleUserConsentRepository.ts's doc comment. `user_consent` is a
// per-user table kept OUTSIDE the household-scoped oplog (spec §8), so it
// must never append an oplog row. That behavior is proven against real
// SQLite (plus a mocked supabase client) in tests/realsql/userConsent.test.ts.
//
// The module-level `supabase` singleton import must be mocked here too —
// the real client throws at import time without Expo config env vars.
jest.mock('../../remote/supabaseClient', () => ({
  supabase: { from: () => ({ upsert: jest.fn().mockResolvedValue({ error: null }) }) },
}));

import { DrizzleUserConsentRepository } from '../DrizzleUserConsentRepository';

describe('DrizzleUserConsentRepository — get', () => {
  it('returns row when found', async () => {
    const row = {
      userId: 'u1',
      slipScanConsentAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([row]),
    };
    const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

    const repo = new DrizzleUserConsentRepository(db);
    const result = await repo.get('u1');

    expect(result).toEqual(row);
  });

  it('returns null when not found', async () => {
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
    const db = { select: jest.fn().mockReturnValue(selectChain) } as any;

    const repo = new DrizzleUserConsentRepository(db);
    const result = await repo.get('missing');

    expect(result).toBeNull();
  });
});

// Mock PendingSyncEnqueuerAdapter before importing the repo, to avoid pulling
// in PendingSyncEnqueuer → expo-crypto (out-of-scope in Jest test environment).
jest.mock('../PendingSyncEnqueuerAdapter', () => ({
  PendingSyncEnqueuerAdapter: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { DrizzleUserConsentRepository } from '../DrizzleUserConsentRepository';

// Provide a no-op enqueuer to bypass the default adapter when needed.
const noopEnqueuer = { enqueue: jest.fn().mockResolvedValue(undefined) };

describe('DrizzleUserConsentRepository', () => {
  it('returns null when no consent row exists', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: jest.fn().mockResolvedValue([]) }) }),
      }),
    } as any;
    const repo = new DrizzleUserConsentRepository(db, noopEnqueuer);
    expect(await repo.get('u1')).toBeNull();
  });

  it('upserts consent timestamp', async () => {
    const insertValuesChain = { onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) };
    const insertChain = { values: jest.fn().mockReturnValue(insertValuesChain) };
    const db = {
      insert: jest.fn().mockReturnValue(insertChain),
      // get() is called before insert to determine INSERT vs UPDATE operation
      select: () => ({
        from: () => ({ where: () => ({ limit: jest.fn().mockResolvedValue([]) }) }),
      }),
    } as any;
    const repo = new DrizzleUserConsentRepository(db, noopEnqueuer);
    await repo.setSlipScanConsent('u1', '2026-04-13');
    expect(insertChain.values).toHaveBeenCalled();
    expect(noopEnqueuer.enqueue).toHaveBeenCalledWith('user_consent', 'u1', 'INSERT');
  });
});

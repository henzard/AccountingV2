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

  it('upserts consent timestamp', async () => {
    const insertValuesChain = { onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) };
    const insertChain = { values: jest.fn().mockReturnValue(insertValuesChain) };
    const db = { insert: jest.fn().mockReturnValue(insertChain) } as any;
    const repo = new DrizzleUserConsentRepository(db);
    await repo.setSlipScanConsent('u1', '2026-04-13');
    expect(insertChain.values).toHaveBeenCalled();
  });
});

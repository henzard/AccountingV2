// setSlipScanConsent now writes via runInUnitOfWork (raw SQL upsert + one
// oplog op, household_id: null — see DrizzleUserConsentRepository.ts) rather
// than a mockable Drizzle .insert().values().onConflictDoUpdate() chain, so
// its write-path behavior (upsert correctness, exactly-one-oplog-op,
// insert-vs-update op type) is proven against real SQLite in
// tests/realsql/userConsent.test.ts instead. This file keeps the read-path
// (`get`) coverage, which is unaffected by that migration.
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

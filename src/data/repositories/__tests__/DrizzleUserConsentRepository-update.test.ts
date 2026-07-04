// The setSlipScanConsent INSERT-vs-UPDATE op-type behavior formerly tested
// here now depends on a real runInUnitOfWork/db.transaction write (raw SQL
// upsert + oplog append) — see DrizzleUserConsentRepository.ts's doc
// comment. That behavior is proven against real SQLite in
// tests/realsql/userConsent.test.ts (both the insert-path and update-path
// op-type cases, plus the exactly-one-oplog-op assertion).
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

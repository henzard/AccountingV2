jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { CreateHouseholdUseCase } from './CreateHouseholdUseCase';

describe('CreateHouseholdUseCase', () => {
  // Captures every raw SQL run inside the unit-of-work transaction so the test
  // can assert the household + owner-membership rows (and their oplog ops) all
  // land in ONE transaction.
  let txRun: jest.Mock;
  const makeDb = () => {
    // households insert AND the owner household_members insert are now both
    // raw runInUnitOfWork writes sharing ONE db.transaction() (atomicity fix);
    // only baby_steps seeding goes through the synced-repo fake injected via
    // deps.repo. This db needs the read side (SeedBabyStepsUseCase's existence
    // check) plus `.transaction`.
    txRun = jest.fn(() => ({ changes: 1 }));
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      }),
      transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ run: txRun })),
    };
  };
  const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });
  const makeFakeRepo = () => ({
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  });

  it('returns INVALID_NAME when name is blank', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, {
      userId: 'u1',
      name: '  ',
      paydayDay: 25,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
  });

  it('returns INVALID_PAYDAY when paydayDay is out of range', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, {
      userId: 'u1',
      name: 'Home',
      paydayDay: 0,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('inserts household + membership rows + seeds baby steps on success', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new CreateHouseholdUseCase(
      db as any,
      makeAudit() as any,
      { userId: 'u1', name: 'Home', paydayDay: 25 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);

    // household + owner-membership now commit in ONE db.transaction() call
    // (atomicity fix): no separate membership transaction can be interrupted.
    expect(db.transaction).toHaveBeenCalledTimes(1);

    // Inside that one transaction: households INSERT + its oplog op, then the
    // owner household_members INSERT + its oplog op = 4 raw `run` calls, all
    // sharing the single transaction.
    expect(txRun).toHaveBeenCalledTimes(4);

    // Only the 7 baby_steps inserts now go through the injected synced-repo
    // fake; the owner membership no longer does (it shares the UoW above).
    expect(repo.insert).toHaveBeenCalledTimes(7);
    const babyStepRows = repo.insert.mock.calls.filter((call) => 'step_number' in call[0]);
    expect(babyStepRows).toHaveLength(7);
  });
});

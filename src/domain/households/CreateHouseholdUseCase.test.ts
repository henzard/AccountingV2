jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { CreateHouseholdUseCase } from './CreateHouseholdUseCase';

describe('CreateHouseholdUseCase', () => {
  const makeDb = () => {
    // households insert is a raw runInUnitOfWork write (no household_id
    // column on `households` itself) — needs db.transaction(); baby_steps
    // seeding + household_members insert go through the synced-repo fake
    // injected via deps.repo below, so this db only needs the read side
    // (SeedBabyStepsUseCase's existence check) plus `.transaction`.
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      }),
      transaction: jest.fn((fn: (tx: unknown) => unknown) =>
        fn({ run: jest.fn(() => ({ changes: 1 })) }),
      ),
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

    // households insert: 1 raw db.transaction() call.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // household_members insert + 7 baby_steps inserts, all via the synced repo fake.
    expect(repo.insert).toHaveBeenCalledTimes(8);

    const memberRow = repo.insert.mock.calls.find((call) => call[0].role === 'owner')?.[0];
    expect(memberRow).toBeTruthy();
    expect(memberRow.user_id).toBe('u1');

    const babyStepRows = repo.insert.mock.calls.filter((call) => 'step_number' in call[0]);
    expect(babyStepRows).toHaveLength(7);
  });
});

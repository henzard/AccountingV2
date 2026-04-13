jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) }));

import { CreateHouseholdUseCase } from './CreateHouseholdUseCase';

describe('CreateHouseholdUseCase', () => {
  const makeDb = () => {
    const inserted: unknown[] = [];
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      }),
      insert: jest.fn().mockReturnValue({
        values: (row: unknown) => {
          inserted.push(row);
          return {
            onConflictDoNothing: () => Promise.resolve(undefined),
            then: (resolve: (v: undefined) => void) => { resolve(undefined); return Promise.resolve(undefined); },
          };
        },
      }),
      _inserted: inserted,
    };
  };
  const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

  it('returns INVALID_NAME when name is blank', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, { userId: 'u1', name: '  ', paydayDay: 25 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_NAME');
  });

  it('returns INVALID_PAYDAY when paydayDay is out of range', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, { userId: 'u1', name: 'Home', paydayDay: 0 });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('inserts household + membership rows on success', async () => {
    const db = makeDb();
    const uc = new CreateHouseholdUseCase(db as any, makeAudit() as any, { userId: 'u1', name: 'Home', paydayDay: 25 });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    // 11 inserts: household, household_members, pending_sync x2, + 7 baby step seed rows
    expect(db._inserted.length).toBe(11);
    const hh = db._inserted[0] as any;
    expect(hh.name).toBe('Home');
    expect(hh.paydayDay).toBe(25);
    expect(typeof hh.id).toBe('string');
  });
});

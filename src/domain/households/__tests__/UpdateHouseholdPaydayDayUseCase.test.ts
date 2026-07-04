import { UpdateHouseholdPaydayDayUseCase } from '../UpdateHouseholdPaydayDayUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeDb() {
  const runCalls: unknown[] = [];
  const tx = { run: jest.fn((query: unknown) => (runCalls.push(query), { changes: 1 })) };
  return {
    transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    _runCalls: runCalls,
  };
}

describe('UpdateHouseholdPaydayDayUseCase', () => {
  const HOUSEHOLD_ID = 'h-test-123';

  it('returns failure when paydayDay < 1', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 0);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_PAYDAY');
      expect(result.error.message).toContain('between 1 and 28');
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns failure when paydayDay > 28', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 29);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns failure when paydayDay is 31', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 31);
    const result = await uc.execute();

    expect(result.success).toBe(false);
  });

  it('returns failure when paydayDay is negative', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, -5);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('returns success with correct DB write for valid paydayDay=1', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 1);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns success for valid paydayDay=28 (upper boundary)', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 28);
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });

  it('returns success for valid paydayDay=15 (mid-range)', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 15);
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });

  it('writes exactly one oplog op via db.transaction (not pending_sync)', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 10);
    await uc.execute();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    // 1 raw UPDATE + 1 oplog INSERT = 2 tx.run() calls
    expect(db._runCalls).toHaveLength(2);
  });

  it('does not write when validation fails', async () => {
    const db = makeDb();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 0);
    await uc.execute();

    expect(db.transaction).not.toHaveBeenCalled();
  });
});

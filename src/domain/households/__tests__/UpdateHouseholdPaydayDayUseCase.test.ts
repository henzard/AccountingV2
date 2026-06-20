import { UpdateHouseholdPaydayDayUseCase } from '../UpdateHouseholdPaydayDayUseCase';
import type { ISyncEnqueuer } from '../../ports/ISyncEnqueuer';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeDb() {
  const whereFn = jest.fn().mockResolvedValue(undefined);
  const setFn = jest.fn().mockReturnValue({ where: whereFn });
  const updateFn = jest.fn().mockReturnValue({ set: setFn });
  return {
    update: updateFn,
    insert: jest.fn(),
    select: jest.fn(),
    delete: jest.fn(),
    _setFn: setFn,
    _whereFn: whereFn,
  };
}

function makeEnqueuer(): ISyncEnqueuer & { enqueue: jest.Mock } {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
}

describe('UpdateHouseholdPaydayDayUseCase', () => {
  const HOUSEHOLD_ID = 'h-test-123';

  it('returns failure when paydayDay < 1', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 0, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_PAYDAY');
      expect(result.error.message).toContain('between 1 and 28');
    }
    expect(db.update).not.toHaveBeenCalled();
    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });

  it('returns failure when paydayDay > 28', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 29, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns failure when paydayDay is 31', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 31, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(false);
  });

  it('returns failure when paydayDay is negative', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, -5, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_PAYDAY');
  });

  it('returns success with correct DB update for valid paydayDay=1', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 1, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        paydayDay: 1,
        isSynced: false,
        updatedAt: expect.any(String),
      }),
    );
  });

  it('returns success for valid paydayDay=28 (upper boundary)', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 28, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    expect(db._setFn).toHaveBeenCalledWith(expect.objectContaining({ paydayDay: 28 }));
  });

  it('returns success for valid paydayDay=15 (mid-range)', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 15, enqueuer);
    const result = await uc.execute();

    expect(result.success).toBe(true);
  });

  it('enqueues sync with correct table, id, and action', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 10, enqueuer);
    await uc.execute();

    expect(enqueuer.enqueue).toHaveBeenCalledTimes(1);
    expect(enqueuer.enqueue).toHaveBeenCalledWith('households', HOUSEHOLD_ID, 'UPDATE');
  });

  it('sets isSynced=false to flag row for sync', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 20, enqueuer);
    await uc.execute();

    expect(db._setFn).toHaveBeenCalledWith(expect.objectContaining({ isSynced: false }));
  });

  it('sets updatedAt to current time', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 20, enqueuer);
    await uc.execute();

    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: '2026-06-18T12:00:00.000Z' }),
    );
  });

  it('does not enqueue when validation fails', async () => {
    const db = makeDb();
    const enqueuer = makeEnqueuer();
    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, HOUSEHOLD_ID, 0, enqueuer);
    await uc.execute();

    expect(enqueuer.enqueue).not.toHaveBeenCalled();
  });
});

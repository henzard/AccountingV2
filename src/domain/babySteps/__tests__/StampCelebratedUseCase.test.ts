import { StampCelebratedUseCase } from '../StampCelebratedUseCase';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeDb(existingRow: Record<string, unknown> | null = null) {
  const whereFnSelect = jest.fn().mockResolvedValue(existingRow ? [existingRow] : []);
  const fromFnSelect = jest.fn().mockReturnValue({ where: whereFnSelect });
  const selectFn = jest.fn().mockReturnValue({ from: fromFnSelect });

  const whereFnUpdate = jest.fn().mockResolvedValue(undefined);
  const setFn = jest.fn().mockReturnValue({ where: whereFnUpdate });
  const updateFn = jest.fn().mockReturnValue({ set: setFn });

  return {
    select: selectFn,
    update: updateFn,
    _setFn: setFn,
    _updateFn: updateFn,
    _whereFnUpdate: whereFnUpdate,
  };
}

describe('StampCelebratedUseCase', () => {
  const HOUSEHOLD_ID = 'h1';
  const STEP_NUMBER = 1;

  it('stamps celebrated_at when not yet set', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: null });
    const uc = new StampCelebratedUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(result.success).toBe(true);
    expect(db._updateFn).toHaveBeenCalledTimes(1);
    expect(db._setFn).toHaveBeenCalledWith(
      expect.objectContaining({
        celebratedAt: '2026-04-12T10:00:00.000Z',
        isSynced: false,
      }),
    );
  });

  it('idempotent: no-op if already stamped', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: '2026-04-11T00:00:00.000Z' });
    const uc = new StampCelebratedUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(result.success).toBe(true);
    expect(db._updateFn).not.toHaveBeenCalled();
  });

  it('returns STEP_NOT_FOUND when row does not exist', async () => {
    const db = makeDb(null);
    const uc = new StampCelebratedUseCase(db as any);
    const result = await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('STEP_NOT_FOUND');
    }
    expect(db._updateFn).not.toHaveBeenCalled();
  });

  it('writes isSynced=false on stamp', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: null });
    const uc = new StampCelebratedUseCase(db as any);
    await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(db._setFn).toHaveBeenCalledWith(expect.objectContaining({ isSynced: false }));
  });
});

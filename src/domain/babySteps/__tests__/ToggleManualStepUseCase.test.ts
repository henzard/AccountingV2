import { ToggleManualStepUseCase } from '../ToggleManualStepUseCase';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeDb() {
  const whereFn = jest.fn().mockResolvedValue(undefined);
  const setFn = jest.fn().mockReturnValue({ where: whereFn });
  const updateFn = jest.fn().mockReturnValue({ set: setFn });
  return { update: updateFn, _set: setFn, _where: whereFn };
}

describe('ToggleManualStepUseCase', () => {
  const HOUSEHOLD_ID = 'h1';

  describe('rejection of non-manual steps', () => {
    it.each([1, 2, 3, 6])('rejects step %i with INVALID_STEP_NUMBER', async (stepNumber) => {
      const db = makeDb();
      const uc = new ToggleManualStepUseCase(db as any);
      const result = await uc.execute(HOUSEHOLD_ID, stepNumber, true);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STEP_NUMBER');
      }
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('manual step toggle', () => {
    it.each([4, 5, 7])('accepts step %i and writes isSynced=false', async (stepNumber) => {
      const db = makeDb();
      const uc = new ToggleManualStepUseCase(db as any);
      const result = await uc.execute(HOUSEHOLD_ID, stepNumber, true);
      expect(result.success).toBe(true);
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db._set).toHaveBeenCalledWith(
        expect.objectContaining({ isCompleted: true, isSynced: false }),
      );
    });

    it('marks completed_at=now when toggled on', async () => {
      const db = makeDb();
      const uc = new ToggleManualStepUseCase(db as any);
      await uc.execute(HOUSEHOLD_ID, 4, true);
      expect(db._set).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: '2026-04-12T10:00:00.000Z' }),
      );
    });

    it('clears completed_at when toggled off', async () => {
      const db = makeDb();
      const uc = new ToggleManualStepUseCase(db as any);
      await uc.execute(HOUSEHOLD_ID, 4, false);
      expect(db._set).toHaveBeenCalledWith(
        expect.objectContaining({ isCompleted: false, completedAt: null }),
      );
    });
  });
});

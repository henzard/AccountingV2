import { ToggleManualStepUseCase } from '../ToggleManualStepUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-04-12T10:00:00.000Z'));
});

afterAll(() => {
  jest.useRealTimers();
});

function makeDb(existingRow: Record<string, unknown> | null = { id: 'bs-1' }) {
  const whereFn = jest.fn().mockResolvedValue(existingRow ? [existingRow] : []);
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

function makeFakeRepo(): SyncedRepo & {
  insert: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  increment: jest.Mock;
} {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

describe('ToggleManualStepUseCase', () => {
  const HOUSEHOLD_ID = 'h1';

  describe('rejection of non-manual steps', () => {
    it.each([1, 2, 3, 6])('rejects step %i with INVALID_STEP_NUMBER', async (stepNumber) => {
      const db = makeDb();
      const repo = makeFakeRepo();
      const uc = new ToggleManualStepUseCase(db as any, { repo });
      const result = await uc.execute(HOUSEHOLD_ID, stepNumber, true);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STEP_NUMBER');
      }
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('manual step toggle', () => {
    it.each([4, 5, 7])(
      'accepts step %i and marks it completed via the synced repo',
      async (stepNumber) => {
        const db = makeDb();
        const repo = makeFakeRepo();
        const uc = new ToggleManualStepUseCase(db as any, { repo });
        const result = await uc.execute(HOUSEHOLD_ID, stepNumber, true);
        expect(result.success).toBe(true);
        expect(repo.update).toHaveBeenCalledTimes(1);
        expect(repo.update).toHaveBeenCalledWith(
          'bs-1',
          HOUSEHOLD_ID,
          expect.objectContaining({ is_completed: 1 }),
          expect.anything(),
        );
      },
    );

    it('marks completed_at=now when toggled on', async () => {
      const db = makeDb();
      const repo = makeFakeRepo();
      const uc = new ToggleManualStepUseCase(db as any, { repo });
      await uc.execute(HOUSEHOLD_ID, 4, true);
      expect(repo.update).toHaveBeenCalledWith(
        'bs-1',
        HOUSEHOLD_ID,
        expect.objectContaining({ completed_at: '2026-04-12T10:00:00.000Z' }),
        expect.anything(),
      );
    });

    it('clears completed_at when toggled off', async () => {
      const db = makeDb();
      const repo = makeFakeRepo();
      const uc = new ToggleManualStepUseCase(db as any, { repo });
      await uc.execute(HOUSEHOLD_ID, 4, false);
      expect(repo.update).toHaveBeenCalledWith(
        'bs-1',
        HOUSEHOLD_ID,
        expect.objectContaining({ is_completed: 0, completed_at: null }),
        expect.anything(),
      );
    });

    it('returns STEP_NOT_FOUND when the row does not exist', async () => {
      const db = makeDb(null);
      const repo = makeFakeRepo();
      const uc = new ToggleManualStepUseCase(db as any, { repo });
      const result = await uc.execute(HOUSEHOLD_ID, 4, true);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('STEP_NOT_FOUND');
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});

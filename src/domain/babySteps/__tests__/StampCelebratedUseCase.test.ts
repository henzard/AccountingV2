import { StampCelebratedUseCase } from '../StampCelebratedUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';

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

describe('StampCelebratedUseCase', () => {
  const HOUSEHOLD_ID = 'h1';
  const STEP_NUMBER = 1;

  it('stamps celebrated_at via the synced repo when not yet set', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: null });
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'bs-1',
      HOUSEHOLD_ID,
      expect.objectContaining({ celebrated_at: '2026-04-12T10:00:00.000Z' }),
      expect.anything(),
    );
  });

  it('idempotent: no-op if already stamped', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: '2026-04-11T00:00:00.000Z' });
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(result.success).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('returns STEP_NOT_FOUND when row does not exist', async () => {
    const db = makeDb(null);
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    const result = await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('STEP_NOT_FOUND');
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('writes updatedAt on stamp', async () => {
    const db = makeDb({ id: 'bs-1', celebratedAt: null });
    const repo = makeFakeRepo();
    const uc = new StampCelebratedUseCase(db as any, { repo });
    await uc.execute(HOUSEHOLD_ID, STEP_NUMBER);

    expect(repo.update).toHaveBeenCalledWith(
      'bs-1',
      HOUSEHOLD_ID,
      expect.objectContaining({ updated_at: expect.any(String) }),
      expect.anything(),
    );
  });
});

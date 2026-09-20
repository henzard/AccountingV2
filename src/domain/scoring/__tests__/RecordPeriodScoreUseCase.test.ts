import { RecordPeriodScoreUseCase, periodScoreId } from '../RecordPeriodScoreUseCase';
import type { HabitScoreResult } from '../RamseyScoreCalculator';

const SCORE: HabitScoreResult = {
  score: 72,
  loggingPoints: 20,
  disciplinePoints: 22,
  metersPoints: 20,
  babyStepPoints: 10,
};

describe('RecordPeriodScoreUseCase', () => {
  function makeDb(existingRows: { id: string }[] = []): {
    select: jest.Mock;
    insert: jest.Mock;
    __valuesMock: jest.Mock;
    __onConflictMock: jest.Mock;
    __limitMock: jest.Mock;
  } {
    const limitMock = jest.fn().mockResolvedValue(existingRows);
    const whereMock = jest.fn().mockReturnValue({ limit: limitMock });
    const fromMock = jest.fn().mockReturnValue({ where: whereMock });
    const select = jest.fn().mockReturnValue({ from: fromMock });

    const onConflictMock = jest.fn().mockResolvedValue(undefined);
    const valuesMock = jest.fn().mockReturnValue({ onConflictDoNothing: onConflictMock });
    const insert = jest.fn().mockReturnValue({ values: valuesMock });

    return {
      select,
      insert,
      __valuesMock: valuesMock,
      __onConflictMock: onConflictMock,
      __limitMock: limitMock,
    };
  }

  it('inserts a new score_history row for a period that has not been recorded yet', async () => {
    const db = makeDb([]);
    const useCase = new RecordPeriodScoreUseCase(db as any);

    const result = await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.created).toBe(true);
    expect(result.data.id).toBe(periodScoreId('hh-1', '2026-06-01'));

    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertedValues = db.__valuesMock.mock.calls[0][0];
    expect(insertedValues).toMatchObject({
      id: periodScoreId('hh-1', '2026-06-01'),
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      score: 72,
    });
    expect(JSON.parse(insertedValues.components)).toEqual(SCORE);
  });

  it('VAL2-10: folds a supplied debtSnapshot additively into components, alongside the score', async () => {
    const db = makeDb([]);
    const useCase = new RecordPeriodScoreUseCase(db as any);

    const result = await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
      debtSnapshot: { totalDebtCents: 500000, debtFreeDateISO: '2028-01-01T00:00:00.000Z' },
    });

    expect(result.success).toBe(true);
    const insertedValues = db.__valuesMock.mock.calls[0][0];
    const components = JSON.parse(insertedValues.components);
    expect(components).toEqual({
      ...SCORE,
      debtSnapshot: { totalDebtCents: 500000, debtFreeDateISO: '2028-01-01T00:00:00.000Z' },
    });
    // The top-level `score` column stays the plain habit score, unaffected
    // by the additive debt snapshot.
    expect(insertedValues.score).toBe(72);
  });

  it('VAL2-10: omitting debtSnapshot keeps the old components shape exactly (old readers keep working)', async () => {
    const db = makeDb([]);
    const useCase = new RecordPeriodScoreUseCase(db as any);

    await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
    });

    const insertedValues = db.__valuesMock.mock.calls[0][0];
    expect(JSON.parse(insertedValues.components)).toEqual(SCORE);
  });

  it('VAL2-10: is idempotent with a debtSnapshot too — a replay for an existing period still does not insert', async () => {
    const id = periodScoreId('hh-1', '2026-06-01');
    const db = makeDb([{ id }]);
    const useCase = new RecordPeriodScoreUseCase(db as any);

    const result = await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
      debtSnapshot: { totalDebtCents: 100, debtFreeDateISO: null },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.created).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('uses a deterministic id — same (household, periodStart) always produces the same id', () => {
    expect(periodScoreId('hh-1', '2026-06-01')).toBe(periodScoreId('hh-1', '2026-06-01'));
    expect(periodScoreId('hh-1', '2026-06-01')).not.toBe(periodScoreId('hh-1', '2026-07-01'));
    expect(periodScoreId('hh-1', '2026-06-01')).not.toBe(periodScoreId('hh-2', '2026-06-01'));
  });

  it('is idempotent: a second call for the same (household, periodStart) does not insert again', async () => {
    const id = periodScoreId('hh-1', '2026-06-01');
    const db = makeDb([{ id }]); // row already exists

    const useCase = new RecordPeriodScoreUseCase(db as any);
    const result = await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.created).toBe(false);
    expect(result.data.id).toBe(id);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns a Result failure (never throws) when the insert fails', async () => {
    const db = makeDb([]);
    db.__valuesMock.mockReturnValue({
      onConflictDoNothing: jest.fn().mockRejectedValue(new Error('disk full')),
    });

    const useCase = new RecordPeriodScoreUseCase(db as any);
    const result = await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('record_period_score_failed');
    expect(result.error.message).toContain('disk full');
  });

  it('returns a Result failure (never throws) when the existence check fails', async () => {
    const db = makeDb([]);
    db.__limitMock.mockRejectedValue(new Error('db locked'));

    const useCase = new RecordPeriodScoreUseCase(db as any);
    const result = await useCase.execute({
      householdId: 'hh-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      score: SCORE,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('record_period_score_failed');
  });
});

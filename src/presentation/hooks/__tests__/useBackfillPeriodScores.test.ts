/**
 * `useBackfillPeriodScores` — WHEN the backfill runs, and that nothing
 * inside it can break the thing that triggered it.
 *
 * The scoring itself is covered against a real database in
 * `src/domain/scoring/__tests__/BackfillPeriodScoresUseCase.test.ts`; this
 * file mocks that use case deliberately, because what is under test here is
 * the scheduling contract — runs at app start, runs again when a sync round
 * lands, never runs concurrently with itself, and swallows every failure.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';

jest.mock('../../../data/local/db', () => ({ db: {} }));

const mockExecute = jest.fn();
jest.mock('../../../domain/scoring/BackfillPeriodScoresUseCase', () => ({
  BackfillPeriodScoresUseCase: class {
    execute = (...args: unknown[]): unknown => mockExecute(...args);
  },
}));

const mockGetPeriodScoresAscending = jest.fn().mockResolvedValue([]);
jest.mock('../../../domain/scoring/getPeriodScoresAscending', () => ({
  getPeriodScoresAscending: (...args: unknown[]) => mockGetPeriodScoresAscending(...args),
}));

const mockPersistExecute = jest.fn().mockResolvedValue({
  success: true,
  data: { level: 1, changed: false },
});
jest.mock('../../../domain/scoring/PersistUserLevelUseCase', () => ({
  PersistUserLevelUseCase: class {
    execute = (...args: unknown[]): unknown => mockPersistExecute(...args);
  },
}));

const mockLoggerError = jest.fn();
jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: {
    error: (...args: unknown[]): void => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { useAppStore } from '../../stores/appStore';
import { useSyncStore } from '../../stores/syncStore';
import { useBackfillPeriodScores, runPeriodScoreBackfill } from '../useBackfillPeriodScores';

const NOTHING_TO_DO = {
  success: true as const,
  data: { scoreablePeriods: 0, recorded: 0, recordedPeriodStarts: [] },
};

describe('useBackfillPeriodScores', () => {
  beforeEach(() => {
    mockExecute.mockReset().mockResolvedValue(NOTHING_TO_DO);
    mockGetPeriodScoresAscending.mockClear();
    mockPersistExecute.mockClear();
    mockLoggerError.mockClear();
    useAppStore.setState({ householdId: 'hh-1', paydayDay: 20, userLevel: 1 });
    useSyncStore.setState({ lastSyncAt: null });
  });

  it('runs once at app start for the active household', async () => {
    renderHook(() => useBackfillPeriodScores());

    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
    expect(mockExecute).toHaveBeenCalledWith({ householdId: 'hh-1', paydayDay: 20 });
  });

  it('does not run at all without an active household', async () => {
    useAppStore.setState({ householdId: null });
    renderHook(() => useBackfillPeriodScores());

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('runs again once a sync round lands new history', async () => {
    renderHook(() => useBackfillPeriodScores());
    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));

    await act(async () => {
      useSyncStore.setState({ lastSyncAt: '2026-09-21T10:00:00.000Z' });
    });

    await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(2));
  });

  it('never runs concurrently with itself', async () => {
    let release: (() => void) | undefined;
    mockExecute.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(NOTHING_TO_DO);
        }),
    );

    const first = runPeriodScoreBackfill('hh-1', 20);
    const second = runPeriodScoreBackfill('hh-1', 20);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    await second; // the second caller returns immediately, it does not queue
    release?.();
    await first;
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('a failure inside the backfill is logged, never thrown — boot and sync survive it', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { code: 'backfill_period_scores_failed', message: 'disk is on fire' },
    });

    await expect(runPeriodScoreBackfill('hh-1', 20)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('a THROW inside the backfill is caught, never thrown — and the guard is released', async () => {
    mockExecute.mockRejectedValueOnce(new Error('boom'));

    await expect(runPeriodScoreBackfill('hh-1', 20)).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalled();

    // The in-flight guard must not be stuck after a throw.
    mockExecute.mockResolvedValue(NOTHING_TO_DO);
    await runPeriodScoreBackfill('hh-1', 20);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('does no level work at all when there was nothing to backfill', async () => {
    await runPeriodScoreBackfill('hh-1', 20);
    expect(mockGetPeriodScoresAscending).not.toHaveBeenCalled();
    expect(mockPersistExecute).not.toHaveBeenCalled();
  });

  it('persists and surfaces the level once a pass has recorded scores', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { scoreablePeriods: 3, recorded: 3, recordedPeriodStarts: ['a', 'b', 'c'] },
    });
    mockGetPeriodScoresAscending.mockResolvedValue([
      { periodStart: 'a', score: 75 },
      { periodStart: 'b', score: 80 },
      { periodStart: 'c', score: 90 },
    ]);
    mockPersistExecute.mockResolvedValue({ success: true, data: { level: 2, changed: true } });

    await runPeriodScoreBackfill('hh-1', 20);

    expect(mockPersistExecute).toHaveBeenCalledWith({ householdId: 'hh-1', level: 2 });
    expect(useAppStore.getState().userLevel).toBe(2);
  });

  it('leaves the in-memory level alone when the stored level did not change', async () => {
    useAppStore.setState({ userLevel: 3 });
    mockExecute.mockResolvedValue({
      success: true,
      data: { scoreablePeriods: 1, recorded: 1, recordedPeriodStarts: ['a'] },
    });
    mockGetPeriodScoresAscending.mockResolvedValue([{ periodStart: 'a', score: 40 }]);
    mockPersistExecute.mockResolvedValue({ success: true, data: { level: 3, changed: false } });

    await runPeriodScoreBackfill('hh-1', 20);

    expect(useAppStore.getState().userLevel).toBe(3);
  });
});

/**
 * `ScoreProgressCard` — that the score/level surface shows this household's
 * REAL recorded history (the thing that was missing), its breakdown in plain
 * language, a trend, the level with progress-to-next, and a useful empty
 * state for a genuinely new household.
 *
 * The card reads through `useScoreProgress`, which reads `score_history`;
 * that read is mocked here so each case can pin an exact history, and the
 * numbers themselves are covered against a real database in
 * `src/domain/scoring/__tests__/BackfillPeriodScoresUseCase.test.ts`.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

jest.mock('../../../../data/local/db', () => ({ db: {} }));

const mockGetPeriodScoreHistory = jest.fn();
jest.mock('../../../../domain/scoring/getPeriodScoreHistory', () => ({
  getPeriodScoreHistory: (...args: unknown[]) => mockGetPeriodScoreHistory(...args),
}));

import { useAppStore } from '../../../stores/appStore';
import { useSyncStore } from '../../../stores/syncStore';
import { ScoreProgressCard } from '../ScoreProgressCard';

function entry(periodStart: string, score: number, withBreakdown = true) {
  return {
    periodStart,
    score,
    breakdown: withBreakdown
      ? {
          score,
          loggingPoints: 10,
          disciplinePoints: 30,
          metersPoints: 0,
          babyStepPoints: 0,
          metersApplicable: true,
        }
      : null,
  };
}

/** The real household: has never logged a meter reading, so it is not counted. */
function entryWithoutMeters(periodStart: string, score: number) {
  return {
    periodStart,
    score,
    breakdown: {
      score,
      loggingPoints: 10,
      disciplinePoints: 30,
      metersPoints: null,
      babyStepPoints: 0,
      metersApplicable: false,
    },
  };
}

function renderCard(): void {
  render(
    <PaperProvider>
      <ScoreProgressCard />
    </PaperProvider>,
  );
}

describe('ScoreProgressCard', () => {
  beforeEach(() => {
    mockGetPeriodScoreHistory.mockReset().mockResolvedValue([]);
    useAppStore.setState({ householdId: 'hh-1', userLevel: 1 });
    useSyncStore.setState({ lastSyncAt: null });
  });

  it('shows the latest CLOSED period score and how many periods are scored', async () => {
    mockGetPeriodScoreHistory.mockResolvedValue([
      entry('2026-06-20', 40),
      entry('2026-07-20', 55),
      entry('2026-08-20', 62),
    ]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-latest-score')).toBeTruthy());
    expect(screen.getByTestId('score-progress-latest-score').props.accessibilityLabel).toBe(
      'Aug 2026 scored 62 out of 100.',
    );
    expect(screen.getByTestId('score-progress-period-count')).toHaveTextContent('3 periods scored');
  });

  it('explains the score in plain language, with an accessible label on every figure', async () => {
    mockGetPeriodScoreHistory.mockResolvedValue([entry('2026-08-20', 40)]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-breakdown')).toBeTruthy());
    expect(
      screen.getByTestId('score-progress-breakdown-loggingPoints').props.accessibilityLabel,
    ).toBe('Logging transactions: 10 out of 30 points.');
    expect(
      screen.getByTestId('score-progress-breakdown-disciplinePoints').props.accessibilityLabel,
    ).toBe('Staying on budget: 30 out of 30 points.');
    expect(
      screen.getByTestId('score-progress-breakdown-metersPoints').props.accessibilityLabel,
    ).toBe('Meter readings logged: 0 out of 20 points.');
  });

  it('says a never-used component was not counted, rather than reporting it as 0 of 20', async () => {
    mockGetPeriodScoreHistory.mockResolvedValue([entryWithoutMeters('2026-08-20', 50)]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-breakdown')).toBeTruthy());
    const metersRow = screen.getByTestId('score-progress-breakdown-metersPoints');
    expect(metersRow).toHaveTextContent(/not used, not counted/);
    expect(metersRow.props.accessibilityLabel).toBe(
      'Meter readings logged: not used, not counted towards this score.',
    );
    // The components that DID count still read normally.
    expect(
      screen.getByTestId('score-progress-breakdown-disciplinePoints').props.accessibilityLabel,
    ).toBe('Staying on budget: 30 out of 30 points.');
  });

  it('draws one labelled trend bar per period, capped at the last 12', async () => {
    const periods = Array.from({ length: 18 }, (_, i) => {
      const month = String((i % 12) + 1).padStart(2, '0');
      const year = 2025 + Math.floor(i / 12);
      return entry(`${year}-${month}-20`, 50 + i);
    });
    mockGetPeriodScoreHistory.mockResolvedValue(periods);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-trend')).toBeTruthy());
    const last = periods[periods.length - 1];
    expect(screen.getByTestId(`score-trend-bar-${last.periodStart}`)).toBeTruthy();
    // The 13th-from-last period is outside the window and must not be drawn.
    expect(
      screen.queryByTestId(`score-trend-bar-${periods[periods.length - 13].periodStart}`),
    ).toBeNull();
  });

  it('shows the level and exactly what the next level takes', async () => {
    useAppStore.setState({ userLevel: 1 });
    mockGetPeriodScoreHistory.mockResolvedValue([entry('2026-07-20', 75), entry('2026-08-20', 80)]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-next-level')).toBeTruthy());
    expect(screen.getByTestId('score-progress-level')).toHaveTextContent('Lv1 Learner');
    expect(screen.getByTestId('score-progress-next-level')).toHaveTextContent(
      '1 more period scoring 70+ to reach Practitioner.',
    );
  });

  it('names the Mentor climb for a Practitioner', async () => {
    useAppStore.setState({ userLevel: 2 });
    mockGetPeriodScoreHistory.mockResolvedValue([entry('2026-08-20', 90)]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-level')).toBeTruthy());
    expect(screen.getByTestId('score-progress-level')).toHaveTextContent('Lv2 Practitioner');
    expect(screen.getByTestId('score-progress-next-level')).toHaveTextContent(/to reach Mentor/);
  });

  it('shows a useful empty state for a genuinely new household — not a zero score', async () => {
    mockGetPeriodScoreHistory.mockResolvedValue([]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-empty')).toBeTruthy());
    expect(screen.queryByTestId('score-progress-latest-score')).toBeNull();
    expect(screen.queryByTestId('score-progress-trend')).toBeNull();
    expect(screen.getByTestId('score-progress-empty')).toHaveTextContent(
      /No closed budget periods yet\./,
    );
  });

  it('still shows the score when a row has no readable breakdown', async () => {
    mockGetPeriodScoreHistory.mockResolvedValue([entry('2026-08-20', 62, false)]);

    renderCard();

    await waitFor(() => expect(screen.getByTestId('score-progress-latest-score')).toBeTruthy());
    expect(screen.queryByTestId('score-progress-breakdown')).toBeNull();
  });
});

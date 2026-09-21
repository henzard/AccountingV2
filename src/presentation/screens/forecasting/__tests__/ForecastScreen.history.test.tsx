/**
 * ForecastScreen.history.test.tsx — the forecast screen once it is fed by
 * REAL history: the "no budget for this period yet" state the household is in
 * today, the plain-language insights, and the accessibility labels on the
 * figures.
 *
 * The forecaster itself is NOT mocked here: this suite drives the real
 * blending through the real screen, so a regression in either shows up.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import type { CategoryBaseline } from '../../../../domain/forecasting/CategoryBaseline';
import { baselineKey } from '../../../../domain/forecasting/CategoryBaseline';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

jest.mock('../../../../data/local/db', () => ({ db: {} }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));

jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      primary: '#000',
      background: '#fff',
      surface: '#fff',
      surfaceVariant: '#eee',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      error: '#f00',
      success: '#0a0',
      warning: '#fa0',
    },
  }),
}));

jest.mock('../../../stores/themeStore', () => ({
  useThemeStore: jest.fn((sel: (s: object) => unknown) => sel({ preference: 'light' })),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Text', { testID, ...p }, children),
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
    Button: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Button', p, children),
  };
});

// The SHARED rollover wizard, stood in for so this suite can assert that the
// screen opens THAT entry point rather than re-implementing rollover.
jest.mock('../../budgets/RolloverWizard', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    RolloverWizard: (props: {
      visible: boolean;
      fromPeriodStart: string;
      toPeriodStart: string;
    }) =>
      props.visible
        ? React.createElement('View', {
            testID: 'rollover-wizard',
            accessibilityLabel: `${props.fromPeriodStart}->${props.toPeriodStart}`,
          })
        : null,
  };
});

const mockFindLatestPeriodWithEnvelopes = jest.fn();
jest.mock('../../dashboard/findLatestPeriodWithEnvelopes', () => ({
  findLatestPeriodWithEnvelopes: (...args: unknown[]) => mockFindLatestPeriodWithEnvelopes(...args),
  hasPeriodScopedEnvelopeAfter: jest.fn().mockResolvedValue(false),
}));

const mockReload = jest.fn();
const mockUseEnvelopes = jest.fn();
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: (...args: unknown[]) => mockUseEnvelopes(...args),
}));

const mockReloadTransactions = jest.fn();
jest.mock('../../../hooks/useTransactions', () => ({
  useTransactions: () => ({
    transactions: [],
    loading: false,
    refreshing: false,
    error: null,
    reload: mockReloadTransactions,
  }),
}));

const mockReloadHistory = jest.fn();
const mockUseForecastHistory = jest.fn();
jest.mock('../useForecastHistory', () => ({
  useForecastHistory: (...args: unknown[]) => mockUseForecastHistory(...args),
}));

jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-04-30T00:00:00.000Z'),
      label: 'April 2026',
    })),
  })),
  formatPeriodDateKey: (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
}));

jest.mock('../../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

import { ForecastScreen } from '../ForecastScreen';

function baseline(overrides: Partial<CategoryBaseline> = {}): CategoryBaseline {
  return {
    categoryKey: 'food',
    displayName: 'Food',
    envelopeType: 'spending',
    periodsObserved: 6,
    typicalPeriodSpendCents: 150000,
    lowestPeriodSpendCents: 100000,
    highestPeriodSpendCents: 200000,
    typicalSpendByDayCents: 55000,
    throughDayOfPeriod: 9,
    typicalAllocatedCents: 150000,
    ...overrides,
  };
}

function baselineMap(...entries: CategoryBaseline[]): Map<string, CategoryBaseline> {
  return new Map(entries.map((b) => [baselineKey(b.envelopeType, b.displayName), b]));
}

function envelope(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'env-food',
    householdId: 'hh-1',
    name: 'Food',
    allocatedCents: 150000,
    spentCents: 75000,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function setEnvelopes(envelopes: EnvelopeEntity[]): void {
  mockUseEnvelopes.mockReturnValue({
    envelopes,
    loading: false,
    refreshing: false,
    error: null,
    reload: mockReload,
  });
}

function setBaselines(baselines: Map<string, CategoryBaseline>): void {
  mockUseForecastHistory.mockReturnValue({
    baselines,
    loading: false,
    refreshing: false,
    error: null,
    reload: mockReloadHistory,
  });
}

describe('ForecastScreen fed by history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Day 9 of the 1–30 April period.
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date(2026, 3, 9, 12, 0, 0));
    setEnvelopes([]);
    setBaselines(new Map());
    mockFindLatestPeriodWithEnvelopes.mockResolvedValue('2026-03-01');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the current period has NO budget yet, but history exists', () => {
    beforeEach(() => {
      setBaselines(
        baselineMap(
          baseline(),
          baseline({
            categoryKey: 'housing',
            displayName: 'Housing',
            typicalPeriodSpendCents: 500000,
            lowestPeriodSpendCents: 500000,
            highestPeriodSpendCents: 500000,
          }),
        ),
      );
    });

    it('does not show an empty screen', async () => {
      const { queryByTestId, findByTestId } = render(<ForecastScreen />);
      expect(queryByTestId('forecast-empty')).toBeNull();
      expect(await findByTestId('forecast-typical-period')).toBeTruthy();
    });

    it('says what a typical period looks like, biggest category first', async () => {
      const { getByTestId, getByText, findByTestId } = render(<ForecastScreen />);
      await findByTestId('forecast-start-period-cta');
      expect(getByTestId('forecast-typical-headline').props.children).toContain(
        'you typically spend R6500.00 across 2 categories',
      );
      expect(getByText('Housing')).toBeTruthy();
      expect(getByText('R1500.00')).toBeTruthy();
      expect(
        getByText('Usually R1500.00 a period, ranging R1000.00 to R2000.00, over 6 periods.'),
      ).toBeTruthy();
    });

    it('offers to start this period from the last one that had envelopes', async () => {
      const { findByTestId } = render(<ForecastScreen />);
      const cta = await findByTestId('forecast-start-period-cta');
      expect(cta.props.accessibilityLabel).toBe('Start this period from the last one');
      expect(mockFindLatestPeriodWithEnvelopes).toHaveBeenCalledWith(
        expect.anything(),
        'hh-1',
        '2026-04-01',
      );
    });

    it('opens the SHARED rollover wizard from that source period', async () => {
      const { findByTestId, queryByTestId, getByTestId } = render(<ForecastScreen />);
      expect(queryByTestId('rollover-wizard')).toBeNull();
      fireEvent.press(await findByTestId('forecast-start-period-cta'));
      expect(getByTestId('rollover-wizard').props.accessibilityLabel).toBe(
        '2026-03-01->2026-04-01',
      );
    });

    it('hides the call to action when no earlier period has envelopes to copy', async () => {
      mockFindLatestPeriodWithEnvelopes.mockResolvedValue(null);
      const { queryByTestId, findByTestId } = render(<ForecastScreen />);
      await findByTestId('forecast-typical-period');
      expect(queryByTestId('forecast-start-period-cta')).toBeNull();
    });
  });

  describe('a genuinely new household', () => {
    it('gets a helpful empty state, not a typical-period list', () => {
      const { getByTestId, queryByTestId } = render(<ForecastScreen />);
      expect(getByTestId('forecast-empty')).toBeTruthy();
      expect(queryByTestId('forecast-typical-period')).toBeNull();
    });
  });

  describe('a budgeted period, with history behind it', () => {
    beforeEach(() => {
      setEnvelopes([
        envelope({}),
        envelope({
          id: 'env-income',
          name: 'Nedbank',
          envelopeType: 'income',
          allocatedCents: 2500000,
          spentCents: 0,
        }),
      ]);
      setBaselines(baselineMap(baseline()));
    });

    it('tells the household where it stands in plain language, with the usual figure', () => {
      const { getByTestId } = render(<ForecastScreen />);
      // Day 9 of 30 → 0.7 x baseline (150000) + 0.3 x run rate (75000 spent,
      // 8333/day x 20 remaining = 166660 → 241660) = 177498, i.e. R274.98
      // over the R1500.00 allocation.
      expect(getByTestId('forecast-insight-env-food').props.children).toBe(
        'Likely over by R274.98 — you usually spend about R1500.00 on Food',
      );
    });

    it('shows pace against the usual pace by this day of the period', () => {
      const { getByTestId } = render(<ForecastScreen />);
      expect(getByTestId('forecast-pace-env-food').props.children).toBe(
        'R200.00 ahead of your usual pace by day 9',
      );
    });

    it('summarises the period against what is allocated and what income was allocated', () => {
      const { getByTestId } = render(<ForecastScreen />);
      expect(getByTestId('forecast-summary-headline').props.children).toContain(
        'R1500.00 allocated',
      );
      expect(getByTestId('forecast-summary-income').props.children).toBe(
        'R25000.00 allocated as income this period.',
      );
      expect(getByTestId('forecast-summary-at-risk').props.children).toBe(
        'Most likely to overshoot: Food (R274.98 over).',
      );
    });

    it('labels every figure for a screen reader, with no colour-only meaning', () => {
      const { getByTestId } = render(<ForecastScreen />);
      expect(getByTestId('forecast-insight-env-food').props.accessibilityLabel).toContain(
        'ahead of your usual pace by day 9',
      );
      expect(getByTestId('forecast-summary-headline').props.accessibilityLabel).toBe(
        getByTestId('forecast-summary-headline').props.children,
      );
    });

    it('never counts the INCOME envelope as spending', () => {
      const { queryByText } = render(<ForecastScreen />);
      expect(queryByText('Nedbank')).toBeNull();
    });
  });
});

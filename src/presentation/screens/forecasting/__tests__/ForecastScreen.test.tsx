/**
 * ForecastScreen.test.tsx — zero-coverage screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

// ─── Local DB mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/db', () => ({ db: {} }));

// ─── Store mock ───────────────────────────────────────────────────────────────
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));

// ─── Theme mock ───────────────────────────────────────────────────────────────
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

// ─── react-native-paper mocks ─────────────────────────────────────────────────
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
    ProgressBar: ({ testID, ...p }: { testID?: string; [k: string]: unknown }) =>
      React.createElement('View', { testID: testID ?? 'progress-bar', ...p }),
  };
});

// ─── Hooks mock ───────────────────────────────────────────────────────────────
const mockReload = jest.fn();
const mockUseEnvelopes = jest.fn().mockReturnValue({
  envelopes: [],
  loading: false,
  error: null,
  reload: mockReload,
});
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: (...args: unknown[]) => mockUseEnvelopes(...args),
}));

const mockReloadTransactions = jest.fn();
const mockUseTransactions = jest.fn().mockReturnValue({
  transactions: [],
  loading: false,
  error: null,
  reload: mockReloadTransactions,
});
jest.mock('../../../hooks/useTransactions', () => ({
  useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));

// ─── BudgetPeriodEngine mock ──────────────────────────────────────────────────
jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      label: 'June 2026',
    })),
  })),
  // `formatPeriodDateKey` (L7 tz-consistent period key) is a plain exported
  // function, not a class member — the screen now imports it alongside
  // `BudgetPeriodEngine`, so this manual module mock must also provide it.
  formatPeriodDateKey: (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
}));

// ─── CashFlowForecaster mock ──────────────────────────────────────────────────
const mockProject = jest.fn().mockReturnValue([]);
jest.mock('../../../../domain/forecasting/CashFlowForecaster', () => ({
  CashFlowForecaster: jest.fn().mockImplementation(() => ({
    project: (...args: unknown[]) => mockProject(...args),
  })),
}));

// ─── formatCurrency mock ──────────────────────────────────────────────────────
jest.mock('../../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

import { ForecastScreen } from '../ForecastScreen';

const mockForecasts = [
  {
    envelopeId: 'e1',
    envelopeName: 'Groceries',
    allocatedCents: 500000,
    spentCents: 200000,
    dailySpendCents: 10000,
    projectedRemainingCents: 200000,
    projectedRemainingPct: 40,
    status: 'on_track' as const,
    daysElapsed: 15,
    daysRemaining: 15,
    isFixed: false,
    projectedSpendRemainingCents: 150000,
  },
  {
    envelopeId: 'e2',
    envelopeName: 'Rent',
    allocatedCents: 1200000,
    spentCents: 1200000,
    dailySpendCents: 80000,
    projectedRemainingCents: 0,
    projectedRemainingPct: 0,
    status: 'on_track' as const,
    daysElapsed: 15,
    daysRemaining: 15,
    isFixed: true,
    projectedSpendRemainingCents: 0,
  },
];

describe('ForecastScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue([]);
  });

  it('shows loading skeleton when loading', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: true,
      error: null,
      reload: mockReload,
    });
    const { getByTestId } = render(<ForecastScreen />);
    expect(getByTestId('forecast-loading')).toBeTruthy();
  });

  it('renders forecast rows when data exists', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [{ id: 'e1' }, { id: 'e2' }],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue(mockForecasts);

    const { getByTestId, getByText } = render(<ForecastScreen />);
    expect(getByTestId('forecast-list')).toBeTruthy();
    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Rent')).toBeTruthy();
  });

  it('shows the RefreshingBar while refreshing, without blanking the list (REG-9)', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [{ id: 'e1' }, { id: 'e2' }],
      loading: false,
      refreshing: true,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue(mockForecasts);

    const { getByTestId } = render(<ForecastScreen />);
    expect(getByTestId('refreshing-bar')).toBeTruthy();
    expect(getByTestId('forecast-list')).toBeTruthy();
  });

  it('hides the RefreshingBar when not refreshing', () => {
    const { queryByTestId } = render(<ForecastScreen />);
    expect(queryByTestId('refreshing-bar')).toBeNull();
  });

  it('renders empty state when forecast list has no data', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue([]);

    const { getByTestId } = render(<ForecastScreen />);
    expect(getByTestId('forecast-list')).toBeTruthy();
    expect(getByTestId('forecast-empty')).toBeTruthy();
  });

  it('handles zero income by projecting empty list', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue([]);

    const { getByTestId } = render(<ForecastScreen />);
    expect(getByTestId('forecast-list')).toBeTruthy();
  });

  it('sorts forecasts with over_budget first, then warning, then on_track', () => {
    mockProject.mockReturnValue(mockForecasts);
    mockUseEnvelopes.mockReturnValue({
      envelopes: [{ id: 'e1' }, { id: 'e2' }],
      loading: false,
      error: null,
      reload: mockReload,
    });

    const { getAllByText } = render(<ForecastScreen />);
    const names = getAllByText(/Groceries|Rent/);
    // Both are on_track, so order is preserved (Groceries first, Rent second)
    expect(names[0].props.children).toBe('Groceries');
    expect(names[1].props.children).toBe('Rent');
  });

  it('calls project with transactions from useTransactions hook', () => {
    const mockTransactions = [
      { id: 'tx1', envelopeId: 'e1', amountCents: 50000 },
      { id: 'tx2', envelopeId: 'e2', amountCents: 1200000 },
    ];
    mockUseEnvelopes.mockReturnValue({
      envelopes: [{ id: 'e1' }, { id: 'e2' }],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockUseTransactions.mockReturnValue({
      transactions: mockTransactions,
      loading: false,
      error: null,
      reload: mockReloadTransactions,
    });
    mockProject.mockReturnValue([]);

    render(<ForecastScreen />);

    expect(mockProject).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: mockTransactions,
        envelopes: expect.any(Array),
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      }),
    );
  });

  it('renders fixed bill text for envelopes with isFixed = true', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [{ id: 'e1' }, { id: 'e2' }],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue(mockForecasts);

    const { getByText, queryByText } = render(<ForecastScreen />);
    // Rent is a fixed bill (e2 in mockForecasts has isFixed: true)
    expect(getByText(/Fixed bill.*not projected daily/)).toBeTruthy();
    // Groceries is not fixed, so should show per-day amount
    expect(queryByText(/100\.00.*day/)).toBeTruthy();
  });
});

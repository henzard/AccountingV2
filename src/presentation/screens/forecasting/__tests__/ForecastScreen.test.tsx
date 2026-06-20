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

// ─── BudgetPeriodEngine mock ──────────────────────────────────────────────────
jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      label: 'June 2026',
    })),
  })),
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
  },
  {
    envelopeId: 'e2',
    envelopeName: 'Transport',
    allocatedCents: 200000,
    spentCents: 250000,
    dailySpendCents: 16667,
    projectedRemainingCents: -50000,
    projectedRemainingPct: -25,
    status: 'over_budget' as const,
    daysElapsed: 15,
    daysRemaining: 15,
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
    expect(getByText('Transport')).toBeTruthy();
  });

  // TODO: GAP — No empty state component when forecast list has no data.
  // The FlatList renders with zero items, showing only the hint text with
  // "0 days of spending" — there is no EmptyState or user-friendly message.
  it('renders empty list with no empty state (missing feature)', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: null,
      reload: mockReload,
    });
    mockProject.mockReturnValue([]);

    const { getByTestId, queryByTestId } = render(<ForecastScreen />);
    expect(getByTestId('forecast-list')).toBeTruthy();
    expect(queryByTestId('forecast-empty')).toBeNull();
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

  it('sorts forecasts with over_budget first', () => {
    mockProject.mockReturnValue(mockForecasts);
    mockUseEnvelopes.mockReturnValue({
      envelopes: [{ id: 'e1' }, { id: 'e2' }],
      loading: false,
      error: null,
      reload: mockReload,
    });

    const { getAllByText } = render(<ForecastScreen />);
    const names = getAllByText(/Groceries|Transport/);
    expect(names[0].props.children).toBe('Transport');
    expect(names[1].props.children).toBe('Groceries');
  });
});

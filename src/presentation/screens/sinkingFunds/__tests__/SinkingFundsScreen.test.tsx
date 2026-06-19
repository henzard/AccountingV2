/**
 * SinkingFundsScreen.test.tsx — zero-coverage screen test
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

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
      onPrimary: '#fff',
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
    FAB: ({
      onPress,
      testID,
      ...p
    }: {
      onPress?: () => void;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Pressable', { onPress, testID: testID ?? 'fab', ...p }),
  };
});

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

// ─── SinkingFundCard mock ─────────────────────────────────────────────────────
jest.mock('../../../components/envelopes/SinkingFundCard', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    SinkingFundCard: ({
      envelope,
      onPress,
      testID,
    }: {
      envelope: { name: string };
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID },
        React.createElement('Text', {}, envelope.name),
      ),
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

const mockNavigate = jest.fn();

import { SinkingFundsScreen } from '../SinkingFundsScreen';

const makeProps = () =>
  ({
    navigation: { navigate: mockNavigate } as never,
    route: { key: 'SinkingFunds', name: 'SinkingFunds', params: undefined } as never,
  }) as any;

describe('SinkingFundsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: null,
      reload: mockReload,
    });
  });

  it('shows loading skeleton when loading', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: true,
      error: null,
      reload: mockReload,
    });
    const { getByTestId } = render(<SinkingFundsScreen {...makeProps()} />);
    expect(getByTestId('sinking-funds-loading')).toBeTruthy();
  });

  it('shows empty state when no sinking funds', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: null,
      reload: mockReload,
    });
    const { getByTestId } = render(<SinkingFundsScreen {...makeProps()} />);
    expect(getByTestId('sinking-funds-empty')).toBeTruthy();
  });

  it('shows fund cards when sinking funds exist', () => {
    const funds = [
      {
        id: 'sf-1',
        name: 'Holiday',
        envelopeType: 'sinking_fund',
        allocatedCents: 300000,
        spentCents: 0,
      },
      {
        id: 'sf-2',
        name: 'Car Service',
        envelopeType: 'sinking_fund',
        allocatedCents: 150000,
        spentCents: 0,
      },
    ];
    mockUseEnvelopes.mockReturnValue({
      envelopes: funds,
      loading: false,
      error: null,
      reload: mockReload,
    });

    const { getByTestId, getByText } = render(<SinkingFundsScreen {...makeProps()} />);
    expect(getByTestId('sinking-funds-list')).toBeTruthy();
    expect(getByText('Holiday')).toBeTruthy();
    expect(getByText('Car Service')).toBeTruthy();
  });

  it('filters out non-sinking-fund envelopes', () => {
    const envelopes = [
      {
        id: 'sf-1',
        name: 'Holiday',
        envelopeType: 'sinking_fund',
        allocatedCents: 300000,
        spentCents: 0,
      },
      {
        id: 'e-1',
        name: 'Groceries',
        envelopeType: 'expense',
        allocatedCents: 500000,
        spentCents: 200000,
      },
    ];
    mockUseEnvelopes.mockReturnValue({
      envelopes,
      loading: false,
      error: null,
      reload: mockReload,
    });

    const { getByText, queryByText } = render(<SinkingFundsScreen {...makeProps()} />);
    expect(getByText('Holiday')).toBeTruthy();
    expect(queryByText('Groceries')).toBeNull();
  });

  it('navigates to AddEditEnvelope when FAB is pressed', () => {
    const { getByTestId } = render(<SinkingFundsScreen {...makeProps()} />);
    fireEvent.press(getByTestId('new-sinking-fund-fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddEditEnvelope', {
      preselectedType: 'sinking_fund',
    });
  });

  // TODO: GAP — useEnvelopes exposes an error state, but the screen never
  // checks it. A DB error silently results in an empty list display.
  it('does not show error UI when hook returns error (gap)', () => {
    mockUseEnvelopes.mockReturnValue({
      envelopes: [],
      loading: false,
      error: 'Failed to load envelopes',
      reload: mockReload,
    });

    const { getByTestId, queryByText } = render(<SinkingFundsScreen {...makeProps()} />);
    expect(getByTestId('sinking-funds-empty')).toBeTruthy();
    expect(queryByText(/error/i)).toBeNull();
  });
});

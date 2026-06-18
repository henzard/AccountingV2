/**
 * DashboardScreen.test.tsx — C8 screen test
 * Tests render and primary interaction (FAB navigation to AddTransaction).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));

// ─── Local DB mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/db', () => ({ db: {} }));

// ─── Domain/hooks mocks ───────────────────────────────────────────────────────
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: jest.fn().mockReturnValue({ envelopes: [], loading: false, reload: jest.fn() }),
}));

jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: jest.fn().mockReturnValue({ statuses: [] }),
}));

jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(7),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'), // acknowledged — suppresses rollover modal
  setItem: jest.fn().mockResolvedValue(undefined),
}));

// ─── Store mock ───────────────────────────────────────────────────────────────
let mockHouseholdId: string | null = 'hh-1';
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: mockHouseholdId, paydayDay: 25 }),
  ),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    Button: ({ onPress, children }: { onPress?: () => void; children?: React.ReactNode }) =>
      React.createElement('Pressable', { onPress }, children),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('expo-linear-gradient', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    LinearGradient: ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement('View', { style }, children),
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Circle: () => React.createElement('View'),
  };
});

import { useEnvelopes } from '../../../hooks/useEnvelopes';
import { DashboardScreen } from '../DashboardScreen';

const mockEnvelopes = [
  {
    id: 'e1',
    householdId: 'hh-1',
    name: 'Groceries',
    type: 'expense',
    allocatedCents: 500000,
    spentCents: 200000,
    periodStart: '2024-01-01',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    createdBy: 'u1',
  },
  {
    id: 'e2',
    householdId: 'hh-1',
    name: 'Transport',
    type: 'expense',
    allocatedCents: 200000,
    spentCents: 250000,
    periodStart: '2024-01-01',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    createdBy: 'u1',
  },
];

describe('DashboardScreen', () => {
  afterEach(() => {
    mockHouseholdId = 'hh-1';
    jest.clearAllMocks();
  });

  it('shows loading splash when householdId is null', () => {
    mockHouseholdId = null;
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('loading-splash')).toBeTruthy();
  });

  it('renders without crashing and shows Add Transaction FAB', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('add-transaction-fab')).toBeTruthy();
  });

  it('pressing Add Transaction FAB navigates to AddTransaction', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('add-transaction-fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddTransaction');
  });

  it('shows empty state when no envelopes', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('dashboard-empty-state')).toBeTruthy();
  });

  it('shows new envelope button in empty state', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('new-envelope-button')).toBeTruthy();
  });

  it('pressing new envelope button navigates to AddEditEnvelope', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('new-envelope-button'));
    expect(mockNavigate).toHaveBeenCalledWith('AddEditEnvelope', {});
  });

  it('renders envelope list when envelopes exist', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('dashboard-kpi-row')).toBeTruthy();
  });

  it('shows view-budget link when envelopes exist', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('view-budget-link')).toBeTruthy();
  });

  it('pressing view-budget link navigates to Budget', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('view-budget-link'));
    expect(mockNavigate).toHaveBeenCalledWith('Budget');
  });

  it('renders sinking funds entry point', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('sinking-funds-entry')).toBeTruthy();
  });

  it('pressing sinking funds navigates to SinkingFunds', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('sinking-funds-entry'));
    expect(mockNavigate).toHaveBeenCalledWith('SinkingFunds');
  });

  it('pressing forecast navigates to Forecast', () => {
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByTestId('forecast-entry'));
    expect(mockNavigate).toHaveBeenCalledWith('Forecast');
  });

  it('shows loading skeleton when loading is true', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: [],
      loading: true,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('dashboard-loading')).toBeTruthy();
  });
});

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
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaView: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      RN.createElement('View', p, children),
  };
});

// ─── Domain/hooks mocks ───────────────────────────────────────────────────────
jest.mock('../../../hooks/useEnvelopes', () => ({
  useEnvelopes: jest.fn().mockReturnValue({ envelopes: [], loading: false, reload: jest.fn() }),
}));

jest.mock('../../../hooks/useDebts', () => ({
  useDebts: jest.fn().mockReturnValue({ debts: [], loading: false, reload: jest.fn() }),
}));

jest.mock('../../../hooks/useBabySteps', () => ({
  useBabySteps: jest.fn().mockReturnValue({ statuses: [] }),
}));

jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: jest.fn().mockReturnValue({
    savedCentsByEnvelopeId: new Map(),
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));

jest.mock('../../../../domain/shared/resolveBabyStepIsActive', () => ({
  resolveBabyStepIsActive: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../../domain/scoring/resolveLoggingDays', () => ({
  resolveLoggingDays: jest.fn().mockResolvedValue(7),
}));

jest.mock('../resolveMeterReadingsLogged', () => ({
  resolveMeterReadingsLogged: jest.fn().mockResolvedValue(false),
}));

jest.mock('../findLatestPeriodWithEnvelopes', () => ({
  findLatestPeriodWithEnvelopes: jest.fn().mockResolvedValue(null),
  hasPeriodScopedEnvelopeAfter: jest.fn().mockResolvedValue(false),
}));

jest.mock('../resolveEnvelopeTransactions', () => ({
  resolveEnvelopeTransactions: jest.fn().mockResolvedValue([]),
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
  const Dialog = ({
    children,
    visible,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    Button: ({
      onPress,
      children,
      testID,
      accessibilityLabel,
    }: {
      onPress?: () => void;
      children?: React.ReactNode;
      testID?: string;
      accessibilityLabel?: string;
    }) => React.createElement('Pressable', { onPress, testID, accessibilityLabel }, children),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Portal: ({ children }: { children?: React.ReactNode }) => children,
    Dialog,
    ProgressBar: ({ testID }: { testID?: string }) =>
      React.createElement('View', { testID: testID ?? 'progress-bar' }),
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
import { useDebts } from '../../../hooks/useDebts';
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

  it('pressing an envelope row opens the detail sheet instead of navigating to edit (VAL-9)', async () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByLabelText, findByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByLabelText(/Groceries/));
    expect(await findByTestId('envelope-detail-sheet')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('the detail sheet’s "Add transaction" navigates to AddTransaction with the envelope id', async () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByLabelText, findByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByLabelText(/Groceries/));
    fireEvent.press(await findByTestId('envelope-detail-add-transaction'));
    expect(mockNavigate).toHaveBeenCalledWith('AddTransaction', { envelopeId: 'e1' });
  });

  it('the detail sheet’s "Edit envelope" navigates to AddEditEnvelope with the envelope id', async () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByLabelText, findByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    fireEvent.press(getByLabelText(/Groceries/));
    fireEvent.press(await findByTestId('envelope-detail-edit'));
    expect(mockNavigate).toHaveBeenCalledWith('AddEditEnvelope', { envelopeId: 'e1' });
  });

  it('shows a "Safe to spend today" line when spend envelopes exist', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('dashboard-safe-to-spend')).toBeTruthy();
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

  it('shows the RefreshingBar while refreshing, without blanking the list (REG-9)', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: mockEnvelopes,
      loading: false,
      refreshing: true,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('refreshing-bar')).toBeTruthy();
    expect(getByTestId('dashboard-kpi-row')).toBeTruthy();
  });

  it('hides the RefreshingBar when not refreshing', () => {
    (useEnvelopes as jest.Mock).mockReturnValue({
      envelopes: [],
      loading: false,
      refreshing: false,
      reload: jest.fn(),
    });
    const { queryByTestId } = render(
      <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(queryByTestId('refreshing-bar')).toBeNull();
  });

  describe('debt-free header line (VAL2-10)', () => {
    const unpaidDebt = {
      id: 'd1',
      creditorName: 'Credit Card',
      debtType: 'credit_card' as const,
      outstandingBalanceCents: 10000,
      initialBalanceCents: 10000,
      totalPaidCents: 0,
      minimumPaymentCents: 5000,
      interestRatePercent: 0,
      sortOrder: 0,
      isPaidOff: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    afterEach(() => {
      (useDebts as jest.Mock).mockReturnValue({ debts: [], loading: false, reload: jest.fn() });
    });

    it('is hidden when there are no debts', () => {
      const { queryByTestId } = render(
        <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
      );
      expect(queryByTestId('dashboard-debt-line')).toBeNull();
    });

    it('is hidden when every debt is paid off', () => {
      (useDebts as jest.Mock).mockReturnValue({
        debts: [{ ...unpaidDebt, isPaidOff: true, outstandingBalanceCents: 0 }],
        loading: false,
        reload: jest.fn(),
      });
      const { queryByTestId } = render(
        <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
      );
      expect(queryByTestId('dashboard-debt-line')).toBeNull();
    });

    it('shows "Debt-free by …" when at least one debt is unpaid', () => {
      (useDebts as jest.Mock).mockReturnValue({
        debts: [unpaidDebt],
        loading: false,
        reload: jest.fn(),
      });
      const { getByTestId } = render(
        <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
      );
      expect(getByTestId('dashboard-debt-line')).toBeTruthy();
    });

    it('tapping the debt line navigates to the Snowball tab', () => {
      (useDebts as jest.Mock).mockReturnValue({
        debts: [unpaidDebt],
        loading: false,
        reload: jest.fn(),
      });
      const { getByTestId } = render(
        <DashboardScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
      );
      fireEvent.press(getByTestId('dashboard-debt-line'));
      expect(mockNavigate).toHaveBeenCalledWith('Snowball');
    });
  });
});

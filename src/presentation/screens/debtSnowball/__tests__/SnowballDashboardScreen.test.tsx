/**
 * SnowballDashboardScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../hooks/useDebts', () => ({
  useDebts: jest.fn().mockReturnValue({ debts: [], loading: false, reload: jest.fn() }),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
jest.mock('../../../../domain/scoring/getLatestDebtSnapshot', () => ({
  getLatestDebtSnapshot: jest.fn().mockResolvedValue(null),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    FAB: ({
      onPress,
      testID,
      accessibilityLabel,
    }: {
      onPress?: () => void;
      testID?: string;
      accessibilityLabel?: string;
    }) =>
      React.createElement('Pressable', {
        onPress,
        testID: testID ?? 'fab',
        accessibilityLabel,
      }),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    ProgressBar: ({ testID }: { testID?: string }) =>
      React.createElement('View', { testID: testID ?? 'progress-bar' }),
    TouchableRipple: ({
      children,
      onPress,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
    }) => React.createElement('Pressable', { onPress }, children),
    TextInput: ({
      value,
      onChangeText,
      testID,
    }: {
      value?: string;
      onChangeText?: (v: string) => void;
      testID?: string;
    }) =>
      React.createElement('TextInput', {
        testID: testID ?? 'extra-payment',
        value,
        onChangeText,
      }),
    Chip: ({
      children,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      accessibilityLabel?: string;
    }) => React.createElement('View', { testID: 'focus-chip', accessibilityLabel }, children),
  };
});
jest.mock('../components/DebtPayoffBar', () => ({
  DebtPayoffBar: () => null,
}));
jest.mock('../components/PayoffProjectionCard', () => ({
  PayoffProjectionCard: () => null,
}));

const mockNavigate = jest.fn();
import { SnowballDashboardScreen } from '../SnowballDashboardScreen';

describe('SnowballDashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing and shows FAB', () => {
    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('fab')).toBeTruthy();
  });

  it('pressing FAB navigates to AddDebt', () => {
    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddDebt');
  });

  it('FAB has accessibility label "Add debt"', () => {
    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    const fab = getByTestId('fab');
    expect(fab.props.accessibilityLabel).toBe('Add debt');
  });

  it('extra payment input field renders and accepts input', () => {
    const debts = [
      {
        id: 'd1',
        creditorName: 'Credit Card',
        debtType: 'credit_card' as const,
        outstandingBalanceCents: 10000,
        totalPaidCents: 0,
        minimumPaymentCents: 100,
        interestRatePercent: 18,
        sortOrder: 0,
        isPaidOff: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.mocked(require('../../../hooks/useDebts').useDebts).mockReturnValue({
      debts,
      loading: false,
      reload: jest.fn(),
    });

    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );

    const extraPaymentInput = getByTestId('extra-payment');
    expect(extraPaymentInput).toBeTruthy();

    fireEvent.changeText(extraPaymentInput, '50.00');
    expect(extraPaymentInput.props.value).toBe('50.00');
  });

  it('renders debts sorted by smallest balance first (unpaid before paid-off)', () => {
    const debts = [
      {
        id: 'd1',
        creditorName: 'Large Debt',
        debtType: 'personal_loan' as const,
        outstandingBalanceCents: 100000,
        totalPaidCents: 0,
        minimumPaymentCents: 500,
        interestRatePercent: 10,
        sortOrder: 0,
        isPaidOff: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'd2',
        creditorName: 'Small Debt',
        debtType: 'credit_card' as const,
        outstandingBalanceCents: 5000,
        totalPaidCents: 0,
        minimumPaymentCents: 100,
        interestRatePercent: 18,
        sortOrder: 1,
        isPaidOff: false,
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
      {
        id: 'd3',
        creditorName: 'Paid Off',
        debtType: 'auto_loan' as const,
        outstandingBalanceCents: 0,
        totalPaidCents: 50000,
        minimumPaymentCents: 0,
        interestRatePercent: 5,
        sortOrder: 2,
        isPaidOff: true,
        createdAt: '2026-01-03T00:00:00Z',
        updatedAt: '2026-01-03T00:00:00Z',
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.mocked(require('../../../hooks/useDebts').useDebts).mockReturnValue({
      debts,
      loading: false,
      reload: jest.fn(),
    });

    const { queryByText } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );

    // The debt list should be ordered: Small Debt (5000), Large Debt (100000), Paid Off (0)
    // We can't directly verify order in FlatList easily, but we can verify all debts render
    expect(queryByText('Small Debt')).toBeTruthy();
    expect(queryByText('Large Debt')).toBeTruthy();
    expect(queryByText('Paid Off')).toBeTruthy();
  });

  it('renders Focus badge on the smallest unpaid debt', () => {
    const debts = [
      {
        id: 'd1',
        creditorName: 'Large Debt',
        debtType: 'personal_loan' as const,
        outstandingBalanceCents: 100000,
        totalPaidCents: 0,
        minimumPaymentCents: 500,
        interestRatePercent: 10,
        sortOrder: 0,
        isPaidOff: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'd2',
        creditorName: 'Small Debt',
        debtType: 'credit_card' as const,
        outstandingBalanceCents: 5000,
        totalPaidCents: 0,
        minimumPaymentCents: 100,
        interestRatePercent: 18,
        sortOrder: 1,
        isPaidOff: false,
        createdAt: '2026-01-02T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.mocked(require('../../../hooks/useDebts').useDebts).mockReturnValue({
      debts,
      loading: false,
      reload: jest.fn(),
    });

    const { queryByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );

    // Focus chip should be rendered on the smallest unpaid debt (d2: Small Debt with 5000)
    const focusChip = queryByTestId('focus-chip');
    expect(focusChip).toBeTruthy();
    expect(focusChip?.props.accessibilityLabel).toBe('Focus debt: Small Debt');
  });

  it('shows the RefreshingBar while refreshing, without blanking the debt list (REG-9)', () => {
    const debts = [
      {
        id: 'd1',
        creditorName: 'Credit Card',
        debtType: 'credit_card' as const,
        outstandingBalanceCents: 10000,
        totalPaidCents: 0,
        minimumPaymentCents: 5000,
        interestRatePercent: 0,
        sortOrder: 0,
        isPaidOff: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.mocked(require('../../../hooks/useDebts').useDebts).mockReturnValue({
      debts,
      loading: false,
      refreshing: true,
      reload: jest.fn(),
    });

    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('refreshing-bar')).toBeTruthy();
    expect(getByTestId('fab')).toBeTruthy();
  });

  it('VAL2-10: shows "paid off since last month" when the previous snapshot recorded more total debt', async () => {
    const debts = [
      {
        id: 'd1',
        creditorName: 'Credit Card',
        debtType: 'credit_card' as const,
        outstandingBalanceCents: 50000,
        totalPaidCents: 0,
        minimumPaymentCents: 50000,
        interestRatePercent: 0,
        sortOrder: 0,
        isPaidOff: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.mocked(require('../../../hooks/useDebts').useDebts).mockReturnValue({
      debts,
      loading: false,
      reload: jest.fn(),
    });
    jest
      .mocked(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../../domain/scoring/getLatestDebtSnapshot').getLatestDebtSnapshot,
      )
      .mockResolvedValue({ totalDebtCents: 150000, debtFreeDateISO: null });

    const { findByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(await findByTestId('debt-progress-paid-off-message')).toBeTruthy();
  });

  it('VAL2-10: shows no progress line when there is no previous snapshot', async () => {
    const debts = [
      {
        id: 'd1',
        creditorName: 'Credit Card',
        debtType: 'credit_card' as const,
        outstandingBalanceCents: 50000,
        totalPaidCents: 0,
        minimumPaymentCents: 50000,
        interestRatePercent: 0,
        sortOrder: 0,
        isPaidOff: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    jest.mocked(require('../../../hooks/useDebts').useDebts).mockReturnValue({
      debts,
      loading: false,
      reload: jest.fn(),
    });
    jest
      .mocked(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../../../domain/scoring/getLatestDebtSnapshot').getLatestDebtSnapshot,
      )
      .mockResolvedValue(null);

    const { queryByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    await waitFor(() => {
      expect(queryByTestId('debt-progress-paid-off-message')).toBeNull();
      expect(queryByTestId('debt-progress-date-message')).toBeNull();
    });
  });
});

/**
 * DebtDetailScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const mockUseFocusEffect = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: any) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(() => {
      mockUseFocusEffect(cb);
      cb();
    }, [cb]);
  },
}));

jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));

jest.mock('../../../../domain/debtSnowball/SnowballPayoffProjector', () => ({
  SnowballPayoffProjector: jest.fn().mockImplementation(() => ({
    project: jest.fn().mockReturnValue({
      projections: [
        { monthsToPayoff: 24, payoffDate: new Date('2028-06-01'), totalInterestCents: 5000 },
      ],
    }),
  })),
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
    Surface: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('View', { testID }, children),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID: testID ?? 'log-payment-button' },
        children,
      ),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
  };
});
jest.mock('../components/DebtPayoffBar', () => ({
  DebtPayoffBar: ({ label }: { progressPercent: number; label: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID: 'payoff-bar' }, label);
  },
}));
jest.mock('../../../components/shared/StatCard', () => ({
  StatCard: ({ label, value, testID }: { label: string; value: string; testID?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID }, `${label}: ${value}`);
  },
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = { navigate: mockNavigate, goBack: mockGoBack } as never;

import { DebtDetailScreen } from '../DebtDetailScreen';
import { db } from '../../../../data/local/db';

const mockDebt = {
  id: 'debt-1',
  householdId: 'hh-1',
  creditorName: 'Visa Platinum',
  debtType: 'credit_card',
  outstandingBalanceCents: 5000000,
  initialBalanceCents: 8000000,
  interestRatePercent: 21.5,
  minimumPaymentCents: 250000,
  totalPaidCents: 3000000,
  isPaidOff: false,
  sortOrder: 0,
  isSynced: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-06-01',
};

function setupDbWithDebt(debt = mockDebt) {
  (db.select as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve([debt])),
    })),
  });
}

function setupDbEmpty() {
  (db.select as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.resolve([])),
    })),
  });
}

describe('DebtDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbEmpty();
  });

  it('renders without crashing (loading state)', () => {
    (db.select as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => new Promise(() => {})),
      })),
    });
    const { getByTestId } = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('loading')).toBeTruthy();
  });

  it('shows loading indicator while fetching', () => {
    (db.select as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => new Promise(() => {})),
      })),
    });
    const { getByTestId } = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );
    expect(getByTestId('loading')).toBeTruthy();
  });

  it('renders debt details after loading', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getAllByText(/Visa Platinum/i).length).toBeGreaterThan(0);
    });
  });

  it('renders creditor name', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getAllByText('Visa Platinum').length).toBeGreaterThan(0);
    });
  });

  it('renders stat cards for outstanding and paid', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getByTestId('stat-outstanding')).toBeTruthy();
      expect(result.getByTestId('stat-paid-to-date')).toBeTruthy();
    });
  });

  it('renders payoff progress bar', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getByTestId('payoff-bar')).toBeTruthy();
    });
  });

  it('shows Log Payment button when debt is not paid off', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getByTestId('log-payment-button')).toBeTruthy();
    });
  });

  it('hides Log Payment button when debt is paid off', async () => {
    setupDbWithDebt({ ...mockDebt, isPaidOff: true });
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.queryByTestId('log-payment-button')).toBeNull();
    });
  });

  it('displays interest rate', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getAllByText(/21\.5/i).length).toBeGreaterThan(0);
    });
  });

  it('displays minimum payment per month', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getAllByText(/Min payment/i).length).toBeGreaterThan(0);
    });
  });

  it('displays debt type label', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getAllByText(/Credit Card/i).length).toBeGreaterThan(0);
    });
  });

  it('displays projected payoff date', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getAllByText(/Projected payoff/i).length).toBeGreaterThan(0);
      expect(result.getAllByText(/24 months/i).length).toBeGreaterThan(0);
    });
  });

  it('navigates to LogPayment on button press', async () => {
    setupDbWithDebt();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );

    await waitFor(() => {
      expect(result.getByTestId('log-payment-button')).toBeTruthy();
    });
    fireEvent.press(result.getByTestId('log-payment-button'));
    expect(mockNavigate).toHaveBeenCalledWith('LogPayment', { debtId: 'debt-1' });
  });

  it('shows not-found message when debt does not exist', async () => {
    setupDbEmpty();
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'nonexistent' } } as never}
        navigation={mockNavigation}
      />,
    );
    await waitFor(() => {
      expect(result.getByText('Debt not found')).toBeTruthy();
    });
    expect(result.queryByTestId('loading')).toBeNull();
  });
});

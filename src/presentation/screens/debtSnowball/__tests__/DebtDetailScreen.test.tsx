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
interface MockPredicate {
  type: 'eq' | 'and' | 'isNull';
  val?: unknown;
  conditions?: MockPredicate[];
}

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((col, val) => ({ type: 'eq', col, val })),
  and: jest.fn((...conditions) => ({ type: 'and', conditions })),
  isNull: jest.fn((col) => ({ type: 'isNull', col })),
}));

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
  const TextImpl = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);

  const SurfaceImpl = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement('View', { testID }, children);

  const ButtonImpl = ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
  }) =>
    React.createElement(
      'Pressable',
      { onPress, testID: testID ?? 'log-payment-button', disabled: false },
      children,
    );

  const ActivityIndicatorImpl = () => React.createElement('View', { testID: 'loading' });

  const DialogImpl = ({
    children,
    visible,
    testID,
    onDismiss,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
    onDismiss?: () => void;
  }) => {
    if (!visible) return null;
    return React.createElement('View', { testID, onDismiss }, children);
  };

  const PortalImpl = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', {}, children);

  const TextInputImpl = ({
    value,
    onChangeText,
    testID,
    label,
    mode,
    style,
    keyboardType,
    autoFocus,
    accessibilityHint,
  }: {
    value?: string;
    onChangeText?: (v: string) => void;
    testID?: string;
    label?: string;
    mode?: string;
    style?: any;
    keyboardType?: string;
    autoFocus?: boolean;
    accessibilityHint?: string;
  }) =>
    React.createElement(
      'View',
      { style },
      label ? React.createElement('Text', {}, label) : null,
      React.createElement('Input', {
        testID,
        value,
        onChangeText,
        mode,
        keyboardType,
        autoFocus,
        accessibilityHint,
      }),
    );

  const HelperTextImpl = ({
    children,
    visible,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
  }) => (visible ? React.createElement('Text', {}, children) : null);

  // Dialog.Title
  DialogImpl.Title = function DialogTitle({ children }: { children?: React.ReactNode }) {
    return React.createElement('Text', {}, children);
  };

  // Dialog.Content
  DialogImpl.Content = function DialogContent({ children }: { children?: React.ReactNode }) {
    return React.createElement('View', {}, children);
  };

  // Dialog.Actions
  DialogImpl.Actions = function DialogActions({ children }: { children?: React.ReactNode }) {
    return React.createElement('View', {}, children);
  };

  return {
    Text: TextImpl,
    Surface: SurfaceImpl,
    Button: ButtonImpl,
    ActivityIndicator: ActivityIndicatorImpl,
    Dialog: DialogImpl,
    Portal: PortalImpl,
    TextInput: TextInputImpl,
    HelperText: HelperTextImpl,
  };
});

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector) => selector({ householdId: 'hh-1' })),
}));

jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector) =>
    selector({
      enqueue: jest.fn(),
      queue: [],
    }),
  ),
}));
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
  deletedAt: null,
};

function setupDbWithDebt(debt = mockDebt) {
  (db.select as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      // Applies the predicate the SCREEN built (see the drizzle-orm mock
      // above), so dropping the household or soft-delete scoping from the
      // query makes the other-household test fail.
      where: jest.fn((predicate: MockPredicate) => {
        const parts = predicate.type === 'and' ? (predicate.conditions ?? []) : [predicate];
        const scopedToHousehold = parts.some((c) => c.type === 'eq' && c.val === debt.householdId);
        const excludesDeleted = parts.some((c) => c.type === 'isNull');
        const visible = scopedToHousehold && (!excludesDeleted || !debt.deletedAt);
        return Promise.resolve(visible ? [debt] : []);
      }),
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

  it('shows not-found message when debt belongs to a different household', async () => {
    const otherHouseholdDebt = { ...mockDebt, householdId: 'hh-other' };
    setupDbWithDebt(otherHouseholdDebt);
    const result = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={mockNavigation}
      />,
    );
    await waitFor(() => {
      expect(result.getByText('Debt not found')).toBeTruthy();
    });
    expect(result.queryByTestId('loading')).toBeNull();
  });

  describe('Update from statement dialog', () => {
    it('renders Update from statement button', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });
    });

    it('opens dialog when Update from statement button is pressed', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-from-statement-button'));

      await waitFor(() => {
        expect(result.getByTestId('update-debt-dialog')).toBeTruthy();
      });
    });

    it('prefills dialog fields with current debt values', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-from-statement-button'));

      await waitFor(() => {
        const creditorInput = result.getByTestId('update-dialog-creditor-name');
        expect(creditorInput.props.value).toBe('Visa Platinum');
      });
    });

    it('closes dialog when Cancel is pressed', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-from-statement-button'));

      await waitFor(() => {
        expect(result.getByTestId('update-debt-dialog')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-dialog-cancel'));

      await waitFor(() => {
        expect(result.queryByTestId('update-debt-dialog')).toBeNull();
      });
    });

    it('displays validation error for invalid balance', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-from-statement-button'));

      await waitFor(() => {
        const balanceInput = result.getByTestId('update-dialog-balance');
        fireEvent.changeText(balanceInput, 'invalid');
      });

      fireEvent.press(result.getByTestId('update-dialog-save'));

      await waitFor(() => {
        expect(result.queryByTestId('update-error')).toBeTruthy();
      });
    });

    it('displays validation error for empty creditor name', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-from-statement-button'));

      await waitFor(() => {
        const creditorInput = result.getByTestId('update-dialog-creditor-name');
        fireEvent.changeText(creditorInput, '');
      });

      fireEvent.press(result.getByTestId('update-dialog-save'));

      await waitFor(() => {
        expect(result.queryByTestId('update-error')).toBeTruthy();
      });
    });

    it('calls UpdateDebtUseCase with parsed cents and rate', async () => {
      setupDbWithDebt();
      const result = render(
        <DebtDetailScreen
          route={{ params: { debtId: 'debt-1' } } as never}
          navigation={mockNavigation}
        />,
      );

      await waitFor(() => {
        expect(result.getByTestId('update-from-statement-button')).toBeTruthy();
      });

      fireEvent.press(result.getByTestId('update-from-statement-button'));

      await waitFor(() => {
        const balanceInput = result.getByTestId('update-dialog-balance');
        const rateInput = result.getByTestId('update-dialog-rate');
        const minPaymentInput = result.getByTestId('update-dialog-min-payment');

        fireEvent.changeText(balanceInput, '5000.50');
        fireEvent.changeText(rateInput, '12,5');
        fireEvent.changeText(minPaymentInput, '250');
      });

      fireEvent.press(result.getByTestId('update-dialog-save'));

      // The UpdateDebtUseCase would be called with:
      // - outstandingBalanceCents: 500050 (5000.50 * 100)
      // - interestRatePercent: 12.5 (comma parsed as decimal)
      // - minimumPaymentCents: 25000 (250 * 100)
    });
  });
});

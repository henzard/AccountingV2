/**
 * TransactionListScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

// ─── confirm() mock (ConfirmDialogHost) ────────────────────────────────────────
const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    }),
  },
}));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../../domain/transactions/DeleteTransactionUseCase', () => ({
  DeleteTransactionUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true }),
  })),
}));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));

const mockRequestSyncNow = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../data/sync/syncRuntime', () => ({
  requestSyncNow: (...args: unknown[]) => mockRequestSyncNow(...args),
}));

const mockUseTransactions = jest.fn().mockReturnValue({
  transactions: [],
  loading: false,
  reload: jest.fn(),
});
jest.mock('../../../hooks/useTransactions', () => ({
  useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));

let mockHouseholdId: string | null = 'hh-1';
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: mockHouseholdId, paydayDay: 25 }),
  ),
}));
const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: () => void }) => unknown) =>
    sel({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
  ),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
    FAB: ({
      onPress,
      testID,
      label,
      accessibilityLabel,
    }: {
      onPress?: () => void;
      testID?: string;
      label?: string;
      accessibilityLabel?: string;
    }) =>
      React.createElement('Pressable', {
        onPress,
        testID: testID ?? 'fab',
        label,
        accessibilityLabel,
      }),
    ActivityIndicator: ({ animating }: { animating?: boolean }) =>
      animating !== false ? React.createElement('View', { testID: 'loading' }) : null,
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    IconButton: ({
      onPress,
      testID,
      disabled,
      accessibilityLabel,
    }: {
      onPress?: () => void;
      testID?: string;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => React.createElement('Pressable', { onPress, testID, disabled, accessibilityLabel }),
    Divider: () => React.createElement('View'),
    Searchbar: ({
      value,
      onChangeText,
      testID,
      placeholder,
    }: {
      value?: string;
      onChangeText?: (text: string) => void;
      testID?: string;
      placeholder?: string;
    }) =>
      React.createElement('TextInput', {
        value,
        onChangeText,
        testID,
        placeholder,
      }),
    ProgressBar: ({ testID }: { testID?: string }) =>
      React.createElement('View', { testID: testID ?? 'progress-bar' }),
  };
});

jest.mock('../../../components/shared/LoadingSplash', () => ({
  LoadingSplash: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID: 'loading-splash' });
  },
}));
jest.mock('../../../components/shared/EmptyState', () => ({
  EmptyState: ({ testID }: { testID?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID });
  },
}));
jest.mock('../../../components/shared/ScreenHeader', () => ({
  ScreenHeader: () => null,
}));
jest.mock('../../../components/shared/SectionHeader', () => ({
  SectionHeader: () => null,
}));
jest.mock('../../../components/shared/CurrencyText', () => ({
  CurrencyText: () => null,
}));
jest.mock('../../../components/shared/ListRow', () => ({
  ListRow: ({ testID, trailing }: { testID?: string; trailing?: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID }, trailing);
  },
}));

const mockNavigate = jest.fn();
import { TransactionListScreen } from '../TransactionListScreen';

const mockTransaction = {
  id: 'tx-1',
  householdId: 'hh-1',
  envelopeId: 'env-1',
  amountCents: 5000,
  payee: 'Woolworths',
  transactionDate: '2026-06-15',
  notes: null,
  isBusinessExpense: false,
  createdBy: 'user-1',
  isSynced: true,
  createdAt: '2026-06-15T10:00:00Z',
  updatedAt: '2026-06-15T10:00:00Z',
};

describe('TransactionListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHouseholdId = 'hh-1';
    mockUseTransactions.mockReturnValue({ transactions: [], loading: false, reload: jest.fn() });
    mockConfirm.mockResolvedValue(true);
    mockRequestSyncNow.mockResolvedValue(undefined);
  });

  it('renders without crashing and shows FAB', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('fab')).toBeTruthy();
  });

  it('pressing FAB navigates to AddTransaction', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddTransaction');
  });

  it('shows LoadingSplash when householdId is null', () => {
    mockHouseholdId = null;
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('loading-splash')).toBeTruthy();
  });

  it('shows loading indicator when hook is loading', () => {
    mockUseTransactions.mockReturnValue({ transactions: [], loading: true, reload: jest.fn() });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('loading')).toBeTruthy();
  });

  it('shows empty state when transactions array is empty and not loading', () => {
    mockUseTransactions.mockReturnValue({ transactions: [], loading: false, reload: jest.fn() });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('transaction-list-empty-state')).toBeTruthy();
  });

  it('shows delete confirmation via confirm() when delete button pressed', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [mockTransaction],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('delete-tx-tx-1'));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete transaction?',
        message: expect.stringContaining('Woolworths'),
        confirmLabel: 'Delete',
        destructive: true,
      }),
    );
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    mockConfirm.mockResolvedValue(false);
    mockUseTransactions.mockReturnValue({
      transactions: [mockTransaction],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('delete-tx-tx-1'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockEnqueue).not.toHaveBeenCalledWith('Transaction deleted', 'success');
  });

  it('shows a success toast after a confirmed delete', async () => {
    mockConfirm.mockResolvedValue(true);
    mockUseTransactions.mockReturnValue({
      transactions: [mockTransaction],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('delete-tx-tx-1'));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith('Transaction deleted', 'success');
    });
  });

  it('pressing a transaction row navigates to AddTransaction with its transactionId', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [mockTransaction],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('tx-row-tx-1'));
    expect(mockNavigate).toHaveBeenCalledWith('AddTransaction', { transactionId: 'tx-1' });
  });

  it('the row has an accessibility label naming the payee', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [mockTransaction],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('tx-row-tx-1').props.accessibilityLabel).toBe('Edit transaction Woolworths');
  });

  it('pressing the delete button does not also navigate to edit', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [mockTransaction],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('delete-tx-tx-1'));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows error banner when hook returns error', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [],
      loading: false,
      reload: jest.fn(),
      error: new Error('Network failure'),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('error-banner')).toBeTruthy();
  });

  // ─── Period switcher ────────────────────────────────────────────────────

  it('renders the period switcher with the next-period button disabled on the current period', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('period-switcher')).toBeTruthy();
    expect(getByTestId('period-next-button').props.disabled).toBe(true);
  });

  it('pressing the previous-period button moves the view back and re-enables next', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('period-prev-button'));
    expect(getByTestId('period-next-button').props.disabled).toBe(false);
  });

  it('pressing next after going back returns to the current period (next disabled again)', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('period-prev-button'));
    fireEvent.press(getByTestId('period-next-button'));
    expect(getByTestId('period-next-button').props.disabled).toBe(true);
  });

  it('passes the viewed period as periodStart/periodEnd to useTransactions', () => {
    render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    const [, arg] = mockUseTransactions.mock.calls[0] as [
      string,
      { periodStart: string; periodEnd: string },
    ];
    expect(typeof arg.periodStart).toBe('string');
    expect(typeof arg.periodEnd).toBe('string');
    expect(arg.periodStart <= arg.periodEnd).toBe(true);
  });

  // ─── Search ─────────────────────────────────────────────────────────────

  it('filters the visible rows by payee, case-insensitively, after the debounce', async () => {
    jest.useFakeTimers();
    mockUseTransactions.mockReturnValue({
      transactions: [
        { ...mockTransaction, id: 'tx-1', payee: 'Woolworths' },
        { ...mockTransaction, id: 'tx-2', payee: 'Pick n Pay' },
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId, queryByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );

    fireEvent.changeText(getByTestId('transaction-search'), 'woolworths');
    act(() => {
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(queryByTestId('tx-row-tx-1')).toBeTruthy();
      expect(queryByTestId('tx-row-tx-2')).toBeNull();
    });
    jest.useRealTimers();
  });

  it('shows "no matches" empty state when the search finds nothing, distinct from the no-transactions state', async () => {
    jest.useFakeTimers();
    mockUseTransactions.mockReturnValue({
      transactions: [{ ...mockTransaction, id: 'tx-1', payee: 'Woolworths' }],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId, queryByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );

    fireEvent.changeText(getByTestId('transaction-search'), 'nonexistent-merchant');
    act(() => {
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(queryByTestId('transaction-list-no-matches')).toBeTruthy();
      expect(queryByTestId('transaction-list-empty-state')).toBeNull();
    });
    jest.useRealTimers();
  });

  it('shows the period-total reflecting only the filtered rows', async () => {
    jest.useFakeTimers();
    mockUseTransactions.mockReturnValue({
      transactions: [
        { ...mockTransaction, id: 'tx-1', payee: 'Woolworths', amountCents: 5000 },
        { ...mockTransaction, id: 'tx-2', payee: 'Pick n Pay', amountCents: 3000 },
      ],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );

    fireEvent.changeText(getByTestId('transaction-search'), 'woolworths');
    act(() => {
      jest.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(getByTestId('period-total').props.children).toContain('50');
    });
    jest.useRealTimers();
  });

  // UX2-12: the total needs a label so it reads as a total OF something.
  it('labels the period total "Spent this period" when not searching', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [{ ...mockTransaction, id: 'tx-1', amountCents: 5000 }],
      loading: false,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('period-total').props.children).toContain('Spent this period');
  });

  // UX2-12: keep the FAB for a past period (back-dating is legitimate), but
  // it must be labelled — a bare "+" reads as "add today's spend".
  it('labels the FAB when viewing a past period, and leaves it unlabelled for the current one', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('fab').props.label).toBeUndefined();

    fireEvent.press(getByTestId('period-prev-button'));

    expect(getByTestId('fab').props.label).toBe('Back-date entry');
  });

  // UX2-12: pull-to-refresh asks the sync scheduler for an immediate round,
  // swallows a rejection (offline/no runtime), then reloads from local
  // storage either way.
  describe('pull-to-refresh', () => {
    it('requests a sync then reloads', async () => {
      const mockReload = jest.fn();
      mockUseTransactions.mockReturnValue({
        transactions: [{ ...mockTransaction, id: 'tx-1' }],
        loading: false,
        reload: mockReload,
      });
      const { UNSAFE_getByType } = render(
        <TransactionListScreen
          route={{} as never}
          navigation={{ navigate: mockNavigate } as never}
        />,
      );

      await act(async () => {
        fireEvent(UNSAFE_getByType(RefreshControl), 'refresh');
      });

      expect(mockRequestSyncNow).toHaveBeenCalledWith('hh-1');
      expect(mockReload).toHaveBeenCalled();
    });

    it('still reloads when the sync request rejects (offline)', async () => {
      mockRequestSyncNow.mockRejectedValue(new Error('offline'));
      const mockReload = jest.fn();
      mockUseTransactions.mockReturnValue({
        transactions: [{ ...mockTransaction, id: 'tx-1' }],
        loading: false,
        reload: mockReload,
      });
      const { UNSAFE_getByType } = render(
        <TransactionListScreen
          route={{} as never}
          navigation={{ navigate: mockNavigate } as never}
        />,
      );

      await act(async () => {
        fireEvent(UNSAFE_getByType(RefreshControl), 'refresh');
      });

      expect(mockReload).toHaveBeenCalled();
    });
  });

  it('shows the RefreshingBar while the hook is refreshing, without blanking the list (REG-9)', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [{ ...mockTransaction, id: 'tx-1' }],
      loading: false,
      refreshing: true,
      reload: jest.fn(),
    });
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('refreshing-bar')).toBeTruthy();
    expect(getByTestId('period-total')).toBeTruthy();
  });

  it('hides the RefreshingBar when the hook is not refreshing', () => {
    mockUseTransactions.mockReturnValue({
      transactions: [{ ...mockTransaction, id: 'tx-1' }],
      loading: false,
      refreshing: false,
      reload: jest.fn(),
    });
    const { queryByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(queryByTestId('refreshing-bar')).toBeNull();
  });
});

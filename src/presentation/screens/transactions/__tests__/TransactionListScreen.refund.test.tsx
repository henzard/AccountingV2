/**
 * TransactionListScreen.refund.test.tsx — REFUNDS on the list
 *
 * A refund is a transaction with a NEGATIVE amountCents. On the row it must
 * be unmistakable: "+R 25,00" in the success colour AND a literal "Refund"
 * label (never colour alone), with an accessibility label that says "refund"
 * in words.
 *
 * Unlike TransactionListScreen.test.tsx, this suite does NOT mock
 * `CurrencyText` away — the rendered amount string is exactly what is under
 * test here, so the real component has to run.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([{ id: 'env-1', name: 'Groceries' }]),
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
jest.mock('../../../../data/sync/syncRuntime', () => ({
  requestSyncNow: jest.fn().mockResolvedValue(undefined),
}));

const mockUseTransactions = jest.fn();
jest.mock('../../../hooks/useTransactions', () => ({
  useTransactions: (...args: unknown[]) => mockUseTransactions(...args),
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string | null; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: () => void }) => unknown) =>
    sel({ enqueue: jest.fn() }),
  ),
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
    FAB: ({ testID }: { testID?: string }) =>
      React.createElement('Pressable', { testID: testID ?? 'fab' }),
    ActivityIndicator: () => null,
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    IconButton: ({
      testID,
      accessibilityLabel,
    }: {
      testID?: string;
      accessibilityLabel?: string;
    }) => React.createElement('Pressable', { testID, accessibilityLabel }),
    Divider: () => React.createElement('View'),
    Searchbar: ({
      value,
      onChangeText,
      testID,
    }: {
      value?: string;
      onChangeText?: (t: string) => void;
      testID?: string;
    }) => React.createElement('TextInput', { value, onChangeText, testID }),
    ProgressBar: () => null,
  };
});

jest.mock('../../../components/shared/LoadingSplash', () => ({
  LoadingSplash: () => null,
}));
jest.mock('../../../components/shared/EmptyState', () => ({
  EmptyState: ({ testID }: { testID?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID });
  },
}));
jest.mock('../../../components/shared/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('../../../components/shared/SectionHeader', () => ({ SectionHeader: () => null }));
jest.mock('../../../components/shared/ListRow', () => ({
  ListRow: ({ testID, trailing }: { testID?: string; trailing?: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID }, trailing);
  },
}));

import { TransactionListScreen } from '../TransactionListScreen';
import { formatCurrency } from '../../../utils/currency';

function tx(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'tx-1',
    householdId: 'hh-1',
    envelopeId: 'env-1',
    amountCents: 5000,
    payee: 'Woolworths',
    description: null,
    transactionDate: '2026-06-15',
    spendingTriggerNote: null,
    isBusinessExpense: false,
    createdAt: '2026-06-15T10:00:00Z',
    updatedAt: '2026-06-15T10:00:00Z',
    ...over,
  };
}

function renderWith(transactions: unknown[]) {
  mockUseTransactions.mockReturnValue({
    transactions,
    loading: false,
    refreshing: false,
    error: null,
    reload: jest.fn(),
  });
  return render(
    <TransactionListScreen route={{} as never} navigation={{ navigate: jest.fn() } as never} />,
  );
}

describe('TransactionListScreen — refund rows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a refund as "+R 25,00" with an explicit "Refund" label, not colour alone', () => {
    const { getByTestId, getByText } = renderWith([
      tx({ id: 'tx-r', amountCents: -2500, payee: 'Checkers refund' }),
    ]);

    // The label carries the meaning in words — a greyscale screenshot or a
    // colour-blind reader loses nothing.
    expect(getByTestId('tx-refund-label-tx-r')).toBeTruthy();
    expect(getByText('Refund')).toBeTruthy();
    // CurrencyText's default rendering of a negative is "-R 25,00"; a refund
    // must read as money coming BACK.
    expect(getByText(`+${formatCurrency(2500)}`)).toBeTruthy();
  });

  it('leaves an ordinary purchase unsigned and unlabelled', () => {
    const { queryByTestId, getByText } = renderWith([tx({ id: 'tx-p', amountCents: 5000 })]);

    expect(queryByTestId('tx-refund-label-tx-p')).toBeNull();
    expect(getByText(formatCurrency(5000))).toBeTruthy();
  });

  it('gives the refund row an accessibility label that says "refund" in words', () => {
    const { getByTestId } = renderWith([
      tx({ id: 'tx-r', amountCents: -2500, payee: 'Checkers refund' }),
    ]);

    const label = String(getByTestId('tx-row-tx-r').props.accessibilityLabel).toLowerCase();
    expect(label).toContain('refund');
  });

  it('keeps the ordinary "Edit transaction …" label on a purchase row', () => {
    const { getByTestId } = renderWith([tx({ id: 'tx-p', amountCents: 5000 })]);
    expect(getByTestId('tx-row-tx-p').props.accessibilityLabel).toBe('Edit transaction Woolworths');
  });
});

describe('TransactionListScreen — the period total nets refunds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('nets a purchase and an equal refund to zero', () => {
    const { getByTestId } = renderWith([
      tx({ id: 'tx-1', amountCents: 25000 }),
      tx({ id: 'tx-2', amountCents: -25000, payee: 'Refunded' }),
    ]);

    expect(getByTestId('period-total').props.children).toBe(
      `Spent this period: ${formatCurrency(0)}`,
    );
  });

  it('subtracts a partial refund from the period total', () => {
    const { getByTestId } = renderWith([
      tx({ id: 'tx-1', amountCents: 25000 }),
      tx({ id: 'tx-2', amountCents: -10000, payee: 'Partial refund' }),
    ]);

    expect(getByTestId('period-total').props.children).toBe(
      `Spent this period: ${formatCurrency(15000)}`,
    );
  });

  it('goes negative when the period is refund-heavy, rather than clamping at zero', () => {
    const { getByTestId } = renderWith([
      tx({ id: 'tx-1', amountCents: 10000 }),
      tx({ id: 'tx-2', amountCents: -30000, payee: 'Big refund' }),
    ]);

    expect(getByTestId('period-total').props.children).toBe(
      `Spent this period: ${formatCurrency(-20000)}`,
    );
  });
});

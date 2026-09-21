/**
 * TransactionListScreen.income.test.tsx — MONEY IN on the list
 *
 * The real household this exists for has 50 salary deposits recorded as
 * transactions against an INCOME envelope ("Nedbank"). Those rows are money
 * IN: they must never be summed into "Spent this period", they must read
 * unmistakably as income (word + sign + colour, never colour alone), and they
 * must stay visually and verbally DISTINCT from a refund (a negative amount
 * on a spending envelope), which is a different thing.
 *
 * Like the refund suite, this does NOT mock `CurrencyText` away — the
 * rendered amount string is part of what is under test.
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
        where: jest.fn().mockResolvedValue([
          { id: 'env-spend', name: 'Food', envelopeType: 'spending' },
          { id: 'env-income', name: 'Nedbank', envelopeType: 'income' },
        ]),
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
    sel({ householdId: 'hh-1', paydayDay: 20 }),
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
    envelopeId: 'env-spend',
    amountCents: 5000,
    payee: 'Woolworths',
    description: null,
    transactionDate: '2026-08-25',
    spendingTriggerNote: null,
    isBusinessExpense: false,
    createdAt: '2026-08-25T10:00:00Z',
    updatedAt: '2026-08-25T10:00:00Z',
    ...over,
  };
}

async function renderWith(transactions: unknown[]) {
  mockUseTransactions.mockReturnValue({
    transactions,
    loading: false,
    refreshing: false,
    error: null,
    reload: jest.fn(),
  });
  const utils = render(
    <TransactionListScreen route={{} as never} navigation={{ navigate: jest.fn() } as never} />,
  );
  // The envelope-type lookup resolves on a microtask; everything under test
  // here depends on it having landed.
  await utils.findByTestId('period-total');
  return utils;
}

const SALARY = tx({
  id: 'tx-salary',
  envelopeId: 'env-income',
  amountCents: 3_500_00,
  payee: 'Salary',
});

describe('TransactionListScreen — income rows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a salary deposit as "+R …" with the literal word "Income"', async () => {
    const { findByTestId, findByText } = await renderWith([SALARY]);

    expect(await findByTestId('tx-income-label-tx-salary')).toBeTruthy();
    expect(await findByText('Income')).toBeTruthy();
    expect(await findByText(`+${formatCurrency(3_500_00)}`)).toBeTruthy();
  });

  it('never labels a salary deposit "Refund"', async () => {
    const { queryByTestId, queryByText } = await renderWith([SALARY]);

    expect(queryByTestId('tx-refund-label-tx-salary')).toBeNull();
    expect(queryByText('Refund')).toBeNull();
  });

  it('keeps income and refund visually and verbally distinct in the same list', async () => {
    const { findByTestId } = await renderWith([
      SALARY,
      tx({ id: 'tx-refund', amountCents: -2500, payee: 'Checkers refund' }),
    ]);

    expect(await findByTestId('tx-income-label-tx-salary')).toBeTruthy();
    expect(await findByTestId('tx-refund-label-tx-refund')).toBeTruthy();
    expect(await findByTestId('tx-income-label-tx-salary')).not.toBe(
      await findByTestId('tx-refund-label-tx-refund'),
    );
  });

  it('says "income" in words in the row accessibility label', async () => {
    const { findByTestId } = await renderWith([SALARY]);

    const label = String((await findByTestId('tx-row-tx-salary')).props.accessibilityLabel);
    expect(label.toLowerCase()).toContain('income');
    expect(label.toLowerCase()).not.toContain('refund');
  });
});

describe('TransactionListScreen — Spent and Received are separate totals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never counts a salary deposit as spending', async () => {
    const { findByTestId } = await renderWith([tx({ amountCents: 25_000 }), SALARY]);

    expect((await findByTestId('period-total')).props.children).toBe(
      `Spent this period: ${formatCurrency(25_000)}`,
    );
  });

  it('shows the money that came IN on its own line, not netted into Spent', async () => {
    const { findByTestId } = await renderWith([tx({ amountCents: 25_000 }), SALARY]);

    expect((await findByTestId('period-received')).props.children).toBe(
      `Received this period: ${formatCurrency(3_500_00)}`,
    );
  });

  it('omits the Received line entirely for an ordinary spending-only period', async () => {
    const { queryByTestId } = await renderWith([tx({ amountCents: 25_000 })]);

    expect(queryByTestId('period-received')).toBeNull();
  });

  it('still nets a refund down out of Spent while income stays out of it', async () => {
    const { findByTestId } = await renderWith([
      tx({ amountCents: 25_000 }),
      tx({ id: 'tx-refund', amountCents: -10_000, payee: 'Partial refund' }),
      SALARY,
    ]);

    expect((await findByTestId('period-total')).props.children).toBe(
      `Spent this period: ${formatCurrency(15_000)}`,
    );
    expect((await findByTestId('period-received')).props.children).toBe(
      `Received this period: ${formatCurrency(3_500_00)}`,
    );
  });
});

/**
 * AddTransactionScreen.editMode.test.tsx — UX-9 / VAL-9 / VAL-13
 *
 * Covers what AddTransactionScreen.test.tsx's simpler single-shape db mock
 * can't: edit mode (route.params.transactionId — load + prefill + Update),
 * VAL-9's create-mode envelopeId preselect, and VAL-13's 80%/100% usage
 * toast. Uses a small fake query engine (keyed by table + `eq(id, ...)`)
 * instead of one static row set, since edit mode issues three DIFFERENT
 * `db.select` queries (the transaction row, its envelope by id, and the
 * period's envelope list).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: mockGoBack }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);
  const TextInput = ({
    label,
    value,
    onChangeText,
    testID,
    ...p
  }: {
    label?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('TextInput', { testID: testID ?? label, value, onChangeText, ...p });
  TextInput.Affix = () => null;
  const Button = ({
    children,
    onPress,
    testID,
    disabled,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, disabled, ...p },
      React.createElement('Text', {}, children),
    );
  const Snackbar = ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
    visible ? React.createElement('Text', { testID: 'snackbar-error' }, children) : null;
  const TouchableRipple = ({
    children,
    onPress,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('TouchableOpacity', { onPress, testID, ...p }, children);
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  return { Text, TextInput, Button, Snackbar, TouchableRipple, Surface };
});

// ─── DateTimePicker mock ──────────────────────────────────────────────────────
jest.mock('@react-native-community/datetimepicker', () => () => null);

// ─── appStore / toastStore mocks ──────────────────────────────────────────────
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector: (s: object) => unknown) => selector({ enqueue: mockEnqueue })),
}));

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...args: unknown[]) => args),
  eq: jest.fn((col: unknown, val: unknown) => ({ col, val })),
  ne: jest.fn((col: unknown, val: unknown) => ({ col, val })),
}));

// ─── Schema mock ──────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/schema', () => ({
  envelopes: {
    __table: 'envelopes',
    id: 'id',
    name: 'name',
    allocatedCents: 'allocatedCents',
    envelopeType: 'envelopeType',
    householdId: 'householdId',
    periodStart: 'periodStart',
    isArchived: 'isArchived',
  },
  transactions: {
    __table: 'transactions',
    id: 'id',
    householdId: 'householdId',
    envelopeId: 'envelopeId',
    amountCents: 'amountCents',
    payee: 'payee',
    description: 'description',
    transactionDate: 'transactionDate',
    isBusinessExpense: 'isBusinessExpense',
  },
}));

// ─── EnvelopeBalanceQuery mock ────────────────────────────────────────────────
let mockSpentByEnvelope: Record<string, number> = {};
jest.mock('../../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn(() =>
    Promise.resolve(new Map(Object.entries(mockSpentByEnvelope))),
  ),
  envelopeScopeCondition: jest.fn(() => 'scope-condition'),
}));

// ─── AuditLogger mock ─────────────────────────────────────────────────────────
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

// ─── SpendingCoach mock ───────────────────────────────────────────────────────
// Bypassed so an over-budget save in the VAL-13 tests goes straight to
// doSave instead of surfacing the (separate, unrelated) coaching modal.
jest.mock('../../../../domain/coaching/SpendingCoach', () => ({
  SpendingCoach: jest.fn().mockImplementation(() => ({
    evaluate: jest.fn().mockReturnValue(null),
  })),
}));

// ─── BudgetPeriodEngine mock ──────────────────────────────────────────────────
jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    })),
  })),
  formatPeriodDateKey: (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
}));

// ─── CreateTransactionUseCase / UpdateTransactionUseCase mocks ────────────────
const mockCreateExecute = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../../domain/transactions/CreateTransactionUseCase', () => ({
  CreateTransactionUseCase: jest.fn().mockImplementation(() => ({ execute: mockCreateExecute })),
}));
const mockUpdateExecute = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../../domain/transactions/UpdateTransactionUseCase', () => ({
  UpdateTransactionUseCase: jest.fn().mockImplementation((..._args: unknown[]) => ({
    execute: mockUpdateExecute,
  })),
}));

// ─── DB mock: a tiny fake query engine keyed by table + eq(id, ...) ──────────
jest.mock('../../../../data/local/db', () => ({ db: { select: jest.fn() } }));
jest.mock('../../../../infrastructure/notifications/HouseholdNotifier', () => ({
  householdNotifier: { notifyHousehold: jest.fn() },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db: mockDb } = require('../../../../data/local/db');
const { householdNotifier: mockHouseholdNotifier } = jest.requireMock(
  '../../../../infrastructure/notifications/HouseholdNotifier',
) as { householdNotifier: { notifyHousehold: jest.Mock } };

let envelopesById: Record<string, Record<string, unknown>> = {};
let transactionsById: Record<string, Record<string, unknown>> = {};

/** Extracts the value of an `eq(table.<colName>, value)` condition from a `.where(and(...))` arg. */
function extractEqValue(condition: unknown, colName: string): unknown {
  const conditions = Array.isArray(condition) ? condition : [condition];
  for (const c of conditions) {
    if (c && typeof c === 'object' && (c as { col?: unknown }).col === colName) {
      return (c as { val: unknown }).val;
    }
  }
  return undefined;
}

function makeQueryResult(
  rows: unknown[],
): Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> } {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & {
    limit: (n: number) => Promise<unknown[]>;
  };
  promise.limit = (n: number) => Promise.resolve(rows.slice(0, n));
  return promise;
}

function setupDb(): void {
  mockDb.select.mockImplementation(() => ({
    from: (table: { __table: string }) => ({
      where: (condition: unknown) => {
        if (table.__table === 'transactions') {
          const id = extractEqValue(condition, 'id') as string | undefined;
          const row = id ? transactionsById[id] : undefined;
          return makeQueryResult(row ? [row] : []);
        }
        // envelopes table: an `id` filter means a single-envelope lookup
        // (loadEnvelopeOption); no `id` filter means the picker's list query.
        const id = extractEqValue(condition, 'id') as string | undefined;
        if (id !== undefined) {
          const row = envelopesById[id];
          return makeQueryResult(row ? [row] : []);
        }
        return makeQueryResult(Object.values(envelopesById));
      },
    }),
  }));
}

import { AddTransactionScreen } from '../AddTransactionScreen';

const makeNavProps = (params?: { transactionId?: string; envelopeId?: string }) => ({
  navigation: {
    goBack: mockGoBack,
    navigate: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    isFocused: jest.fn(() => true),
    getId: jest.fn(),
    getParent: jest.fn(),
    getState: jest.fn(),
    setOptions: jest.fn(),
    setParams: jest.fn(),
    dispatch: jest.fn(),
    canGoBack: jest.fn(() => true),
    removeListener: jest.fn(),
  } as any,
  route: { key: 'AddTransaction', name: 'AddTransaction', params } as any,
});

// The first render pays this screen's whole module-load cost; on a loaded CI
// worker that alone can exceed jest's 5s default.
jest.setTimeout(15000);

describe('AddTransactionScreen — edit mode (UX-9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExecute.mockResolvedValue({ success: true });
    mockUpdateExecute.mockResolvedValue({ success: true });
    envelopesById = {
      'env-1': {
        id: 'env-1',
        name: 'Groceries',
        allocatedCents: 100000,
        envelopeType: 'spending',
      },
    };
    transactionsById = {
      'tx-1': {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'env-1',
        amountCents: 5000,
        payee: 'Pick n Pay',
        description: 'Snacks',
        transactionDate: '2026-04-10',
        isBusinessExpense: false,
        slipId: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
    };
    mockSpentByEnvelope = { 'env-1': 20000 };
    setupDb();
  });

  it('sets the title to "Edit transaction" and prefills the form', async () => {
    const navProps = makeNavProps({ transactionId: 'tx-1' });
    const { getByTestId } = render(<AddTransactionScreen {...navProps} />);

    await waitFor(() => {
      expect(getByTestId('amount-input').props.value).toBe('50.00');
    });
    expect(getByTestId('payee-input').props.value).toBe('Pick n Pay');
    expect(getByTestId('description-input').props.value).toBe('Snacks');
    expect(navProps.navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit transaction' });
  });

  it('shows "Save Changes" instead of "Record Transaction" in edit mode', async () => {
    const { getByText, queryByText } = render(
      <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-1' })} />,
    );
    await waitFor(() => expect(getByText('Save Changes')).toBeTruthy());
    expect(queryByText('Record Transaction')).toBeNull();
  });

  it('does not show the "Scan slip" button in edit mode', async () => {
    const { queryByTestId, findByTestId } = render(
      <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-1' })} />,
    );
    await findByTestId('amount-input');
    expect(queryByTestId('scan-slip-button')).toBeNull();
  });

  it('Save calls UpdateTransactionUseCase, not CreateTransactionUseCase', async () => {
    const { getByTestId, getByText, findByTestId } = render(
      <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-1' })} />,
    );
    await findByTestId('amount-input');
    fireEvent.changeText(getByTestId('amount-input'), '75');
    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateExecute).toHaveBeenCalled());
    expect(mockCreateExecute).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith('Transaction updated', 'success');
    // VAL-6/DB-7: an edit is not a new spend — must not wake the household.
    expect(mockHouseholdNotifier.notifyHousehold).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transaction_created' }),
    );
  });

  it('shows an error and does not navigate back when the update fails', async () => {
    mockUpdateExecute.mockResolvedValue({
      success: false,
      error: { code: 'TRANSACTION_DELETED', message: 'Cannot edit a deleted transaction' },
    });
    const { getByTestId, getByText, findByTestId } = render(
      <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-1' })} />,
    );
    await findByTestId('amount-input');
    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => expect(getByTestId('snackbar-error')).toBeTruthy());
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe('AddTransactionScreen — VAL-9 create-mode envelope preselect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExecute.mockResolvedValue({ success: true });
    envelopesById = {
      'env-2': {
        id: 'env-2',
        name: 'Transport',
        allocatedCents: 50000,
        envelopeType: 'spending',
      },
    };
    transactionsById = {};
    mockSpentByEnvelope = { 'env-2': 10000 };
    setupDb();
  });

  it('preselects the envelope passed via route params', async () => {
    const { getByText } = render(
      <AddTransactionScreen {...makeNavProps({ envelopeId: 'env-2' })} />,
    );
    await waitFor(() => {
      expect(getByText('Transport')).toBeTruthy();
    });
  });
});

describe('AddTransactionScreen — VAL-13 envelope usage threshold toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExecute.mockResolvedValue({ success: true });
    mockUpdateExecute.mockResolvedValue({ success: true });
    envelopesById = {
      'env-1': {
        id: 'env-1',
        name: 'Groceries',
        allocatedCents: 10000, // R100
        envelopeType: 'spending',
      },
    };
    transactionsById = {};
    setupDb();
  });

  it('shows the 80%-used toast when this save crosses from under 80% to at/over 80%', async () => {
    mockSpentByEnvelope = { 'env-1': 7000 }; // 70% before this save
    const { getByTestId, getByText } = render(
      <AddTransactionScreen {...makeNavProps({ envelopeId: 'env-1' })} />,
    );
    await waitFor(() => expect(getByText('Groceries')).toBeTruthy());

    fireEvent.changeText(getByTestId('amount-input'), '10'); // +1000 cents -> 80%
    fireEvent.press(getByText('Record Transaction'));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith("You've used 80% of Groceries", 'regression');
    });
    // VAL-6/DB-7: only the 100% crossing wakes the household, not 80%.
    expect(mockHouseholdNotifier.notifyHousehold).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'envelope_over_budget' }),
    );
  });

  it('shows the over-budget toast when this save crosses 100%', async () => {
    mockSpentByEnvelope = { 'env-1': 9000 }; // 90% before this save
    const { getByTestId, getByText } = render(
      <AddTransactionScreen {...makeNavProps({ envelopeId: 'env-1' })} />,
    );
    await waitFor(() => expect(getByText('Groceries')).toBeTruthy());

    fireEvent.changeText(getByTestId('amount-input'), '15'); // +1500 cents -> 105%
    fireEvent.press(getByText('Record Transaction'));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.stringContaining('Groceries is over budget by'),
        'error',
      );
    });
    // VAL-6/DB-7: the 100% crossing wakes the household; 80% does not (see
    // the 80% test above, which asserts no notifyHousehold call at all).
    expect(mockHouseholdNotifier.notifyHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'envelope_over_budget' }),
    );
  });

  it('does not re-fire the toast on a save that keeps the envelope above a threshold it already crossed', async () => {
    mockSpentByEnvelope = { 'env-1': 8500 }; // already at 85%, past the 80% line
    const { getByTestId, getByText } = render(
      <AddTransactionScreen {...makeNavProps({ envelopeId: 'env-1' })} />,
    );
    await waitFor(() => expect(getByText('Groceries')).toBeTruthy());

    fireEvent.changeText(getByTestId('amount-input'), '5'); // +500 cents -> 90%, still under 100
    fireEvent.press(getByText('Record Transaction'));

    await waitFor(() => expect(mockCreateExecute).toHaveBeenCalled());
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.stringContaining('80%'), 'regression');
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.stringContaining('over budget'), 'error');
  });

  it('does not show a threshold toast for a persistent-scope envelope', async () => {
    envelopesById = {
      'env-3': {
        id: 'env-3',
        name: 'Emergency Fund',
        allocatedCents: 10000,
        envelopeType: 'emergency_fund',
      },
    };
    mockSpentByEnvelope = { 'env-3': 9000 };
    setupDb();
    const { getByTestId, getByText } = render(
      <AddTransactionScreen {...makeNavProps({ envelopeId: 'env-3' })} />,
    );
    await waitFor(() => expect(getByText('Emergency Fund')).toBeTruthy());

    fireEvent.changeText(getByTestId('amount-input'), '15'); // would cross 100% if it were period-scoped
    fireEvent.press(getByText('Record Transaction'));

    await waitFor(() => expect(mockCreateExecute).toHaveBeenCalled());
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.stringContaining('over budget'), 'error');
  });

  it("subtracts this transaction's own old amount before evaluating the threshold on an edit", async () => {
    // Editing tx-1 (currently 5000 cents on env-1, ledger total 9000 already
    // includes it) up to 6000 cents must compare against the 4000-cent
    // baseline (9000 - 5000), not the raw 9000 ledger total, or every edit
    // would double count this transaction's own money.
    transactionsById = {
      'tx-1': {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'env-1',
        amountCents: 5000,
        payee: 'Pick n Pay',
        description: null,
        transactionDate: '2026-04-10',
        isBusinessExpense: false,
      },
    };
    mockSpentByEnvelope = { 'env-1': 9000 }; // includes tx-1's own 5000 -> baseline 4000 (40%)
    setupDb();
    const { getByTestId, getByText, findByTestId } = render(
      <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-1' })} />,
    );
    await findByTestId('amount-input');

    fireEvent.changeText(getByTestId('amount-input'), '60'); // baseline 4000 + 6000 = 10000 -> 100%
    fireEvent.press(getByText('Save Changes'));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.stringContaining('Groceries is over budget by'),
        'error',
      );
    });
  });
});

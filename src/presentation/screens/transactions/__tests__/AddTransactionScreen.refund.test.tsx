/**
 * AddTransactionScreen.refund.test.tsx — REFUNDS
 *
 * A refund / reversal / store credit is recorded as a transaction with a
 * NEGATIVE amountCents. The Amount field stays a plain positive number; the
 * "Refund" toggle is what decides the sign at save time.
 *
 * Covers, in create mode and edit mode:
 *   - the toggle flips the sign passed to Create/UpdateTransactionUseCase;
 *   - button + title copy ("Record Refund");
 *   - the "left after this" preview goes UP, not down;
 *   - a refund can NEVER raise the over-budget toast, the household
 *     over-budget push, or the cover-from-envelope flow (the coach is not
 *     even consulted), even when the envelope is already over its allocation;
 *   - edit mode loads a negative row as Refund ON with the ABSOLUTE amount.
 *
 * Harness is the same fake query engine as
 * AddTransactionScreen.editMode.test.tsx (table + `eq(id, ...)`), because
 * these cases need both the edit-mode row load and the picker's list query.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockGoBack = jest.fn();
jest.mock('../../../boot/eveningLogPrompt', () => ({
  rearmEveningLogPrompt: jest.fn().mockResolvedValue(undefined),
  rearmBudgetNudges: jest.fn().mockResolvedValue(undefined),
}));
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
    selector({ householdId: 'hh-1', paydayDay: 25, session: { user: { id: 'user-1' } } }),
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
  isNull: jest.fn((col: unknown) => ({ isNull: col })),
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
    deletedAt: 'deletedAt',
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

jest.mock('../../../hooks/usePersistentEnvelopeSavings', () => ({
  usePersistentEnvelopeSavings: jest.fn(() => ({
    savedCentsByEnvelopeId: new Map(),
    loading: false,
    error: null,
    reload: jest.fn(),
  })),
}));

jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../../../domain/transactions/DeleteTransactionUseCase', () => ({
  DeleteTransactionUseCase: jest
    .fn()
    .mockImplementation(() => ({ execute: jest.fn().mockResolvedValue({ success: true }) })),
}));

jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

// ─── SpendingCoach ────────────────────────────────────────────────────────────
// NOT stubbed out to `null` here: several cases below assert that a refund
// never even CONSULTS the coach, which a blanket "returns null" stub would
// hide. The mock records its calls and returns whatever the test queues.
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

// ─── Create / Update use case mocks ───────────────────────────────────────────
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

// ─── DB mock: the same fake query engine as the edit-mode suite ──────────────
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
import { formatCurrency } from '../../../utils/currency';

const { CreateTransactionUseCase: MockCreateTransactionUseCase } = jest.requireMock(
  '../../../../domain/transactions/CreateTransactionUseCase',
) as { CreateTransactionUseCase: jest.Mock };
const { UpdateTransactionUseCase: MockUpdateTransactionUseCase } = jest.requireMock(
  '../../../../domain/transactions/UpdateTransactionUseCase',
) as { UpdateTransactionUseCase: jest.Mock };

// `coach = new SpendingCoach()` is a MODULE-LEVEL singleton constructed once
// on import — captured here, before any `jest.clearAllMocks()` wipes the
// constructor mock's recorded results (same reasoning as the edit-mode suite).
const { SpendingCoach: MockSpendingCoach } = jest.requireMock(
  '../../../../domain/coaching/SpendingCoach',
) as { SpendingCoach: jest.Mock };
const sharedCoachInstance = MockSpendingCoach.mock.results[0]!.value as { evaluate: jest.Mock };

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

/** Flips the "Refund" switch on. */
function turnRefundOn(getByTestId: (id: string) => { props: Record<string, unknown> }): void {
  fireEvent(getByTestId('refund-toggle') as never, 'valueChange', true);
}

// The first render pays this screen's whole module-load cost.
jest.setTimeout(15000);

describe('AddTransactionScreen — refunds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExecute.mockResolvedValue({ success: true });
    mockUpdateExecute.mockResolvedValue({ success: true });
    sharedCoachInstance.evaluate.mockReturnValue(null);
    envelopesById = {
      'env-1': {
        id: 'env-1',
        name: 'Groceries',
        allocatedCents: 100000,
        envelopeType: 'spending',
      },
    };
    transactionsById = {};
    mockSpentByEnvelope = { 'env-1': 20000 };
    setupDb();
  });

  describe('create mode', () => {
    it('saves a NEGATIVE amountCents when the refund toggle is on', async () => {
      const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      fireEvent.changeText(getByTestId('amount-input'), '25.00');
      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Record Refund'));

      await waitFor(() => expect(MockCreateTransactionUseCase).toHaveBeenCalled());
      expect(MockCreateTransactionUseCase.mock.calls[0][2]).toMatchObject({
        amountCents: -2500,
        envelopeId: 'env-1',
      });
    });

    it('still saves a POSITIVE amount with the toggle off (the field itself never carries a sign)', async () => {
      const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      fireEvent.changeText(getByTestId('amount-input'), '25.00');
      fireEvent.press(getByText('Record Transaction'));

      await waitFor(() => expect(MockCreateTransactionUseCase).toHaveBeenCalled());
      expect(MockCreateTransactionUseCase.mock.calls[0][2]).toMatchObject({ amountCents: 2500 });
    });

    it('switches the button and screen title copy to "Record Refund"', async () => {
      const navProps = makeNavProps();
      const { getByTestId, getByText, queryByText } = render(
        <AddTransactionScreen {...navProps} />,
      );
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      expect(getByText('Record Transaction')).toBeTruthy();
      turnRefundOn(getByTestId);

      expect(getByText('Record Refund')).toBeTruthy();
      expect(queryByText('Record Transaction')).toBeNull();
      await waitFor(() =>
        expect(navProps.navigation.setOptions).toHaveBeenCalledWith({ title: 'Record Refund' }),
      );
    });

    it('carries an accessibilityLabel that says "Refund" in words, not colour alone', async () => {
      const { getByTestId } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());
      expect(String(getByTestId('refund-toggle').props.accessibilityLabel)).toContain('Refund');
    });

    it('makes the "left after this" preview go UP, not down', async () => {
      const { getByTestId } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      // allocated 100000 - spent 20000 = 80000 left before this.
      fireEvent.changeText(getByTestId('amount-input'), '250.00');
      await waitFor(() =>
        expect(getByTestId('after-this-preview').props.children).toContain(formatCurrency(55000)),
      );

      turnRefundOn(getByTestId);
      await waitFor(() =>
        expect(getByTestId('after-this-preview').props.children).toContain(formatCurrency(105000)),
      );
    });

    it('never consults the SpendingCoach for a refund, so the cover-from-envelope flow is unreachable', async () => {
      // A coach that would ALWAYS fire if it were asked. If the refund path
      // consulted it, the coaching modal (and with it the cover flow) would
      // open instead of saving.
      sharedCoachInstance.evaluate.mockReturnValue({
        message: 'over budget',
        overspendCents: 5000,
        scope: 'period',
      });

      const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      fireEvent.changeText(getByTestId('amount-input'), '250.00');
      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Record Refund'));

      await waitFor(() => expect(mockCreateExecute).toHaveBeenCalled());
      expect(sharedCoachInstance.evaluate).not.toHaveBeenCalled();
    });

    // HONEST NOTE: this one is a guard/characterisation test, not a red-then-
    // green one. `detectThresholdCrossing` only fires when usage moves UP
    // across the line, and a negative amount can only ever move it DOWN, so
    // it is already unreachable for a refund by arithmetic alone — the
    // explicit `amountCents > 0` gate in `doSave` is belt-and-braces that
    // keeps it that way if the before/after figures are ever reworked. It is
    // kept because that invariant is the one the feature brief calls out.
    it('never raises the over-budget toast or the household over-budget push, even on an already-overspent envelope', async () => {
      mockSpentByEnvelope = { 'env-1': 150000 };
      setupDb();

      const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      fireEvent.changeText(getByTestId('amount-input'), '250.00');
      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Record Refund'));

      await waitFor(() => expect(mockCreateExecute).toHaveBeenCalled());

      const toasts = mockEnqueue.mock.calls.map((c) => String(c[0]));
      expect(toasts).toContain('Transaction saved');
      expect(toasts.some((t) => t.includes('over budget'))).toBe(false);
      expect(toasts.some((t) => t.includes('80%'))).toBe(false);

      const pushKinds = mockHouseholdNotifier.notifyHousehold.mock.calls.map(
        (c) => (c[0] as { kind: string }).kind,
      );
      expect(pushKinds).not.toContain('envelope_over_budget');
    });

    it('does not post the "new spend" household push for a refund (that push requires a positive amount)', async () => {
      const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      fireEvent.changeText(getByTestId('amount-input'), '25.00');
      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Record Refund'));

      await waitFor(() => expect(mockCreateExecute).toHaveBeenCalled());
      const pushKinds = mockHouseholdNotifier.notifyHousehold.mock.calls.map(
        (c) => (c[0] as { kind: string }).kind,
      );
      expect(pushKinds).not.toContain('transaction_created');
    });

    it('posts refund_recorded with the POSITIVE magnitude of the refund on create', async () => {
      const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      fireEvent.changeText(getByTestId('amount-input'), '25.00');
      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Record Refund'));

      await waitFor(() => expect(mockCreateExecute).toHaveBeenCalled());
      expect(mockHouseholdNotifier.notifyHousehold).toHaveBeenCalledTimes(1);
      expect(mockHouseholdNotifier.notifyHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'refund_recorded', amountCents: 2500 }),
      );
    });

    it('still rejects an empty amount with the toggle on (the field stays a positive number)', async () => {
      const { getByTestId, getByText, queryByTestId } = render(
        <AddTransactionScreen {...makeNavProps()} />,
      );
      await waitFor(() => expect(getByTestId('refund-toggle')).toBeTruthy());

      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Record Refund'));

      await waitFor(() => expect(queryByTestId('snackbar-error')).toBeTruthy());
      expect(MockCreateTransactionUseCase).not.toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      transactionsById = {
        'tx-refund': {
          id: 'tx-refund',
          householdId: 'hh-1',
          envelopeId: 'env-1',
          amountCents: -2500,
          payee: 'Checkers refund',
          description: 'Returned the milk',
          transactionDate: '2026-04-10',
          isBusinessExpense: false,
          slipId: null,
          createdAt: '2026-04-10T00:00:00.000Z',
          updatedAt: '2026-04-10T00:00:00.000Z',
        },
        'tx-purchase': {
          id: 'tx-purchase',
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
      setupDb();
    });

    it('loads a negative row as Refund ON with the ABSOLUTE amount in the field', async () => {
      const { getByTestId } = render(
        <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-refund' })} />,
      );

      await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('25.00'));
      expect(getByTestId('refund-toggle').props.value).toBe(true);
    });

    it('loads a positive row as Refund OFF', async () => {
      const { getByTestId } = render(
        <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-purchase' })} />,
      );

      await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('50.00'));
      expect(getByTestId('refund-toggle').props.value).toBe(false);
    });

    it('keeps the amount negative when re-saving a loaded refund unchanged', async () => {
      const { getByTestId, getByText } = render(
        <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-refund' })} />,
      );
      await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('25.00'));

      fireEvent.press(getByText('Save Changes'));

      await waitFor(() => expect(MockUpdateTransactionUseCase).toHaveBeenCalled());
      expect(MockUpdateTransactionUseCase.mock.calls[0][3]).toMatchObject({ amountCents: -2500 });
    });

    it('does not post refund_recorded when editing an existing refund (an edit is not a new refund)', async () => {
      const { getByTestId, getByText } = render(
        <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-refund' })} />,
      );
      await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('25.00'));

      fireEvent.press(getByText('Save Changes'));

      await waitFor(() => expect(MockUpdateTransactionUseCase).toHaveBeenCalled());
      expect(mockHouseholdNotifier.notifyHousehold).not.toHaveBeenCalled();
    });

    it('turns a loaded purchase into a refund when the toggle is switched on', async () => {
      const { getByTestId, getByText } = render(
        <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-purchase' })} />,
      );
      await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('50.00'));

      turnRefundOn(getByTestId);
      fireEvent.press(getByText('Save Changes'));

      await waitFor(() => expect(MockUpdateTransactionUseCase).toHaveBeenCalled());
      expect(MockUpdateTransactionUseCase.mock.calls[0][3]).toMatchObject({ amountCents: -5000 });
    });

    it('keeps the edit-mode button copy as "Save Changes" for a refund', async () => {
      const { getByTestId, getByText, queryByText } = render(
        <AddTransactionScreen {...makeNavProps({ transactionId: 'tx-refund' })} />,
      );
      await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('25.00'));

      expect(getByText('Save Changes')).toBeTruthy();
      expect(queryByText('Record Refund')).toBeNull();
    });
  });
});

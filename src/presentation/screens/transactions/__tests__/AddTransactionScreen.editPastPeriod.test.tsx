/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AddTransactionScreen.editPastPeriod.test.tsx — E-1.
 *
 * EDIT mode read every balance on this screen under
 * `engine.getCurrentPeriod(...)`, even when the transaction being edited
 * belongs to a PAST period's envelope. `getEnvelopeSpentCents` only returns
 * envelopes in scope for the period it is asked about, so that envelope came
 * back absent and its spend read as 0 — a wrong "left after this" preview
 * and an over-budget threshold measured from the wrong starting point, which
 * could fire a false `envelope_over_budget` household push.
 *
 * And even a CORRECT over-budget reading about a period that has already
 * closed is noise on the partner's phone, so the household notifier is
 * suppressed for a past-period edit while current-period edits keep it.
 *
 * Exercises the REAL `getEnvelopeSpentCents` against a REAL migrated
 * better-sqlite3 database — mirroring AddTransactionScreen.periodScope
 * .test.tsx — so it proves the period actually used for the lookup rather
 * than a mock's return value.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const HOUSEHOLD = 'hh-1';
const PAST_PERIOD = '2026-08-01';
const CURRENT_PERIOD = '2026-09-01';
const NOW = '2026-01-01T00:00:00.000Z';

// Variable name must be prefixed with `mock` so babel-plugin-jest-hoist
// allows referencing it from inside the (hoisted) jest.mock factory below.
let mockRawDb: Database.Database;

jest.mock('../../../boot/eveningLogPrompt', () => ({
  rearmEveningLogPrompt: jest.fn().mockResolvedValue(undefined),
  rearmBudgetNudges: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../infrastructure/notifications/HouseholdNotifier', () => ({
  householdNotifier: { notifyHousehold: jest.fn() },
}));

jest.mock('../../../../data/local/db', () => {
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { openMigratedDb } = require('../../../../../tests/realsql/harness/openMigratedDb');
  const schema = require('../../../../data/local/schema');
  const raw = openMigratedDb();
  mockRawDb = raw;
  return { db: drizzle(raw, { schema }) };
});

jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

const mockUpdateExecute = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../../domain/transactions/UpdateTransactionUseCase', () => ({
  UpdateTransactionUseCase: jest.fn().mockImplementation(() => ({ execute: mockUpdateExecute })),
}));

// Bypassed so an over-budget save goes straight to doSave instead of
// surfacing the (separate, unrelated) coaching modal.
jest.mock('../../../../domain/coaching/SpendingCoach', () => ({
  SpendingCoach: jest.fn().mockImplementation(() => ({ evaluate: jest.fn(() => null) })),
}));

jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date(`${CURRENT_PERIOD}T00:00:00.000Z`),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    })),
  })),
  formatPeriodDateKey: (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
}));

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: HOUSEHOLD, paydayDay: 25 }),
  ),
}));

const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector: (s: object) => unknown) => selector({ enqueue: mockEnqueue })),
}));

jest.mock('@react-native-community/datetimepicker', () => () => null);

jest.mock('react-native-paper', () => {
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
  const Snackbar = ({
    visible,
    children,
  }: {
    visible?: boolean;
    children?: React.ReactNode;
    [k: string]: unknown;
  }) => (visible ? React.createElement('Text', { testID: 'snackbar-error' }, children) : null);
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

import { AddTransactionScreen } from '../AddTransactionScreen';
import { formatCurrency } from '../../../utils/currency';

const { householdNotifier: mockHouseholdNotifier } = jest.requireMock(
  '../../../../infrastructure/notifications/HouseholdNotifier',
) as { householdNotifier: { notifyHousehold: jest.Mock } };

function seedHousehold(raw: Database.Database): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 25, ?, ?)`,
    )
    .run(HOUSEHOLD, NOW, NOW);
}

function seedEnvelope(
  raw: Database.Database,
  args: { id: string; name: string; allocatedCents: number; periodStart: string },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'spending', 0, 0, ?, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.name, args.allocatedCents, args.periodStart, NOW, NOW);
}

function seedTransaction(
  raw: Database.Database,
  args: { id: string; envelopeId: string; amountCents: number; date: string },
): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, transaction_date,
          is_business_expense, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.envelopeId, args.amountCents, args.date, NOW, NOW);
}

const makeNavProps = (transactionId: string) => ({
  navigation: {
    goBack: jest.fn(),
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
  } as never,
  route: { key: 'AddTransaction', name: 'AddTransaction', params: { transactionId } } as never,
});

/**
 * One transaction of `editedAmountCents` plus one other spend of
 * `otherSpendCents`, both on a `spending` envelope belonging to
 * `envelopePeriodStart`. Two extra CURRENT-period envelopes keep the picker
 * list from auto-selecting its only entry over the edited row's envelope.
 */
function seedScenario(envelopePeriodStart: string): void {
  seedEnvelope(mockRawDb, {
    id: 'env-edited',
    name: 'Old Groceries',
    allocatedCents: 10000,
    periodStart: envelopePeriodStart,
  });
  seedTransaction(mockRawDb, {
    id: 'tx-other',
    envelopeId: 'env-edited',
    amountCents: 8000,
    date: '2026-08-05',
  });
  seedTransaction(mockRawDb, {
    id: 'tx-edited',
    envelopeId: 'env-edited',
    amountCents: 5000,
    date: '2026-08-10',
  });
  seedEnvelope(mockRawDb, {
    id: 'env-current-a',
    name: 'Fuel',
    allocatedCents: 50000,
    periodStart: CURRENT_PERIOD,
  });
  seedEnvelope(mockRawDb, {
    id: 'env-current-b',
    name: 'Eating Out',
    allocatedCents: 50000,
    periodStart: CURRENT_PERIOD,
  });
}

// The first render pays this screen's whole module-load cost; on a loaded CI
// worker that alone can exceed jest's 5s default.
jest.setTimeout(15000);

describe('AddTransactionScreen — editing a PAST period’s envelope (E-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateExecute.mockResolvedValue({ success: true });
    mockRawDb.exec('DELETE FROM envelopes; DELETE FROM transactions; DELETE FROM households;');
    seedHousehold(mockRawDb);
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it("reads the edited envelope's spend under ITS period, not the current one", async () => {
    seedScenario(PAST_PERIOD);
    const { getByTestId } = render(<AddTransactionScreen {...makeNavProps('tx-edited')} />);

    // R100 allocated, R130 already spent on the envelope, of which R50 is
    // this very transaction — so R20 was left before it, and re-saving it
    // unchanged (R50) leaves the envelope R30 over.
    await waitFor(() => {
      expect(getByTestId('after-this-preview').props.children).toContain(
        `${formatCurrency(-3000)} left in Old Groceries`,
      );
    });
  });

  it('does not wake the household about a PAST period going over budget', async () => {
    seedScenario(PAST_PERIOD);
    const { getByTestId } = render(<AddTransactionScreen {...makeNavProps('tx-edited')} />);
    await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('50.00'));

    fireEvent.changeText(getByTestId('amount-input'), '600.00');
    fireEvent.press(getByTestId('record-transaction-submit'));

    await waitFor(() => expect(mockUpdateExecute).toHaveBeenCalled());
    expect(mockHouseholdNotifier.notifyHousehold).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'envelope_over_budget' }),
    );
  });

  it('still wakes the household when the edited envelope IS the current period’s', async () => {
    seedScenario(CURRENT_PERIOD);
    const { getByTestId } = render(<AddTransactionScreen {...makeNavProps('tx-edited')} />);
    await waitFor(() => expect(getByTestId('amount-input').props.value).toBe('50.00'));

    fireEvent.changeText(getByTestId('amount-input'), '600.00');
    fireEvent.press(getByTestId('record-transaction-submit'));

    await waitFor(() =>
      expect(mockHouseholdNotifier.notifyHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'envelope_over_budget' }),
      ),
    );
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AddTransactionScreen.coverFromEnvelope.test.tsx — VAL2-9, "cover it from
 * another envelope".
 *
 * Mirrors AddTransactionScreen.periodScope.test.tsx: a REAL migrated
 * better-sqlite3 database (not a mocked `db`), so MoveAllocationUseCase's
 * own query/validation/write path runs for real — only CreateTransactionUseCase
 * and AuditLogger are mocked, the same seam every other AddTransactionScreen
 * test in this suite uses.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const HOUSEHOLD = 'hh-1';
const CURRENT_PERIOD = '2026-07-01';
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
  AuditLogger: jest
    .fn()
    .mockImplementation(() => ({ log: jest.fn().mockResolvedValue(undefined) })),
}));

const mockExecute = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../../domain/transactions/CreateTransactionUseCase', () => ({
  CreateTransactionUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date(`${CURRENT_PERIOD}T00:00:00.000Z`),
      endDate: new Date('2026-07-31T00:00:00.000Z'),
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
import { householdNotifier } from '../../../../infrastructure/notifications/HouseholdNotifier';

const mockNotifyHousehold = householdNotifier.notifyHousehold as jest.Mock;

function seedHousehold(raw: Database.Database, id: string): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 25, ?, ?)`,
    )
    .run(id, NOW, NOW);
}

function seedEnvelope(
  raw: Database.Database,
  args: { id: string; name: string; allocatedCents: number },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'spending', 0, 0, ?, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.name, args.allocatedCents, CURRENT_PERIOD, NOW, NOW);
}

function envelopeRow(raw: Database.Database, id: string): { allocated_cents: number } {
  return raw.prepare('SELECT allocated_cents FROM envelopes WHERE id = ?').get(id) as {
    allocated_cents: number;
  };
}

const makeNavProps = () => ({
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
  route: { key: 'AddTransaction', name: 'AddTransaction', params: undefined } as never,
});

jest.setTimeout(15000);

describe('AddTransactionScreen — "cover it from another envelope" (VAL2-9, real SQLite)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRawDb.exec('DELETE FROM envelopes; DELETE FROM transactions; DELETE FROM households;');
    seedHousehold(mockRawDb, HOUSEHOLD);
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it('moves the shortfall from the chosen envelope, toasts, and continues the save', async () => {
    seedEnvelope(mockRawDb, { id: 'env-groceries', name: 'Groceries', allocatedCents: 10000 });
    seedEnvelope(mockRawDb, { id: 'env-fun', name: 'Fun money', allocatedCents: 20000 });

    const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);

    fireEvent.press(getByTestId('envelope-picker-trigger'));
    await waitFor(() => expect(getByText('Groceries')).toBeTruthy());
    fireEvent.press(getByTestId('envelope-option-env-groceries'));

    // R150 against a R100 envelope with nothing spent yet -> R50 overspend.
    fireEvent.changeText(getByTestId('amount-input'), '150.00');
    fireEvent.press(getByTestId('record-transaction-submit'));

    await waitFor(() => expect(getByTestId('coaching-modal')).toBeTruthy());
    expect(getByTestId('coaching-cover-from-another-envelope')).toBeTruthy();

    fireEvent.press(getByTestId('coaching-cover-from-another-envelope'));
    await waitFor(() => expect(getByTestId('envelope-option-env-fun')).toBeTruthy());
    fireEvent.press(getByTestId('envelope-option-env-fun'));

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.stringMatching(/^Moved R50[,.]00 from Fun money$/),
        'success',
      );
    });

    // The move committed for real: 5000 cents left Fun money and landed on Groceries.
    expect(envelopeRow(mockRawDb, 'env-groceries').allocated_cents).toBe(15000);
    expect(envelopeRow(mockRawDb, 'env-fun').allocated_cents).toBe(15000);

    // The save then continued automatically.
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
  });

  // Round-3 review item 1: `doSave`'s memoized closure used to still see the
  // PRE-move allocation (the stale `selectedEnvelope`), so a cover landing
  // the envelope exactly at its new allocation looked like "R50 over"
  // instead of "exactly fully spent" — firing a false over-budget toast AND
  // household push.
  it('after a cover that lands the envelope EXACTLY at its new allocation, fires NO over-budget toast or push', async () => {
    seedEnvelope(mockRawDb, { id: 'env-groceries', name: 'Groceries', allocatedCents: 10000 });
    seedEnvelope(mockRawDb, { id: 'env-fun', name: 'Fun money', allocatedCents: 20000 });

    const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);

    fireEvent.press(getByTestId('envelope-picker-trigger'));
    await waitFor(() => expect(getByText('Groceries')).toBeTruthy());
    fireEvent.press(getByTestId('envelope-option-env-groceries'));

    // R150 against a R100 envelope with nothing spent yet -> R50 overspend,
    // covered by exactly R50 from Fun money -> Groceries' allocation becomes
    // R150, EXACTLY matching this R150 spend (100%, not over).
    fireEvent.changeText(getByTestId('amount-input'), '150.00');
    fireEvent.press(getByTestId('record-transaction-submit'));

    await waitFor(() => expect(getByTestId('coaching-cover-from-another-envelope')).toBeTruthy());
    fireEvent.press(getByTestId('coaching-cover-from-another-envelope'));
    await waitFor(() => expect(getByTestId('envelope-option-env-fun')).toBeTruthy());
    fireEvent.press(getByTestId('envelope-option-env-fun'));

    await waitFor(() => expect(mockExecute).toHaveBeenCalled());

    expect(envelopeRow(mockRawDb, 'env-groceries').allocated_cents).toBe(15000);
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.stringContaining('over budget'), 'error');
    expect(mockNotifyHousehold).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'envelope_over_budget' }),
    );
  });

  it('does not offer "cover it from another envelope" when no sibling envelope has enough unspent money', async () => {
    seedEnvelope(mockRawDb, { id: 'env-groceries', name: 'Groceries', allocatedCents: 10000 });
    seedEnvelope(mockRawDb, { id: 'env-fun', name: 'Fun money', allocatedCents: 2000 });

    const { getByTestId, getByText, queryByTestId } = render(
      <AddTransactionScreen {...makeNavProps()} />,
    );

    fireEvent.press(getByTestId('envelope-picker-trigger'));
    await waitFor(() => expect(getByText('Groceries')).toBeTruthy());
    fireEvent.press(getByTestId('envelope-option-env-groceries'));

    fireEvent.changeText(getByTestId('amount-input'), '150.00');
    fireEvent.press(getByTestId('record-transaction-submit'));

    await waitFor(() => expect(getByTestId('coaching-modal')).toBeTruthy());
    expect(queryByTestId('coaching-cover-from-another-envelope')).toBeNull();
  });
});

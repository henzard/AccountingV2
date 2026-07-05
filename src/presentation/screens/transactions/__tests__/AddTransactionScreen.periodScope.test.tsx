/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AddTransactionScreen.periodScope.test.tsx — C3 "AddTransactionScreen note"
 * (2026-07-05 exhaustive audit).
 *
 * The envelope-picker query used a raw `eq(period_start, periodStart)`
 * equality, which — exactly like the useEnvelopes bug (C3) — permanently
 * excludes PERSISTENT envelope types (sinking_fund, emergency_fund, savings,
 * baby_step) from manual transaction entry once the period has rolled
 * forward past their creation period, since persistent rows are never
 * re-created per period and their `period_start` never advances.
 *
 * This exercises the REAL query (`envelopeScopeCondition`, real
 * `getEnvelopeSpentCents`) against a REAL migrated better-sqlite3 database —
 * mirroring src/presentation/hooks/__tests__/useEnvelopes.periodScope.test.ts
 * — instead of the fully-mocked `db` used by the other AddTransactionScreen
 * tests, so it actually proves the SQL scope is correct rather than just the
 * screen's JS wiring.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const HOUSEHOLD = 'hh-1';
const OLD_PERIOD = '2026-06-01';
const CURRENT_PERIOD = '2026-07-01';
const NOW = '2026-01-01T00:00:00.000Z';

// Variable name must be prefixed with `mock` so babel-plugin-jest-hoist
// allows referencing it from inside the (hoisted) jest.mock factory below —
// the factory can't reference other top-level imports/consts.
let mockRawDb: Database.Database;

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
  args: { id: string; name: string; envelopeType: string; periodStart: string },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, 50000, ?, 0, 0, ?, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.name, args.envelopeType, args.periodStart, NOW, NOW);
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

describe('AddTransactionScreen — envelope picker period scope (real SQLite)', () => {
  beforeEach(() => {
    mockRawDb.exec('DELETE FROM envelopes; DELETE FROM transactions; DELETE FROM households;');
    seedHousehold(mockRawDb, HOUSEHOLD);
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it('includes a persistent envelope created in an OLD period in the picker for the CURRENT period, and excludes a stale OLD period-scoped one', async () => {
    // Persistent envelope, created back in the OLD period — its period_start
    // never gets updated on rollover, so it must still be selectable now.
    seedEnvelope(mockRawDb, {
      id: 'env-emergency-fund',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: OLD_PERIOD,
    });
    // Period-scoped envelope left over from the OLD period — must NOT leak
    // into the current period's picker.
    seedEnvelope(mockRawDb, {
      id: 'env-old-spending',
      name: 'Old Groceries',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
    });
    // Period-scoped envelope belonging to the CURRENT period — must be
    // included.
    seedEnvelope(mockRawDb, {
      id: 'env-current-spending',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: CURRENT_PERIOD,
    });

    const { getByTestId, getByText, queryByText } = render(
      <AddTransactionScreen {...makeNavProps()} />,
    );

    fireEvent.press(getByTestId('envelope-picker-trigger'));

    await waitFor(() => {
      expect(getByText('Emergency Fund')).toBeTruthy();
    });
    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Old Groceries')).toBeNull();
  });
});

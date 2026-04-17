/**
 * AddTransactionScreen.test.tsx — B5
 *
 * Three cases:
 *   1. Envelope picker opens and lists envelopes with balance text (allocated=1000, spent=200 → "R8.00 left").
 *   2. Income envelopes are excluded from the picker.
 *   3. Submit with amount=R0 shows validation error and does NOT call CreateTransactionUseCase.execute.
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
  }) =>
    React.createElement('TextInput', {
      testID: testID ?? label,
      value,
      onChangeText,
      ...p,
    });
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

// ─── DateTimePicker mock ──────────────────────────────────────────────────────
jest.mock('@react-native-community/datetimepicker', () => () => null);

// ─── appStore mock ────────────────────────────────────────────────────────────
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));

// ─── toastStore mock ──────────────────────────────────────────────────────────
const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector: (s: object) => unknown) => selector({ enqueue: mockEnqueue })),
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────
// Simulate a chained drizzle query: .select().from().where().then()

jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
  },
}));

// ─── AuditLogger mock ─────────────────────────────────────────────────────────
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

// ─── BudgetPeriodEngine mock ──────────────────────────────────────────────────
jest.mock('../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    })),
  })),
}));

// ─── CreateTransactionUseCase mock ────────────────────────────────────────────
const mockExecute = jest.fn().mockResolvedValue({ success: true });
const MockCreateTransactionUseCase = jest.fn().mockImplementation(() => ({ execute: mockExecute }));
jest.mock('../../../../domain/transactions/CreateTransactionUseCase', () => ({
  CreateTransactionUseCase: MockCreateTransactionUseCase,
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
    id: 'id',
    name: 'name',
    allocatedCents: 'allocatedCents',
    spentCents: 'spentCents',
    envelopeType: 'envelopeType',
    householdId: 'householdId',
    periodStart: 'periodStart',
    isArchived: 'isArchived',
  },
}));

import { ne } from 'drizzle-orm';
import { AddTransactionScreen } from '../AddTransactionScreen';

// Get the mocked db after import so we can configure it per test
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db: mockDb } = require('../../../../data/local/db');

function setupDbChain(rows: object[]): void {
  // Synchronous-style mock that still supports .then(...).catch(...) chaining
  const mockThen = jest.fn((cb: (r: object[]) => void) => {
    cb(rows);
    return { catch: jest.fn() };
  });
  const mockWhere = jest.fn(() => ({ then: mockThen }));
  const mockFrom = jest.fn(() => ({ where: mockWhere }));
  mockDb.select.mockReturnValue({ from: mockFrom });
}

const makeNavProps = () => ({
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
  route: { key: 'AddTransaction', name: 'AddTransaction', params: undefined } as any,
});

describe('AddTransactionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbChain([]);
  });

  it('opens picker and lists envelopes with correct balance text', () => {
    const rows = [
      {
        id: 'env-1',
        name: 'Groceries',
        allocatedCents: 1000,
        spentCents: 200,
        envelopeType: 'spending',
      },
      {
        id: 'env-2',
        name: 'Transport',
        allocatedCents: 500,
        spentCents: 500,
        envelopeType: 'spending',
      },
    ];
    setupDbChain(rows);

    const { getByTestId, getByText } = render(<AddTransactionScreen {...makeNavProps()} />);

    // Open picker
    fireEvent.press(getByTestId('envelope-picker-trigger'));

    // Verify envelope names are shown
    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('Transport')).toBeTruthy();

    // Verify balance text: allocated=1000 spent=200 → balance=800 cents → R8.00 left
    expect(getByTestId('envelope-balance-env-1')).toBeTruthy();
    expect(getByText('R8.00 left')).toBeTruthy();

    // Transport: 500-500=0 → R0.00 left
    expect(getByText('R0.00 left')).toBeTruthy();
  });

  it('excludes income envelopes from picker (db query uses ne filter)', () => {
    // The DB query filters out income envelopes via ne(envelopeType, 'income').
    // Verify the DB query construction uses the income exclusion filter.
    setupDbChain([
      {
        id: 'env-1',
        name: 'Groceries',
        allocatedCents: 1000,
        spentCents: 0,
        envelopeType: 'spending',
      },
    ]);

    render(<AddTransactionScreen {...makeNavProps()} />);

    // Verify that ne() was called with 'income' — this proves the income exclusion filter
    // is constructed in the query, regardless of what the DB returns.
    expect(ne as jest.Mock).toHaveBeenCalledWith(expect.anything(), 'income');
  });

  it('Scan slip button navigates to SlipScanning', () => {
    setupDbChain([]);
    const navProps = makeNavProps();
    const { getByTestId } = render(<AddTransactionScreen {...navProps} />);
    fireEvent.press(getByTestId('scan-slip-button'));
    expect(navProps.navigation.navigate).toHaveBeenCalledWith('SlipScanning');
  });

  it('shows validation error and does NOT call CreateTransactionUseCase when amount is R0', async () => {
    setupDbChain([
      {
        id: 'env-1',
        name: 'Groceries',
        allocatedCents: 1000,
        spentCents: 200,
        envelopeType: 'spending',
      },
    ]);

    const { getByText, queryByTestId } = render(<AddTransactionScreen {...makeNavProps()} />);

    // The single envelope is auto-selected (rows.length === 1)
    // Leave amount as empty string (defaults to '' → toCents returns 0)
    fireEvent.press(getByText('Record Transaction'));

    await waitFor(() => {
      // Snackbar error should appear
      expect(queryByTestId('snackbar-error')).toBeTruthy();
      // Use case must NOT have been constructed/called
      expect(MockCreateTransactionUseCase).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });
});

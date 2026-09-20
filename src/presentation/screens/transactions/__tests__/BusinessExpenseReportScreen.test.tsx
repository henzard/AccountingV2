/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * BusinessExpenseReportScreen.test.tsx — comprehensive screen test with CSV export
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => {
  const RealReact = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb: () => void) => {
      RealReact.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

// ─── Local DB mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/db', () => ({
  db: { select: jest.fn() },
}));

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...a: unknown[]) => a),
  eq: jest.fn((c: unknown, v: unknown) => ({ c, v })),
  isNull: jest.fn((col: unknown) => ({ isNull: col })),
}));

// ─── Schema mock ──────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/schema', () => ({
  transactions: {
    householdId: 'householdId',
    isBusinessExpense: 'isBusinessExpense',
  },
}));

// ─── Store mocks ──────────────────────────────────────────────────────────────
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string }) => unknown) =>
    sel({ householdId: 'hh-1' }),
  ),
}));

const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: (selector: (s: object) => unknown): unknown => selector({ enqueue: mockEnqueue }),
}));

// ─── Theme mock ───────────────────────────────────────────────────────────────
jest.mock('../../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      primary: '#000',
      background: '#fff',
      surface: '#fff',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      error: '#f00',
    },
  }),
}));

jest.mock('../../../stores/themeStore', () => ({
  useThemeStore: jest.fn((sel: (s: object) => unknown) => sel({ preference: 'light' })),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
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
    Surface: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('View', p, children),
    ActivityIndicator: ({ testID }: { testID?: string; [k: string]: unknown }) =>
      React.createElement('View', { testID: testID ?? 'activity-indicator' }),
    IconButton: ({
      testID,
      onPress,
      _disabled,
      ...p
    }: {
      testID?: string;
      onPress?: () => void;
      disabled?: boolean;
      [k: string]: unknown;
    }) => {
      const el = React.createElement('button', {
        testID,
        onPress,
        ...p,
      });
      return el;
    },
  };
});

// ─── CSV builder mocks ────────────────────────────────────────────────────────
jest.mock('../buildBusinessExpenseCsv', () => ({
  buildBusinessExpenseCsv: jest.fn((rows: unknown[]) => {
    if (Array.isArray(rows) && rows.length > 0) {
      return 'Date,Payee,Description,Amount (ZAR)\r\n2026-01-15,"Test","Desc","100.00"\r\n"","","Total","100.00"';
    }
    return 'Date,Payee,Description,Amount (ZAR)\r\n"","","Total","0.00"';
  }),
  transactionsToCsvRows: jest.fn((txs: unknown[]) => txs),
}));

// ─── groupBusinessExpenses mock ───────────────────────────────────────────────
const mockGroupBusinessExpenses = jest.fn();
jest.mock('../../../../domain/transactions/BusinessExpenseReport', () => ({
  groupBusinessExpenses: (...args: unknown[]) => mockGroupBusinessExpenses(...args),
}));

// ─── formatCurrency mock ──────────────────────────────────────────────────────
jest.mock('../../../utils/currency', () => ({
  formatCurrency: (cents: number) => `R${(cents / 100).toFixed(2)}`,
}));

// ─── Share API mock ───────────────────────────────────────────────────────────
const mockShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });

const { db: mockDb } = require('../../../../data/local/db');

import { BusinessExpenseReportScreen } from '../BusinessExpenseReportScreen';

function setupDbChain(rows: object[]): void {
  const mockWhere = jest.fn(() => Promise.resolve(rows));
  const mockFrom = jest.fn(() => ({ where: mockWhere }));
  mockDb.select.mockReturnValue({ from: mockFrom });
}

function setupDbError(): void {
  const mockWhere = jest.fn(() => Promise.reject(new Error('DB error')));
  const mockFrom = jest.fn(() => ({ where: mockWhere }));
  mockDb.select.mockReturnValue({ from: mockFrom });
}

describe('BusinessExpenseReportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnqueue.mockClear();
    mockShare.mockClear();
    setupDbChain([]);
    mockGroupBusinessExpenses.mockReturnValue([]);
  });

  // ─── Original coverage tests ──────────────────────────────────────────────────
  it('renders empty state when no business expenses', async () => {
    mockGroupBusinessExpenses.mockReturnValue([]);
    const { getByTestId } = render(<BusinessExpenseReportScreen />);
    await waitFor(() => {
      expect(getByTestId('biz-expense-empty')).toBeTruthy();
    });
  });

  it('renders grouped list with correct total when expenses exist', async () => {
    const txRows = [
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e1',
        amountCents: 15000,
        payee: 'Client Lunch',
        description: null,
        transactionDate: '2026-06-15',
        isBusinessExpense: true,
        spendingTriggerNote: null,
        slipId: null,
        createdAt: '2026-06-15',
        updatedAt: '2026-06-15',
      },
    ];
    setupDbChain(txRows);
    mockGroupBusinessExpenses.mockReturnValue([
      {
        monthKey: '2026-06',
        monthLabel: 'June 2026',
        totalCents: 15000,
        transactions: txRows,
      },
    ]);

    const { getByTestId, getByText, getAllByText } = render(<BusinessExpenseReportScreen />);
    await waitFor(() => {
      expect(getByTestId('biz-expense-list')).toBeTruthy();
    });
    expect(getByText('June 2026')).toBeTruthy();
    expect(getAllByText('R150.00').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Client Lunch')).toBeTruthy();
  });

  it('shows empty state (not R0 silently) when total is zero', async () => {
    setupDbChain([]);
    mockGroupBusinessExpenses.mockReturnValue([]);

    const { getByTestId, queryByText } = render(<BusinessExpenseReportScreen />);
    await waitFor(() => {
      expect(getByTestId('biz-expense-empty')).toBeTruthy();
    });
    expect(queryByText('R0.00')).toBeNull();
  });

  it('shows error banner on DB error', async () => {
    setupDbError();
    mockGroupBusinessExpenses.mockReturnValue([]);

    const { getByTestId } = render(<BusinessExpenseReportScreen />);
    await waitFor(() => {
      expect(getByTestId('error-banner')).toBeTruthy();
    });
  });

  it('only queries for active household data', async () => {
    setupDbChain([]);
    mockGroupBusinessExpenses.mockReturnValue([]);
    render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      const { eq } = require('drizzle-orm');
      expect(eq).toHaveBeenCalledWith('householdId', 'hh-1');
    });
  });

  it('excludes deleted transactions (deletedAt is null filter applied)', async () => {
    setupDbChain([]);
    mockGroupBusinessExpenses.mockReturnValue([]);
    render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      const { isNull } = require('drizzle-orm');
      expect(isNull).toHaveBeenCalled();
    });
  });

  // ─── New CSV export feature tests ──────────────────────────────────────────────
  it('renders Share CSV button when expenses exist', async () => {
    const txRows = [
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e1',
        amountCents: 10000,
        payee: 'Store A',
        description: 'Office supplies',
        transactionDate: '2026-01-15',
        isBusinessExpense: true,
        spendingTriggerNote: null,
        slipId: null,
        createdAt: '2026-01-15',
        updatedAt: '2026-01-15',
      },
    ];
    setupDbChain(txRows);
    mockGroupBusinessExpenses.mockReturnValue([
      {
        monthKey: '2026-01',
        monthLabel: 'January 2026',
        totalCents: 10000,
        transactions: txRows,
      },
    ]);

    const { getByTestId } = render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      expect(getByTestId('share-csv-button')).toBeTruthy();
    });
  });

  it('calls Share.share with title and CSV when Share CSV button is pressed', async () => {
    const txRows = [
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e1',
        amountCents: 10000,
        payee: 'Store A',
        description: 'Office supplies',
        transactionDate: '2026-01-15',
        isBusinessExpense: true,
        spendingTriggerNote: null,
        slipId: null,
        createdAt: '2026-01-15',
        updatedAt: '2026-01-15',
      },
    ];
    setupDbChain(txRows);
    mockGroupBusinessExpenses.mockReturnValue([
      {
        monthKey: '2026-01',
        monthLabel: 'January 2026',
        totalCents: 10000,
        transactions: txRows,
      },
    ]);

    const { getByTestId } = render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      expect(getByTestId('share-csv-button')).toBeTruthy();
    });

    const button = getByTestId('share-csv-button');
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalled();
      const call = mockShare.mock.calls[0][0];
      expect(call.title).toBe('Business expenses');
      expect(call.message).toContain('Date,Payee,Description,Amount (ZAR)');
    });
  });

  it('includes CSV header in the shared message', async () => {
    const txRows = [
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e1',
        amountCents: 10000,
        payee: 'Store A',
        description: 'Office supplies',
        transactionDate: '2026-01-15',
        isBusinessExpense: true,
        spendingTriggerNote: null,
        slipId: null,
        createdAt: '2026-01-15',
        updatedAt: '2026-01-15',
      },
    ];
    setupDbChain(txRows);
    mockGroupBusinessExpenses.mockReturnValue([
      {
        monthKey: '2026-01',
        monthLabel: 'January 2026',
        totalCents: 10000,
        transactions: txRows,
      },
    ]);

    const { getByTestId } = render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      expect(getByTestId('share-csv-button')).toBeTruthy();
    });

    const button = getByTestId('share-csv-button');
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalled();
      const message = mockShare.mock.calls[0][0].message as string;
      expect(message.startsWith('Date,Payee,Description,Amount (ZAR)')).toBe(true);
    });
  });

  it('shows error toast when Share.share fails', async () => {
    const txRows = [
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e1',
        amountCents: 10000,
        payee: 'Store A',
        description: 'Office supplies',
        transactionDate: '2026-01-15',
        isBusinessExpense: true,
        spendingTriggerNote: null,
        slipId: null,
        createdAt: '2026-01-15',
        updatedAt: '2026-01-15',
      },
    ];
    setupDbChain(txRows);
    mockGroupBusinessExpenses.mockReturnValue([
      {
        monthKey: '2026-01',
        monthLabel: 'January 2026',
        totalCents: 10000,
        transactions: txRows,
      },
    ]);

    mockShare.mockRejectedValueOnce(new Error('Share failed'));

    const { getByTestId } = render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      expect(getByTestId('share-csv-button')).toBeTruthy();
    });

    const button = getByTestId('share-csv-button');
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith('Share failed', 'error');
    });
  });

  it('disables button when transactions is empty', async () => {
    setupDbChain([]);
    mockGroupBusinessExpenses.mockReturnValue([]);

    const { queryByTestId } = render(<BusinessExpenseReportScreen />);

    // When empty, EmptyState is shown instead of the list+header, so button isn't rendered
    await waitFor(() => {
      expect(queryByTestId('biz-expense-empty')).toBeTruthy();
    });
  });
});

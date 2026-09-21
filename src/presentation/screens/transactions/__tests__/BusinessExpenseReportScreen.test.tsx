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
  gte: jest.fn((c: unknown, v: unknown) => ({ gte: [c, v] })),
  lte: jest.fn((c: unknown, v: unknown) => ({ lte: [c, v] })),
}));

// ─── Schema mock ──────────────────────────────────────────────────────────────
jest.mock('../../../../data/local/schema', () => ({
  transactions: {
    householdId: 'householdId',
    isBusinessExpense: 'isBusinessExpense',
    transactionDate: 'transactionDate',
    deletedAt: 'deletedAt',
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
    Menu: Object.assign(
      ({
        anchor,
        visible,
        children,
      }: {
        anchor?: React.ReactNode;
        visible?: boolean;
        children?: React.ReactNode;
      }) => React.createElement(React.Fragment, null, anchor, visible ? children : null),
      {
        Item: ({
          title,
          onPress,
          testID,
        }: {
          title?: string;
          onPress?: () => void;
          testID?: string;
        }) => React.createElement('button', { testID, onPress }, title),
      },
    ),
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
      // B-01: the file name now carries the selected tax-year range (or
      // "all-time") instead of a fixed 'Business expenses' string — checked
      // by shape rather than an exact value since it's derived from the
      // real current date.
      expect(call.title).toMatch(
        /^business-expenses-(all-time|\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2})\.csv$/,
      );
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

    const { queryByTestId, getByTestId } = render(<BusinessExpenseReportScreen />);

    // When empty, EmptyState is shown alongside the header; the share
    // button stays mounted (so the tax-year selector remains usable) but is
    // disabled.
    await waitFor(() => {
      expect(queryByTestId('biz-expense-empty')).toBeTruthy();
    });
    expect(getByTestId('share-csv-button').props.disabled).toBe(true);
  });

  // ─── B-01: tax-year selector ──────────────────────────────────────────────
  describe('Tax-year selector (B-01)', () => {
    it('defaults to the current SARS tax year computed from local "today"', async () => {
      setupDbChain([]);
      mockGroupBusinessExpenses.mockReturnValue([]);

      const { getByTestId } = render(<BusinessExpenseReportScreen />);

      await waitFor(() => {
        expect(getByTestId('tax-year-selector-button')).toBeTruthy();
      });

      const { currentTaxYearKey } = require('../../../../domain/transactions/southAfricanTaxYear');
      const { format } = require('date-fns');
      const expectedKey = currentTaxYearKey(format(new Date(), 'yyyy-MM-dd'));

      fireEvent.press(getByTestId('tax-year-selector-button'));
      await waitFor(() => {
        expect(getByTestId(`tax-year-option-${expectedKey}`)).toBeTruthy();
      });
    });

    it('offers an "All time" option in the tax-year menu', async () => {
      setupDbChain([]);
      mockGroupBusinessExpenses.mockReturnValue([]);

      const { getByTestId } = render(<BusinessExpenseReportScreen />);
      await waitFor(() => {
        expect(getByTestId('tax-year-selector-button')).toBeTruthy();
      });

      fireEvent.press(getByTestId('tax-year-selector-button'));
      await waitFor(() => {
        expect(getByTestId('tax-year-option-all-time')).toBeTruthy();
      });
    });

    it('filters the query using gte/lte on transactionDate for the selected tax year', async () => {
      setupDbChain([]);
      mockGroupBusinessExpenses.mockReturnValue([]);
      render(<BusinessExpenseReportScreen />);

      await waitFor(() => {
        const { gte, lte } = require('drizzle-orm');
        expect(gte).toHaveBeenCalledWith('transactionDate', expect.stringMatching(/^\d{4}-03-01$/));
        expect(lte).toHaveBeenCalledWith(
          'transactionDate',
          expect.stringMatching(/^\d{4}-02-(28|29)$/),
        );
      });
    });

    it('switching to "All time" reloads without a date-range filter', async () => {
      setupDbChain([]);
      mockGroupBusinessExpenses.mockReturnValue([]);
      const { getByTestId } = render(<BusinessExpenseReportScreen />);

      await waitFor(() => {
        expect(getByTestId('tax-year-selector-button')).toBeTruthy();
      });

      const { gte, lte } = require('drizzle-orm');

      const { db } = require('../../../../data/local/db');
      // Let the initial load settle first, so the counts below are stable.
      await waitFor(() => {
        expect(db.select.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      const selectCallsBefore = db.select.mock.calls.length;
      const gteCallsBefore = gte.mock.calls.length;
      const lteCallsBefore = lte.mock.calls.length;

      fireEvent.press(getByTestId('tax-year-selector-button'));
      await waitFor(() => {
        expect(getByTestId('tax-year-option-all-time')).toBeTruthy();
      });
      fireEvent.press(getByTestId('tax-year-option-all-time'));

      // The empty state is on screen before AND after, so it proves nothing:
      // wait for the reload's two selects (dates + rows) to have actually run.
      await waitFor(() => {
        expect(db.select.mock.calls.length).toBeGreaterThanOrEqual(selectCallsBefore + 2);
      });
      // No new gte/lte calls were made for the "All time" reload.
      expect(gte.mock.calls.length).toBe(gteCallsBefore);
      expect(lte.mock.calls.length).toBe(lteCallsBefore);
    });

    it('includes the selected tax-year range in the shared CSV file name', async () => {
      const txRows = [
        {
          id: 'tx-1',
          householdId: 'hh-1',
          envelopeId: 'e1',
          amountCents: 10000,
          payee: 'Store A',
          description: 'Office supplies',
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
          totalCents: 10000,
          transactions: txRows,
        },
      ]);

      const { getByTestId } = render(<BusinessExpenseReportScreen />);
      await waitFor(() => {
        expect(getByTestId('share-csv-button')).toBeTruthy();
      });

      fireEvent.press(getByTestId('share-csv-button'));

      await waitFor(() => {
        expect(mockShare).toHaveBeenCalled();
        const call = mockShare.mock.calls[0][0];
        expect(call.title).toMatch(
          /^business-expenses-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/,
        );
      });
    });
  });

  // ─── B-02: share button hit target ────────────────────────────────────────
  it('renders the share-CSV button with a touch target of at least 44dp (size >= 28)', async () => {
    setupDbChain([]);
    mockGroupBusinessExpenses.mockReturnValue([]);
    const { getByTestId } = render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      expect(getByTestId('share-csv-button')).toBeTruthy();
    });

    // react-native-paper's IconButton (v3) renders a touch target of
    // `size + 2 * 8` — size must be >= 28 to reach the 44dp minimum.
    const button = getByTestId('share-csv-button');
    expect(button.props.size).toBeGreaterThanOrEqual(28);
  });

  // ─── B-03: payee/note allow 2 lines ────────────────────────────────────────
  it('allows the payee text to wrap onto 2 lines instead of truncating to 1', async () => {
    const txRows = [
      {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e1',
        amountCents: 15000,
        payee: 'A Very Long Payee Name That Should Wrap',
        description: null,
        transactionDate: '2026-06-15',
        isBusinessExpense: true,
        spendingTriggerNote: 'A very long spending trigger note that should also wrap',
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

    const { getByText } = render(<BusinessExpenseReportScreen />);

    await waitFor(() => {
      expect(getByText('A Very Long Payee Name That Should Wrap')).toBeTruthy();
    });
    expect(getByText('A Very Long Payee Name That Should Wrap').props.numberOfLines).toBe(2);
    expect(
      getByText('A very long spending trigger note that should also wrap').props.numberOfLines,
    ).toBe(2);
  });
});

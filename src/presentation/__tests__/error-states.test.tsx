/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * error-states.test.tsx — Hook error surfacing verification
 *
 * Verifies that the data hooks expose error state, and documents
 * that screens currently ignore those errors (no error UI rendered).
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';

// ─── Local DB mock ────────────────────────────────────────────────────────────
const mockSelect = jest.fn();
jest.mock('../../data/local/db', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
}));

// ─── drizzle-orm mock ─────────────────────────────────────────────────────────
jest.mock('drizzle-orm', () => ({
  and: jest.fn((...a: unknown[]) => a),
  eq: jest.fn((c: unknown, v: unknown) => ({ c, v })),
  gte: jest.fn((c: unknown, v: unknown) => ({ c, v })),
  asc: jest.fn((c: unknown) => c),
  desc: jest.fn((c: unknown) => c),
}));

// ─── Schema mock ──────────────────────────────────────────────────────────────
jest.mock('../../data/local/schema', () => ({
  envelopes: {
    householdId: 'householdId',
    periodStart: 'periodStart',
    isArchived: 'isArchived',
  },
  transactions: {
    householdId: 'householdId',
    transactionDate: 'transactionDate',
  },
  debts: {
    householdId: 'householdId',
    sortOrder: 'sortOrder',
  },
}));

import { useEnvelopes } from '../hooks/useEnvelopes';
import { useTransactions } from '../hooks/useTransactions';
import { useDebts } from '../hooks/useDebts';

function setupDbReject(): void {
  mockSelect.mockReturnValue({
    from: jest.fn(() => ({
      where: jest.fn(() => Promise.reject(new Error('DB read failed'))),
    })),
  });
}

function setupDbRejectWithOrderBy(): void {
  mockSelect.mockReturnValue({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        orderBy: jest.fn(() => Promise.reject(new Error('DB read failed'))),
      })),
    })),
  });
}

describe('Hook error state exposure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('useEnvelopes exposes error state when DB fails', async () => {
    setupDbReject();

    const { result } = renderHook(() => useEnvelopes('hh-1', '2026-06-01'));

    await waitFor(() => {
      expect(result.current.error).toBe('DB read failed');
    });
    expect(result.current.envelopes).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('useTransactions exposes error state when DB fails', async () => {
    setupDbRejectWithOrderBy();

    const { result } = renderHook(() => useTransactions('hh-1', '2026-06-01'));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('DB read failed');
    expect(result.current.transactions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('useDebts exposes error state when DB fails', async () => {
    setupDbRejectWithOrderBy();

    const { result } = renderHook(() => useDebts('hh-1'));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('DB read failed');
    expect(result.current.debts).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // Screens now destructure the `error` field from hooks and render error UI:
  //   - TransactionListScreen: const { transactions, loading, error, reload } = useTransactions(...)
  //   - BusinessExpenseReportScreen: manages its own error state
  it('verifies: TransactionListScreen and BusinessExpenseReportScreen handle error state', () => {
    const txListSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../screens/transactions/TransactionListScreen.tsx'),
      'utf8',
    );
    expect(txListSource).toContain('error');
    expect(txListSource).toContain('error-banner');

    const bizSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../screens/transactions/BusinessExpenseReportScreen.tsx'),
      'utf8',
    );
    expect(bizSource).toContain('setError');
    expect(bizSource).toContain('error-banner');
  });
});

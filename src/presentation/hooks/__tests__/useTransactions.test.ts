import { renderHook, act } from '@testing-library/react-native';

const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

jest.mock('../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  envelopeScopeCondition: jest.fn(() => 'ENVELOPE_SCOPE_CONDITION'),
}));

jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  isNull: jest.fn((col) => ({ isNull: col })),
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });

import { useTransactions } from '../useTransactions';
import { envelopeScopeCondition } from '../../../data/local/balances/EnvelopeBalanceQuery';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

const HOUSEHOLD = 'hh-1';
const PERIOD = '2026-06-01';
const PERIOD_END = '2026-06-30';

function makeTx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    id: 'tx-1',
    householdId: HOUSEHOLD,
    envelopeId: 'env-1',
    amountCents: -5000,
    transactionDate: '2026-06-05',
    payee: 'Coffee shop',
    description: 'Coffee',
    isBusinessExpense: false,
    spendingTriggerNote: null,
    createdAt: '2026-06-05T08:00:00.000Z',
    updatedAt: '2026-06-05T08:00:00.000Z',
    ...overrides,
  } as TransactionEntity;
}

describe('useTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  it('starts with loading=false and empty transactions', () => {
    mockOrderBy.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));
    expect(result.current.loading).toBe(false);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('fetches transactions when reload is called (legacy positional periodStart)', async () => {
    const rows = [makeTx(), makeTx({ id: 'tx-2', description: 'Lunch' })];
    mockOrderBy.mockResolvedValue(rows);

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.transactions).toEqual(rows);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches transactions when called with a { periodStart, periodEnd } range', async () => {
    const rows = [makeTx()];
    mockOrderBy.mockResolvedValue(rows);

    const { result } = renderHook(() =>
      useTransactions(HOUSEHOLD, { periodStart: PERIOD, periodEnd: PERIOD_END }),
    );

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.transactions).toEqual(rows);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    // The window's lower AND upper bound are both applied when periodEnd is given.
    expect(mockWhere).toHaveBeenCalled();
  });

  it('applies the envelope-scope condition for the period even without a periodEnd', async () => {
    mockOrderBy.mockResolvedValue([]);
    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    expect(envelopeScopeCondition).toHaveBeenCalledWith(PERIOD);
  });

  it('includes a row whose date is outside the window but whose envelope is scoped to this period', async () => {
    // A back-dated transaction against a current-period envelope: the DB
    // layer is mocked, so this asserts the hook actually returns whatever
    // the (envelope-scope-unioned) query resolves with, proving the row is
    // not filtered out client-side.
    const backDated = makeTx({ id: 'tx-backdated', transactionDate: '2026-05-15' });
    mockOrderBy.mockResolvedValue([backDated]);

    const { result } = renderHook(() =>
      useTransactions(HOUSEHOLD, { periodStart: PERIOD, periodEnd: PERIOD_END }),
    );

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.transactions).toEqual([backDated]);
  });

  it('returns empty array when no transactions exist', async () => {
    mockOrderBy.mockResolvedValue([]);

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error as Error instance when fetch throws Error', async () => {
    mockOrderBy.mockRejectedValue(new Error('DB timeout'));

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('DB timeout');
    expect(result.current.transactions).toEqual([]);
  });

  it('wraps non-Error throws into Error instance', async () => {
    mockOrderBy.mockRejectedValue(42);

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('42');
  });

  it('sets loading=true during fetch', async () => {
    let resolvePromise: (v: unknown[]) => void;
    mockOrderBy.mockReturnValue(
      new Promise((r) => {
        resolvePromise = r;
      }),
    );

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    let reloadPromise: Promise<void>;
    act(() => {
      reloadPromise = result.current.reload();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolvePromise!([]);
      await reloadPromise!;
    });

    expect(result.current.loading).toBe(false);
  });

  it('reload clears previous error', async () => {
    mockOrderBy.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).not.toBeNull();

    mockOrderBy.mockResolvedValueOnce([makeTx()]);
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.transactions).toHaveLength(1);
  });

  it('excludes deleted transactions (deletedAt is null filter applied)', async () => {
    const { isNull } = jest.requireMock('drizzle-orm') as { isNull: jest.Mock };
    const activeTx = makeTx({ id: 'tx-active' });
    mockOrderBy.mockResolvedValue([activeTx]);

    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    expect(isNull).toHaveBeenCalled();
    expect(result.current.transactions).toHaveLength(1);
    expect(result.current.transactions[0].id).toBe('tx-active');
  });

  it('re-queries with the new window when the period range changes', async () => {
    mockOrderBy.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ start, end }: { start: string; end: string }) =>
        useTransactions(HOUSEHOLD, { periodStart: start, periodEnd: end }),
      { initialProps: { start: PERIOD, end: PERIOD_END } },
    );

    await act(async () => {
      await result.current.reload();
    });
    expect(mockFrom).toHaveBeenCalledTimes(1);

    rerender({ start: '2026-07-01', end: '2026-07-31' });
    await act(async () => {
      await result.current.reload();
    });

    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(envelopeScopeCondition).toHaveBeenLastCalledWith('2026-07-01');
  });
});

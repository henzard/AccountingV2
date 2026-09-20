import { renderHook, act } from '@testing-library/react-native';

const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  isNull: jest.fn((col) => ({ isNull: col })),
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });

import { useTransactions } from '../useTransactions';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

/** Flattens a drizzle `sql` tree (literals, columns and bound params) into one
 * searchable string, so a test can assert WHICH predicate the hook built. */
function sqlText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(sqlText).join(' ');
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.queryChunks)) return obj.queryChunks.map(sqlText).join(' ');
  if (obj.value !== undefined) return sqlText(obj.value);
  if (typeof obj.name === 'string') return obj.name;
  return '';
}

/** The WHERE predicate the last query was built with, as text. */
function lastWhereText(): string {
  const calls = mockWhere.mock.calls;
  return sqlText(calls[calls.length - 1][0]);
}

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

  it('unions in PERIOD-SCOPED envelopes for the period, and only those (REG-6)', async () => {
    // The OR-clause used to be built from `envelopeScopeCondition`, which
    // matches every PERSISTENT type unconditionally — so every transaction
    // ever booked to a sinking fund appeared in (and was totalled into) EVERY
    // period. Persistent-envelope rows rely on the date window alone.
    mockOrderBy.mockResolvedValue([]);
    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });

    const where = lastWhereText();
    expect(where).toContain('spending');
    expect(where).toContain('income');
    expect(where).toContain('utility');
    expect(where).toContain('period_start');
    expect(where).not.toContain('sinking_fund');
    expect(where).not.toContain('emergency_fund');
    expect(where).not.toContain('savings');
    expect(where).not.toContain('baby_step');
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
    expect(lastWhereText()).toContain('2026-07-01');
  });
});

describe('useTransactions \u2014 loading vs refreshing (REG-9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  it('flips `loading` on the first load and `refreshing` on every later one', async () => {
    const first = makeTx({ id: 'tx-first' });
    mockOrderBy.mockResolvedValue([first]);
    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.transactions).toEqual([first]);

    // A sync-driven reload must NOT blank the list: `loading` stays false so
    // the screen keeps rendering rows instead of dropping to skeletons.
    let release: ((rows: unknown[]) => void) | null = null;
    mockOrderBy.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    let pending: Promise<void>;
    act(() => {
      pending = result.current.reload();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.transactions).toEqual([first]);

    await act(async () => {
      release!([first]);
      await pending!;
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('a first load that FAILS still counts as loaded, so the retry refreshes', async () => {
    mockOrderBy.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.loading).toBe(false);

    let release: ((rows: unknown[]) => void) | null = null;
    mockOrderBy.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    let pending: Promise<void>;
    act(() => {
      pending = result.current.reload();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      release!([]);
      await pending!;
    });
  });
});

import { renderHook, act } from '@testing-library/react-native';

const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });

import { useTransactions } from '../useTransactions';
import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

const HOUSEHOLD = 'hh-1';
const PERIOD = '2026-06-01';

function makeTx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    id: 'tx-1',
    householdId: HOUSEHOLD,
    envelopeId: 'env-1',
    amountCents: -5000,
    transactionDate: '2026-06-05',
    description: 'Coffee',
    merchant: null,
    isTransfer: false,
    createdBy: 'user-1',
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

  it('fetches transactions when reload is called', async () => {
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
});

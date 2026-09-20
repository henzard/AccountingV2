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

import { useDebts } from '../useDebts';
import type { DebtEntity } from '../../../domain/debtSnowball/DebtEntity';

const HOUSEHOLD = 'hh-1';

function makeDebt(overrides: Partial<DebtEntity> = {}): DebtEntity {
  return {
    id: 'debt-1',
    householdId: HOUSEHOLD,
    name: 'Credit Card',
    balanceCents: 500000,
    minimumPaymentCents: 25000,
    interestRateBps: 1950,
    sortOrder: 1,
    isPaidOff: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as DebtEntity;
}

describe('useDebts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  it('starts with loading=true and empty debts before reload', () => {
    const { result } = renderHook(() => useDebts(HOUSEHOLD));
    expect(result.current.loading).toBe(true);
    expect(result.current.debts).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('fetches debts on reload and resolves', async () => {
    const rows = [makeDebt(), makeDebt({ id: 'debt-2', creditorName: 'Car Loan', sortOrder: 2 })];
    mockOrderBy.mockResolvedValue(rows);

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.debts).toEqual(rows);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when no debts exist', async () => {
    mockOrderBy.mockResolvedValue([]);

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.debts).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('sets error when fetch throws Error', async () => {
    mockOrderBy.mockRejectedValue(new Error('Table not found'));

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Table not found');
    expect(result.current.debts).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('wraps non-Error into Error instance', async () => {
    mockOrderBy.mockRejectedValue(undefined);

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('undefined');
  });

  it('reload re-fetches data on subsequent calls', async () => {
    const initial = [makeDebt()];
    const updated = [makeDebt({ outstandingBalanceCents: 400000 })];
    mockOrderBy.mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.debts).toEqual(initial);

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.debts).toEqual(updated);
    expect(result.current.loading).toBe(false);
  });

  it('reload clears previous error', async () => {
    mockOrderBy.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).not.toBeNull();

    mockOrderBy.mockResolvedValueOnce([makeDebt()]);
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.debts).toHaveLength(1);
  });

  it('reload sets loading=true during fetch', async () => {
    let resolvePromise: (v: unknown[]) => void;
    mockOrderBy.mockReturnValue(
      new Promise((r) => {
        resolvePromise = r;
      }),
    );

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

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
});

describe('useDebts \u2014 loading vs refreshing (REG-9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  it('keeps `loading` false (and flips `refreshing`) on a reload after the first', async () => {
    const debt = makeDebt();
    mockOrderBy.mockResolvedValue([debt]);
    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.debts).toEqual([debt]);

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

    // A sync round must not blank the debt list.
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.debts).toEqual([debt]);

    await act(async () => {
      release!([debt]);
      await pending!;
    });
    expect(result.current.refreshing).toBe(false);
  });
});

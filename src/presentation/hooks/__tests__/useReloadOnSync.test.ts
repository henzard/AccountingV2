/**
 * VAL-5 — screens must pick up a partner's changes as soon as a sync round
 * succeeds, not only when you navigate away and back.
 *
 * Covers the shared trigger directly, then each of the three consuming hooks
 * (useEnvelopes / useTransactions / useDebts) through their real code path
 * with the local DB stubbed.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';

const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: {
    select: () => ({ from: mockFrom }),
  },
}));

jest.mock('../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn().mockResolvedValue(new Map()),
  envelopeScopeCondition: jest.fn(() => undefined),
}));

import { useReloadOnSync } from '../useReloadOnSync';
import { useEnvelopes } from '../useEnvelopes';
import { useTransactions } from '../useTransactions';
import { useDebts } from '../useDebts';
import { useSyncStore } from '../../stores/syncStore';

const HOUSEHOLD = 'hh-1';
const PERIOD = '2026-06-01';

/** Stamps a new successful-sync time, as SyncScheduler does after a real round. */
function completeSyncRound(at: string): void {
  act(() => {
    useSyncStore.getState().setLastSyncAt(at);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useSyncStore.getState().reset();
  // `select().from().where()` for useTransactions/useEnvelopes, and
  // `...where().orderBy()` for useDebts/useTransactions.
  mockOrderBy.mockResolvedValue([]);
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { orderBy: mockOrderBy }) as unknown as Promise<unknown[]>,
  );
  mockFrom.mockReturnValue({ where: mockWhere });
});

describe('useReloadOnSync', () => {
  it('does not reload on mount', () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useReloadOnSync(reload));
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload on mount even when a sync already happened earlier', () => {
    useSyncStore.getState().setLastSyncAt('2026-06-01T10:00:00.000Z');
    const reload = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useReloadOnSync(reload));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads exactly once when the last-synced timestamp changes', async () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useReloadOnSync(reload));

    completeSyncRound('2026-06-01T10:00:00.000Z');

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('reloads again on each SUBSEQUENT successful round', async () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useReloadOnSync(reload));

    completeSyncRound('2026-06-01T10:00:00.000Z');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    completeSyncRound('2026-06-01T10:05:00.000Z');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it('does not reload when an unrelated sync field changes', async () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useReloadOnSync(reload));

    act(() => {
      // A failed round: SyncScheduler sets the error but NOT lastSyncAt.
      useSyncStore.getState().setError('offline');
      useSyncStore.getState().setPendingSyncCount(3);
      useSyncStore.getState().setSyncStatus('syncing');
    });

    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
  });

  it('re-stamping the SAME timestamp does not reload twice', async () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    renderHook(() => useReloadOnSync(reload));

    completeSyncRound('2026-06-01T10:00:00.000Z');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    completeSyncRound('2026-06-01T10:00:00.000Z');
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('skips a round that arrives while a reload is still in flight', async () => {
    let finishFirst: (() => void) | null = null;
    const reload = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    renderHook(() => useReloadOnSync(reload));

    completeSyncRound('2026-06-01T10:00:00.000Z');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    completeSyncRound('2026-06-01T10:01:00.000Z');
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst!();
    });

    // A LATER round still reloads — the skip is not sticky.
    completeSyncRound('2026-06-01T10:02:00.000Z');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });
});

describe('useEnvelopes reloads on a successful sync (VAL-5)', () => {
  it('loads once on mount and once more per successful round', async () => {
    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, PERIOD));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const mountCalls = mockFrom.mock.calls.length;
    expect(mountCalls).toBe(1); // the mount effect only — no double initial load

    completeSyncRound('2026-06-01T10:00:00.000Z');

    await waitFor(() => expect(mockFrom.mock.calls.length).toBe(mountCalls + 1));
  });
});

describe('useTransactions reloads on a successful sync (VAL-5)', () => {
  it('does not query on mount, then queries once per successful round', async () => {
    renderHook(() => useTransactions(HOUSEHOLD, PERIOD));

    // This hook has no mount effect — screens load it on focus.
    expect(mockFrom).not.toHaveBeenCalled();

    completeSyncRound('2026-06-01T10:00:00.000Z');

    await waitFor(() => expect(mockFrom).toHaveBeenCalledTimes(1));
  });
});

describe('useDebts reloads on a successful sync (VAL-5)', () => {
  it('does not query on mount, then queries once per successful round', async () => {
    renderHook(() => useDebts(HOUSEHOLD));

    expect(mockFrom).not.toHaveBeenCalled();

    completeSyncRound('2026-06-01T10:00:00.000Z');

    await waitFor(() => expect(mockFrom).toHaveBeenCalledTimes(1));
  });
});

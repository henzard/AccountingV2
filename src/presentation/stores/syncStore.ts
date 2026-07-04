import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import type { SyncStatusSink } from '../../data/sync/SyncScheduler';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface SyncState {
  isOnline: boolean;
  pendingSyncCount: number;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  /** Last sync round's failure message, or null if the last round succeeded
   * (or none has run yet). Populated by `SyncScheduler` (Task 4). */
  error: string | null;
  /** Mirrors `SyncEngine.getPullHealth(householdId).blocked` — true when this
   * household's puller is stalled on a poison batch (needs a code fix, not a
   * retry — see SyncEngine.ts §7.2). Populated by `SyncScheduler` (Task 4). */
  pullBlocked: boolean;
}

interface SyncActions {
  setIsOnline: (online: boolean) => void;
  setPendingSyncCount: (count: number) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  setError: (message: string | null) => void;
  setPullBlocked: (blocked: boolean) => void;
  /** Reset to initial values (call on sign-out). */
  reset: () => void;
}

const INITIAL_STATE: SyncState = {
  isOnline: true, // optimistic default — avoids offline flash on app open
  pendingSyncCount: 0,
  syncStatus: 'idle',
  lastSyncAt: null,
  error: null,
  pullBlocked: false,
};

export const useSyncStore = create<SyncState & SyncActions>((set) => ({
  ...INITIAL_STATE,
  setIsOnline: (isOnline) => set({ isOnline }),
  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setError: (error) => set({ error }),
  setPullBlocked: (pullBlocked) => set({ pullBlocked }),
  reset: () => set(INITIAL_STATE),
}));

/**
 * Concrete `SyncStatusSink` (see `data/sync/SyncScheduler.ts`) backed by this
 * store. Lives here — not in `data/sync` — so `SyncScheduler` has zero import
 * of `presentation/*`; dependencies still point inward (presentation depends
 * on data, not the reverse). `syncStatus` tracks only whether a round is
 * currently in flight (`'syncing'` <-> `'idle'`); the richer per-round outcome
 * lives in `error` (message or null) and `lastSyncAt` (last success time), so
 * a round that completes without throwing but with `pullBlocked: true` (a
 * poison batch — SyncEngine never throws for that, see §7.2) still correctly
 * returns `syncStatus` to `'idle'` instead of getting stuck on `'syncing'`.
 *
 * Task 5 passes this to `new SyncScheduler({ ..., statusSink: syncStoreStatusSink })`.
 */
export const syncStoreStatusSink: SyncStatusSink = {
  setSyncing: (isSyncing) => useSyncStore.getState().setSyncStatus(isSyncing ? 'syncing' : 'idle'),
  setLastSyncedAt: (iso) => useSyncStore.getState().setLastSyncAt(iso),
  setPendingCount: (count) => useSyncStore.getState().setPendingSyncCount(count),
  setError: (message) => useSyncStore.getState().setError(message),
  setPullBlocked: (blocked) => useSyncStore.getState().setPullBlocked(blocked),
};

let _unsubscribe: (() => void) | null = null;

/**
 * Wire NetInfo events to syncStore.isOnline.
 * Call once at app start (App.tsx). Returns the unsubscribe function.
 */
export function subscribeNetworkChanges(): () => void {
  if (_unsubscribe) return _unsubscribe;
  const rawUnsub = NetInfo.addEventListener((state) => {
    // Treat null isInternetReachable as optimistic (reachable) to avoid
    // false-offline flicker during app start when the value is not yet known.
    const online = state.isConnected === true && state.isInternetReachable !== false;
    useSyncStore.getState().setIsOnline(online);
  });
  _unsubscribe = () => {
    rawUnsub();
    _unsubscribe = null;
  };
  return _unsubscribe;
}

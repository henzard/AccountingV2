import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface SyncState {
  isOnline: boolean;
  pendingSyncCount: number;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
}

interface SyncActions {
  setIsOnline: (online: boolean) => void;
  setPendingSyncCount: (count: number) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  /** Reset to initial values (call on sign-out). */
  reset: () => void;
}

const INITIAL_STATE: SyncState = {
  isOnline: true, // optimistic default — avoids offline flash on app open
  pendingSyncCount: 0,
  syncStatus: 'idle',
  lastSyncAt: null,
};

export const useSyncStore = create<SyncState & SyncActions>((set) => ({
  ...INITIAL_STATE,
  setIsOnline: (isOnline) => set({ isOnline }),
  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  reset: () => set(INITIAL_STATE),
}));

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

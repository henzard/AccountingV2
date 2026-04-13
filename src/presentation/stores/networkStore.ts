/**
 * networkStore — Zustand store for network connectivity state.
 *
 * Populated by calling subscribeNetworkStore() which wires
 * @react-native-community/netinfo into this store.
 * Consumed by OfflineBanner.
 */

import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';

interface NetworkState {
  isOnline: boolean;
}

interface NetworkActions {
  setIsOnline: (online: boolean) => void;
}

export const useNetworkStore = create<NetworkState & NetworkActions>((set) => ({
  isOnline: true, // optimistic default — avoids flash on app open
  setIsOnline: (isOnline: boolean): void => set({ isOnline }),
}));

let _unsubscribe: (() => void) | null = null;

/**
 * Subscribe NetInfo events to networkStore.
 * Call once at app start (App.tsx). Call stop() on cleanup.
 */
export function subscribeNetworkStore(): () => void {
  if (_unsubscribe) return _unsubscribe;
  _unsubscribe = NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable);
    useNetworkStore.getState().setIsOnline(online);
  });
  return _unsubscribe;
}

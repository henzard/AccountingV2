/* eslint-disable @typescript-eslint/no-require-imports */
import { useSyncStore } from '../syncStore';

let mockEventListenerCallback:
  | ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void)
  | null = null;
const mockUnsubscribe = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(
    (cb: (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) => {
      mockEventListenerCallback = cb;
      return mockUnsubscribe;
    },
  ),
}));

describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({
      isOnline: true,
      pendingSyncCount: 0,
      syncStatus: 'idle',
      lastSyncAt: null,
    });
  });

  it('setIsOnline updates isOnline', () => {
    useSyncStore.getState().setIsOnline(false);
    expect(useSyncStore.getState().isOnline).toBe(false);
  });

  it('setPendingSyncCount updates pendingSyncCount', () => {
    useSyncStore.getState().setPendingSyncCount(3);
    expect(useSyncStore.getState().pendingSyncCount).toBe(3);
  });

  it('setSyncStatus updates syncStatus', () => {
    useSyncStore.getState().setSyncStatus('syncing');
    expect(useSyncStore.getState().syncStatus).toBe('syncing');
  });

  it('setLastSyncAt updates lastSyncAt', () => {
    useSyncStore.getState().setLastSyncAt('2026-04-15T12:00:00Z');
    expect(useSyncStore.getState().lastSyncAt).toBe('2026-04-15T12:00:00Z');
  });

  it('reset restores initial values', () => {
    useSyncStore.setState({
      isOnline: false,
      pendingSyncCount: 5,
      syncStatus: 'error',
      lastSyncAt: '2026-04-15T12:00:00Z',
    });
    useSyncStore.getState().reset();
    const s = useSyncStore.getState();
    expect(s.isOnline).toBe(true);
    expect(s.pendingSyncCount).toBe(0);
    expect(s.syncStatus).toBe('idle');
    expect(s.lastSyncAt).toBeNull();
  });
});

describe('subscribeNetworkChanges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventListenerCallback = null;
    // Reset the module-level _unsubscribe by calling the returned unsub
    // We need to isolate each test from the singleton guard
    jest.resetModules();
  });

  // Use fresh imports for each test to reset _unsubscribe singleton
  function getModule() {
    jest.resetModules();
    jest.mock('@react-native-community/netinfo', () => ({
      addEventListener: jest.fn((cb: (s: unknown) => void) => {
        mockEventListenerCallback = cb as typeof mockEventListenerCallback;
        return mockUnsubscribe;
      }),
    }));
    return require('../syncStore') as typeof import('../syncStore');
  }

  it('subscribes to NetInfo and returns an unsubscribe function', () => {
    const mod = getModule();
    const unsub = mod.subscribeNetworkChanges();
    expect(typeof unsub).toBe('function');
    expect(mockEventListenerCallback).not.toBeNull();
  });

  it('does not subscribe twice when called multiple times', () => {
    const mod = getModule();
    const NetInfo = require('@react-native-community/netinfo');
    const unsub1 = mod.subscribeNetworkChanges();
    const unsub2 = mod.subscribeNetworkChanges();
    expect(unsub1).toBe(unsub2);
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('sets isOnline=true when connected and reachable', () => {
    const mod = getModule();
    mod.subscribeNetworkChanges();
    mockEventListenerCallback!({ isConnected: true, isInternetReachable: true });
    expect(mod.useSyncStore.getState().isOnline).toBe(true);
  });

  it('sets isOnline=false when not connected', () => {
    const mod = getModule();
    mod.subscribeNetworkChanges();
    mockEventListenerCallback!({ isConnected: false, isInternetReachable: false });
    expect(mod.useSyncStore.getState().isOnline).toBe(false);
  });

  it('treats isInternetReachable=null as online (optimistic)', () => {
    const mod = getModule();
    mod.subscribeNetworkChanges();
    mockEventListenerCallback!({ isConnected: true, isInternetReachable: null });
    expect(mod.useSyncStore.getState().isOnline).toBe(true);
  });

  it('sets isOnline=false when connected but not reachable', () => {
    const mod = getModule();
    mod.subscribeNetworkChanges();
    mockEventListenerCallback!({ isConnected: true, isInternetReachable: false });
    expect(mod.useSyncStore.getState().isOnline).toBe(false);
  });

  it('unsubscribe calls the raw NetInfo unsubscribe', () => {
    const mod = getModule();
    const unsub = mod.subscribeNetworkChanges();
    unsub();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('allows re-subscribing after unsubscribe', () => {
    const mod = getModule();
    const NetInfo = require('@react-native-community/netinfo');
    const unsub = mod.subscribeNetworkChanges();
    unsub();
    mod.subscribeNetworkChanges();
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(2);
  });
});

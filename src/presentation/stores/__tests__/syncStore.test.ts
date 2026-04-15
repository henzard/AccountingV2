import { useSyncStore } from '../syncStore';

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
    useSyncStore.setState({ isOnline: false, pendingSyncCount: 5, syncStatus: 'error' });
    useSyncStore.getState().reset();
    const s = useSyncStore.getState();
    expect(s.isOnline).toBe(true);
    expect(s.pendingSyncCount).toBe(0);
    expect(s.syncStatus).toBe('idle');
    expect(s.lastSyncAt).toBeNull();
  });
});

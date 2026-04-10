import { act, renderHook } from '@testing-library/react-native';
import { useAppStore } from './appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      session: null,
      userLevel: 1,
      currentPeriod: null,
      syncStatus: 'idle',
    } as any);
  });

  it('initial state has no session', () => {
    const { result } = renderHook(() => useAppStore());
    expect(result.current.session).toBeNull();
    expect(result.current.userLevel).toBe(1);
  });

  it('setSession updates session', () => {
    const { result } = renderHook(() => useAppStore());
    act(() => {
      result.current.setSession({ access_token: 'tok' } as any);
    });
    expect(result.current.session?.access_token).toBe('tok');
  });

  it('setSyncStatus updates status', () => {
    const { result } = renderHook(() => useAppStore());
    act(() => { result.current.setSyncStatus('syncing'); });
    expect(result.current.syncStatus).toBe('syncing');
  });
});

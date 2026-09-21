import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
  };
});

// ─── syncStore mock (mutable so each test can shape it) ────────────────────
let mockSyncState = {
  isOnline: true,
  pullBlocked: false,
  pendingSyncCount: 0,
  syncStatus: 'idle' as 'idle' | 'syncing' | 'error' | 'success',
};
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: (sel: (s: typeof mockSyncState) => unknown) => sel(mockSyncState),
}));

// ─── syncEngineStore mock ───────────────────────────────────────────────────
const mockEngine = { listDeadLettered: jest.fn(() => [] as unknown[]) };
let mockEngineState: { engine: typeof mockEngine | null } = { engine: mockEngine };
jest.mock('../../../stores/syncEngineStore', () => ({
  useSyncEngineStore: (sel: (s: typeof mockEngineState) => unknown) => sel(mockEngineState),
}));

// ─── appStore mock ──────────────────────────────────────────────────────────
const mockAppState = { householdId: 'hh-1' };
jest.mock('../../../stores/appStore', () => ({
  useAppStore: (sel: (s: typeof mockAppState) => unknown) => sel(mockAppState),
}));

// ─── navigation mock: NavigationContext provides a fake `navigate` so the
// tappable states can be asserted without a real NavigationContainer. ───────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactForMock = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    // A thin wrapper, not `{ navigate: mockNavigate }` directly: `jest.mock`
    // factories are hoisted above `const mockNavigate = jest.fn()`, so the
    // context's default value would otherwise capture `undefined` at module
    // load time. The wrapper defers the `mockNavigate` lookup to call time,
    // by which point the real binding is long since assigned.
    NavigationContext: ReactForMock.createContext({
      navigate: (...args: unknown[]) => mockNavigate(...args),
    }),
  };
});

import { OfflineBanner } from '../OfflineBanner';

describe('OfflineBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncState = {
      isOnline: true,
      pullBlocked: false,
      pendingSyncCount: 0,
      syncStatus: 'idle',
    };
    mockEngineState = { engine: mockEngine };
    mockEngine.listDeadLettered.mockReturnValue([]);
  });

  it('returns null when online, not pull-blocked and nothing dead-lettered', () => {
    const { queryByTestId } = render(<OfflineBanner />);
    expect(queryByTestId('offline-banner')).toBeNull();
  });

  it('renders banner when offline', () => {
    mockSyncState.isOnline = false;
    const { getByTestId } = render(<OfflineBanner />);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });

  it('shows offline message text', () => {
    mockSyncState.isOnline = false;
    const { getByText } = render(<OfflineBanner />);
    expect(getByText(/offline/i)).toBeTruthy();
  });

  it('is not tappable while offline, even if also pull-blocked', () => {
    mockSyncState.isOnline = false;
    mockSyncState.pullBlocked = true;
    const { getByTestId, getByText } = render(<OfflineBanner />);
    expect(getByText(/offline/i)).toBeTruthy();
    fireEvent.press(getByTestId('offline-banner'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the pull-stuck message when online but pull is blocked, and tapping navigates to Sync Health', () => {
    mockSyncState.isOnline = true;
    mockSyncState.pullBlocked = true;
    const { getByTestId, getByText } = render(<OfflineBanner />);
    expect(getByText(/sync is stuck/i)).toBeTruthy();

    fireEvent.press(getByTestId('offline-banner'));
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'Settings',
      params: { screen: 'SyncHealth' },
    });
  });

  it('shows the dead-letter message when online, not pull-blocked, with dead-lettered items, and tapping navigates to Sync Health', () => {
    mockSyncState.isOnline = true;
    mockSyncState.pullBlocked = false;
    mockEngine.listDeadLettered.mockReturnValue([{ opId: 'op-1' }]);
    const { getByTestId, getByText } = render(<OfflineBanner />);
    expect(getByText(/couldn't sync/i)).toBeTruthy();

    fireEvent.press(getByTestId('offline-banner'));
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'Settings',
      params: { screen: 'SyncHealth' },
    });
  });

  it('pull-blocked wins over dead-lettered when both are true (still just the one banner)', () => {
    mockSyncState.pullBlocked = true;
    mockEngine.listDeadLettered.mockReturnValue([{ opId: 'op-1' }]);
    const { getByText, queryByText } = render(<OfflineBanner />);
    expect(getByText(/sync is stuck/i)).toBeTruthy();
    expect(queryByText(/couldn't sync/i)).toBeNull();
  });

  it('renders nothing for a transient/backing-off error alone (no pullBlocked, no dead letters)', () => {
    mockSyncState.isOnline = true;
    mockSyncState.pullBlocked = false;
    mockSyncState.syncStatus = 'error';
    mockEngine.listDeadLettered.mockReturnValue([]);
    const { queryByTestId } = render(<OfflineBanner />);
    expect(queryByTestId('offline-banner')).toBeNull();
  });
});

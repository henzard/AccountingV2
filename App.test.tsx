/**
 * App.test.tsx — Task 5 boot rework
 *
 * Covers the three deep-review findings this task fixes:
 *  1. Cold start renders from LOCAL SQLite only and never blocks first paint
 *     on RestoreService/network (a hung/offline restore must not delay it).
 *  2. The auth listener is filtered to SIGNED_IN — INITIAL_SESSION and
 *     TOKEN_REFRESHED never re-run `initSession`.
 *  3. A household switch re-points the SyncScheduler (stop the old
 *     household's triggers, start the new one's, kick an immediate sync) —
 *     fixes "switch shows empty data".
 *
 * Nearly everything App.tsx composes is mocked here except the real zustand
 * stores it drives directly (appStore, celebrationStore, toastStore) — this
 * is a composition-root file, so the test's job is to verify the WIRING
 * (what gets called, in what order, gated on what), not re-test any of the
 * individual collaborators (those have their own unit tests).
 *
 * Every jest.mock() factory below is self-contained (creates its own
 * jest.fn()s, never references an outer `const`) — ESM import hoisting
 * means `import App from './App'` actually executes ABOVE any interspersed
 * top-level `const` in this file, so a factory referencing an outer
 * `mockFoo` would see it as `undefined` at call time. Handles to the
 * jest.fn()s created inside factories are obtained AFTER the fact via
 * `jest.requireMock(...)`, which runs in normal (non-hoisted) order.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
  hideAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./src/infrastructure/monitoring/earlyCrashLog', () => ({
  installEarlyCrashHandler: jest.fn(),
  captureBoot: jest.fn(),
}));

jest.mock('./src/data/local/db', () => ({
  db: {},
  useDatabaseMigrations: jest.fn(() => ({ success: true })),
}));

jest.mock('./src/presentation/theme/useFonts', () => ({
  useFonts: jest.fn(() => ({ fontsLoaded: true, fontError: null })),
}));

jest.mock('./src/presentation/navigation/RootNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native');
  return {
    RootNavigator: () =>
      ReactLib.createElement(RNText, { testID: 'root-navigator' }, 'Root Navigator'),
  };
});

// react-native-safe-area-context's SafeAreaProvider only renders children
// once it has received a NATIVE onInsetsChange layout event (see its source:
// children render behind `insets != null ? children : null`) -- that event
// never fires under the plain JS test renderer, so EVERY descendant
// (including react-native-paper's PaperProvider, which wraps its children in
// its OWN internal SafeAreaProviderCompat consuming SafeAreaInsetsContext)
// would otherwise never mount. Stub the whole module with a passthrough
// provider plus a real Context defaulting to zero insets, so
// `SafeAreaInsetsContext.Consumer` resolves to a non-null value with no
// Provider needed in the tree.
jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react');
  const defaultInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const defaultFrame = { x: 0, y: 0, width: 0, height: 0 };
  const SafeAreaInsetsContext = ReactLib.createContext(defaultInsets);
  const SafeAreaFrameContext = ReactLib.createContext(defaultFrame);
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    initialWindowMetrics: { insets: defaultInsets, frame: defaultFrame },
    useSafeAreaInsets: () => defaultInsets,
    useSafeAreaFrame: () => defaultFrame,
  };
});

jest.mock('./src/presentation/boot/BootRecoveryGate', () => ({
  BootRecoveryGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('./src/presentation/boot/BootErrorBoundary', () => ({
  BootErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('./src/data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
      getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      onAuthStateChange: jest.fn((cb: unknown) => ({
        data: { subscription: { unsubscribe: jest.fn() } },
        __callback: cb,
      })),
      setSession: jest.fn(() =>
        Promise.resolve({ data: { session: null, user: null }, error: null }),
      ),
    },
    rpc: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));

// ─── appLinking (password-recovery deep link) ────────────────────────────────
// Mocks OUR OWN thin wrapper (src/infrastructure/device/appLinking.ts) rather
// than react-native's `Linking` directly — react-native's index defines most
// exports (Linking included) as getter-backed properties on a non-extensible
// module object for lazy native loading, which makes them effectively
// unmockable in place (a plain assignment silently no-ops; spreading the
// whole module eagerly evaluates unrelated native-only exports like DevMenu
// and throws outside a real native runtime). Mocking our own wrapper module
// sidesteps all of that, the same way `getDeviceId`/`networkObserver` do for
// their native dependencies elsewhere in this file.
const mockLinkingRemove = jest.fn();
const mockAddUrlListener = jest.fn((_handler: (event: { url: string }) => void) => ({
  remove: mockLinkingRemove,
}));
const mockGetInitialURL = jest.fn((): Promise<string | null> => Promise.resolve(null));
jest.mock('./src/infrastructure/device/appLinking', () => ({
  addUrlListener: (handler: (event: { url: string }) => void) => mockAddUrlListener(handler),
  getInitialURL: () => mockGetInitialURL(),
}));

jest.mock('./src/domain/households/EnsureHouseholdUseCase', () => {
  const execute = jest.fn().mockResolvedValue({ success: false });
  return {
    EnsureHouseholdUseCase: jest.fn().mockImplementation(() => ({ execute })),
    __mockExecute: execute,
  };
});

jest.mock('./src/data/sync/RestoreService', () => {
  // Hangs forever by default -- stands in for "offline"/a dead network call.
  // The boot gate must NEVER await this.
  const restore = jest.fn().mockReturnValue(new Promise(() => {}));
  return {
    RestoreService: jest.fn().mockImplementation(() => ({ restore })),
    __mockRestore: restore,
  };
});

jest.mock('./src/domain/babySteps/SeedBabyStepsUseCase', () => ({
  SeedBabyStepsUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('./src/infrastructure/notifications/FcmTokenRegistrar', () => ({
  registerFcmToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./src/infrastructure/monitoring/crashlytics', () => ({
  initCrashlytics: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./src/presentation/stores/themeStore', () => ({
  hydrateThemeFromLocal: jest.fn().mockResolvedValue(undefined),
  hydrateThemeFromRemote: jest.fn().mockResolvedValue(undefined),
  resetThemeStore: jest.fn(),
}));

jest.mock('./src/infrastructure/network/NetworkObserver', () => ({
  networkObserver: { start: jest.fn(), stop: jest.fn(), onConnected: jest.fn() },
}));

jest.mock('./src/presentation/stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ reset: jest.fn() }) },
  subscribeNetworkChanges: jest.fn(() => jest.fn()),
  syncStoreStatusSink: {},
}));

jest.mock('./src/infrastructure/device/deviceId', () => ({
  getDeviceId: jest.fn().mockResolvedValue('device-1'),
}));

jest.mock('./src/data/sync/SyncEngine', () => ({
  createSyncEngine: jest.fn(() => ({ fakeEngine: true })),
}));

jest.mock('./src/data/sync/SyncScheduler', () => {
  const instance = {
    start: jest.fn(),
    stop: jest.fn(),
    requestSync: jest.fn(),
    isStarted: false,
  };
  return {
    SyncScheduler: jest.fn().mockImplementation(() => instance),
    __mockSchedulerInstance: instance,
  };
});

jest.mock('./src/data/repositories/DrizzleSlipQueueRepository', () => ({
  DrizzleSlipQueueRepository: jest.fn().mockImplementation(() => ({
    listProcessingOlderThan: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('./src/infrastructure/slipScanning/SlipImageLocalStore', () => ({
  SlipImageLocalStore: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('./src/domain/slipScanning/CleanupExpiredSlipsUseCase', () => ({
  CleanupExpiredSlipsUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
}));

import App from './App';
import { useAppStore } from './src/presentation/stores/appStore';

// Handles into the jest.fn()s created inside the factories above.
const SplashScreen = jest.requireMock('expo-splash-screen') as {
  preventAutoHideAsync: jest.Mock;
  hideAsync: jest.Mock;
};
const supabaseMock = jest.requireMock('./src/data/remote/supabaseClient') as {
  supabase: {
    auth: {
      getSession: jest.Mock;
      onAuthStateChange: jest.Mock;
      setSession: jest.Mock;
    };
  };
};
const { __mockExecute: mockEnsureExecute } = jest.requireMock(
  './src/domain/households/EnsureHouseholdUseCase',
) as { __mockExecute: jest.Mock };
const { __mockRestore: mockRestore } = jest.requireMock('./src/data/sync/RestoreService') as {
  __mockRestore: jest.Mock;
};
const { __mockSchedulerInstance: mockSchedulerInstance } = jest.requireMock(
  './src/data/sync/SyncScheduler',
) as {
  __mockSchedulerInstance: {
    start: jest.Mock;
    stop: jest.Mock;
    requestSync: jest.Mock;
    isStarted: boolean;
  };
};

function successResult(id: string, paydayDay = 25): unknown {
  return { success: true, data: { id, name: 'Test HH', paydayDay, userLevel: 1 } };
}

function setSession(session: { user: { id: string } } | null): void {
  supabaseMock.supabase.auth.getSession.mockResolvedValue({ data: { session } });
}

function getAuthCallback(): (event: string, session: unknown) => Promise<void> {
  const call = supabaseMock.supabase.auth.onAuthStateChange.mock.calls[0];
  return call[0] as (event: string, session: unknown) => Promise<void>;
}

function getDeepLinkHandler(): (event: { url: string }) => void {
  const call = mockAddUrlListener.mock.calls[0];
  return call[0] as (event: { url: string }) => void;
}

// Cleared in afterEach (not beforeEach): `preventAutoHideAsync` runs once at
// App.tsx's MODULE LOAD, before the FIRST test's beforeEach would ever run --
// clearing in beforeEach would wipe that call before any test body could
// observe it. afterEach still isolates every test from the next.
afterEach(() => {
  jest.clearAllMocks();
});

beforeEach(() => {
  useAppStore.getState().reset();
  setSession(null);
  mockEnsureExecute.mockResolvedValue({ success: false });
  // Default: RestoreService hangs forever -- the boot gate must NEVER wait on
  // this (a stand-in for "offline"/a dead network call).
  mockRestore.mockReturnValue(new Promise(() => {}));
  mockSchedulerInstance.isStarted = false;
  SplashScreen.preventAutoHideAsync.mockResolvedValue(undefined);
  SplashScreen.hideAsync.mockResolvedValue(undefined);
  mockGetInitialURL.mockResolvedValue(null);
  supabaseMock.supabase.auth.setSession.mockResolvedValue({
    data: { session: null, user: null },
    error: null,
  });
});

describe('App boot (Task 5)', () => {
  it('renders RootNavigator from local state even though RestoreService never resolves (offline cold start)', async () => {
    setSession({ user: { id: 'user-1' } });
    mockEnsureExecute.mockResolvedValue(successResult('hh-1'));
    // mockRestore left hanging (see beforeEach) -- simulates offline/dead network.

    const { findByTestId } = render(<App />);

    // Must resolve WITHOUT ever waiting on the hung restore() call.
    await findByTestId('root-navigator');
    expect(useAppStore.getState().householdId).toBe('hh-1');

    // `preventAutoHideAsync` runs once at module load (before any test body
    // runs) so it can only be observed in the FIRST test in this file to
    // exercise App.tsx's module evaluation; asserted here rather than a
    // dedicated test, which would see 0 calls after `jest.clearAllMocks()`.
    expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalled();
  });

  it('hides the native splash screen once local boot is ready, not before', async () => {
    setSession(null);

    const { findByTestId } = render(<App />);
    await findByTestId('root-navigator');

    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it('renders from local with no session at all (new/logged-out user), never blocking on auth network calls', async () => {
    setSession(null);

    const { findByTestId } = render(<App />);
    await findByTestId('root-navigator');
    expect(useAppStore.getState().householdId).toBeNull();
  });

  it('auth listener: SIGNED_IN runs initSession once; INITIAL_SESSION/TOKEN_REFRESHED never re-run it', async () => {
    // Distinct user id -- App.tsx's initSession double-run guard tracks
    // "completed" userIds at MODULE scope (persists across tests in this
    // file), so reusing an id another test already completed would make
    // this test's SIGNED_IN look like a no-op for the wrong reason.
    const userId = 'user-auth-listener-test';
    setSession(null); // cold start: no persisted session
    mockEnsureExecute.mockResolvedValue(successResult('hh-auth-test'));

    const { findByTestId } = render(<App />);
    await findByTestId('root-navigator');
    expect(mockEnsureExecute).not.toHaveBeenCalled(); // no session yet -- nothing to resolve

    const authCallback = getAuthCallback();

    // INITIAL_SESSION / TOKEN_REFRESHED carry a session but must be ignored.
    await act(async () => {
      await authCallback('INITIAL_SESSION', { user: { id: userId } });
    });
    expect(mockEnsureExecute).not.toHaveBeenCalled();

    await act(async () => {
      await authCallback('TOKEN_REFRESHED', { user: { id: userId } });
    });
    expect(mockEnsureExecute).not.toHaveBeenCalled();

    // A genuine SIGNED_IN runs it exactly once.
    await act(async () => {
      await authCallback('SIGNED_IN', { user: { id: userId } });
    });
    expect(mockEnsureExecute).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().householdId).toBe('hh-auth-test');

    // A repeat SIGNED_IN for the SAME user is a no-op (double-run guard).
    await act(async () => {
      await authCallback('SIGNED_IN', { user: { id: userId } });
    });
    expect(mockEnsureExecute).toHaveBeenCalledTimes(1);
  });

  it('household switch re-points the scheduler: stop old, start new, immediate sync requested', async () => {
    setSession({ user: { id: 'user-household-switch-test' } });
    mockEnsureExecute.mockResolvedValue(successResult('hh-1'));

    const { findByTestId } = render(<App />);
    await findByTestId('root-navigator');

    await waitFor(() => expect(mockSchedulerInstance.start).toHaveBeenCalledWith('hh-1'));
    expect(mockSchedulerInstance.requestSync).toHaveBeenCalledWith('hh-1', { immediate: true });

    mockSchedulerInstance.isStarted = true;
    mockSchedulerInstance.start.mockClear();
    mockSchedulerInstance.stop.mockClear();
    mockSchedulerInstance.requestSync.mockClear();

    // Simulate HouseholdPickerScreen's handleSelect -- switches the household.
    await act(async () => {
      useAppStore.getState().setHouseholdId('hh-2');
    });

    await waitFor(() => expect(mockSchedulerInstance.start).toHaveBeenCalledWith('hh-2'));
    expect(mockSchedulerInstance.stop).toHaveBeenCalled();
    expect(mockSchedulerInstance.requestSync).toHaveBeenCalledWith('hh-2', { immediate: true });
  });

  it('degrades gracefully instead of hanging on splash forever when local init throws (EnsureHouseholdUseCase rejects)', async () => {
    // Regression test for the "splash hangs forever if local init throws"
    // boot-hang: EnsureHouseholdUseCase.execute() is normally only ever
    // mocked with mockResolvedValue in this file -- a REJECTED local init
    // (a real SQLite constraint violation, null, schema mismatch, ...)
    // previously rethrew out of the cold-start effect's un-.catch()'d async
    // IIFE, skipping `setLocalBootReady(true)` so `bootDecided` never became
    // true, `SplashScreen.hideAsync()` was never called, and the render gate
    // returned `null` forever -- a permanent splash/blank screen with no
    // error UI and no recovery. This test hangs (times out waiting for
    // 'root-navigator') and fails against the pre-fix code; it passes once
    // the cold-start effect catches the error, captures it via
    // `captureBoot`, and still resolves boot instead of rethrowing.
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      setSession({ user: { id: 'user-local-init-throws' } });
      mockEnsureExecute.mockRejectedValue(new Error('local sqlite boom'));

      const { findByTestId } = render(<App />);

      // (a) Must NOT hang on splash forever -- the app renders SOMETHING
      // (here, the mocked RootNavigator) instead of `return null` forever.
      await findByTestId('root-navigator');

      // Flush any pending microtask/macrotask queues so a stray unhandled
      // rejection from the old (buggy) code path has a chance to surface
      // before we assert on `unhandledRejections` below.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // (b) The native splash screen must actually be dismissed.
      expect(SplashScreen.hideAsync).toHaveBeenCalled();

      // Degrades to the SAME "no household resolved" state
      // EnsureHouseholdUseCase returning `{ success: false }` already
      // produces -- RootNavigator already renders the create/join choice
      // screen for an authenticated user with no household, so this is a
      // safe, already-handled degrade rather than a new render path.
      expect(useAppStore.getState().householdId).toBeNull();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }

    // (c) No unhandled rejection should have escaped from the boot sequence.
    expect(unhandledRejections).toEqual([]);
  });

  describe('password recovery (Task 4)', () => {
    it('PASSWORD_RECOVERY auth event sets passwordRecoveryPending and never runs initSession', async () => {
      setSession(null);

      const { findByTestId } = render(<App />);
      await findByTestId('root-navigator');

      const authCallback = getAuthCallback();
      await act(async () => {
        await authCallback('PASSWORD_RECOVERY', { user: { id: 'user-recovery' } });
      });

      expect(useAppStore.getState().passwordRecoveryPending).toBe(true);
      expect(mockEnsureExecute).not.toHaveBeenCalled();
    });

    it('a genuine recovery deep link (via addEventListener) sets passwordRecoveryPending and calls setSession with the parsed tokens', async () => {
      setSession(null);

      const { findByTestId } = render(<App />);
      await findByTestId('root-navigator');

      const handleUrl = getDeepLinkHandler();
      await act(async () => {
        handleUrl({
          url: 'accountingv2://reset-password#access_token=at-1&refresh_token=rt-1&type=recovery',
        });
      });

      expect(useAppStore.getState().passwordRecoveryPending).toBe(true);
      expect(supabaseMock.supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'at-1',
        refresh_token: 'rt-1',
      });
    });

    it('a recovery deep link present as the initial URL (cold start via the link) is handled the same way', async () => {
      setSession(null);
      mockGetInitialURL.mockResolvedValue(
        'accountingv2://reset-password#access_token=at-2&refresh_token=rt-2&type=recovery',
      );

      const { findByTestId } = render(<App />);
      await findByTestId('root-navigator');

      await waitFor(() => {
        expect(useAppStore.getState().passwordRecoveryPending).toBe(true);
      });
      expect(supabaseMock.supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'at-2',
        refresh_token: 'rt-2',
      });
    });

    it('ignores a deep link that is not a recovery link', async () => {
      setSession(null);

      const { findByTestId } = render(<App />);
      await findByTestId('root-navigator');

      const handleUrl = getDeepLinkHandler();
      await act(async () => {
        handleUrl({ url: 'accountingv2://some/other/path' });
      });

      expect(useAppStore.getState().passwordRecoveryPending).toBe(false);
      expect(supabaseMock.supabase.auth.setSession).not.toHaveBeenCalled();
    });

    it('removes the deep-link listener on unmount', async () => {
      setSession(null);
      const { findByTestId, unmount } = render(<App />);
      await findByTestId('root-navigator');

      unmount();
      expect(mockLinkingRemove).toHaveBeenCalled();
    });
  });
});

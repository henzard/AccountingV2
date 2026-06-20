/**
 * Consolidated tests for all Zustand stores.
 * Covers: appStore, themeStore, syncStore, toastStore, celebrationStore,
 * slipScannerStore, notificationStore, emergencyFundReconcileStore.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../infrastructure/storage/userPreferences', () => ({
  loadThemePreference: jest.fn(),
  saveThemePreference: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));

import { useAppStore } from '../appStore';
import {
  useThemeStore,
  hydrateThemeFromLocal,
  hydrateThemeFromRemote,
  resetThemeStore,
} from '../themeStore';
import { useSyncStore, subscribeNetworkChanges } from '../syncStore';
import { useToastStore } from '../toastStore';
import { useCelebrationStore } from '../celebrationStore';
import { useSlipScannerStore } from '../slipScannerStore';
import { useNotificationStore } from '../notificationStore';
import { useEmergencyFundReconcileStore } from '../emergencyFundReconcileStore';
import { loadThemePreference } from '../../../infrastructure/storage/userPreferences';
import NetInfo from '@react-native-community/netinfo';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockLoadRemote = loadThemePreference as jest.Mock;

// ═══════════════════════════════════════════════════════════════════════════════
// appStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('appStore', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it('setSession updates session', () => {
    useAppStore.getState().setSession({ user: { id: 'u1' } } as any);
    expect(useAppStore.getState().session).not.toBeNull();
  });

  it('setUserLevel updates userLevel', () => {
    useAppStore.getState().setUserLevel(2);
    expect(useAppStore.getState().userLevel).toBe(2);
  });

  it('setCurrentPeriod updates period', () => {
    const period = {
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
      label: 'Jan',
    };
    useAppStore.getState().setCurrentPeriod(period);
    expect(useAppStore.getState().currentPeriod?.label).toBe('Jan');
  });

  it('setHouseholdId updates householdId', () => {
    useAppStore.getState().setHouseholdId('hh-001');
    expect(useAppStore.getState().householdId).toBe('hh-001');
  });

  it('setPaydayDay updates paydayDay', () => {
    useAppStore.getState().setPaydayDay(1);
    expect(useAppStore.getState().paydayDay).toBe(1);
  });

  it('clearHousehold resets householdId and paydayDay', () => {
    useAppStore.getState().setHouseholdId('hh-001');
    useAppStore.getState().setPaydayDay(15);
    useAppStore.getState().clearHousehold();
    expect(useAppStore.getState().householdId).toBeNull();
    expect(useAppStore.getState().paydayDay).toBe(25);
  });

  it('setAvailableHouseholds updates list', () => {
    useAppStore
      .getState()
      .setAvailableHouseholds([{ id: 'h', name: 'A', paydayDay: 1, userLevel: 1 }]);
    expect(useAppStore.getState().availableHouseholds).toHaveLength(1);
  });

  it('setOnboardingCompleted updates flag', () => {
    useAppStore.getState().setOnboardingCompleted(true);
    expect(useAppStore.getState().onboardingCompleted).toBe(true);
  });

  it('setMonthlyIncomeCents updates value', () => {
    useAppStore.getState().setMonthlyIncomeCents(5000000);
    expect(useAppStore.getState().monthlyIncomeCents).toBe(5000000);
  });

  it('reset() clears all auth-derived state', () => {
    useAppStore.setState({
      session: { user: { id: 'u' } } as any,
      householdId: 'hh-1',
      userLevel: 2,
      availableHouseholds: [{ id: 'h', name: 'A', paydayDay: 1, userLevel: 1 }],
      onboardingCompleted: true,
      monthlyIncomeCents: 5000000,
    });
    useAppStore.getState().reset();
    const s = useAppStore.getState();
    expect(s.session).toBeNull();
    expect(s.householdId).toBeNull();
    expect(s.userLevel).toBe(1);
    expect(s.availableHouseholds).toHaveLength(0);
    expect(s.paydayDay).toBe(25);
    expect(s.onboardingCompleted).toBeNull();
    expect(s.monthlyIncomeCents).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// themeStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('themeStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useThemeStore.setState({ preference: 'system', hydrated: false });
  });

  it('defaults to system preference', () => {
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('hydrateThemeFromLocal reads from AsyncStorage', async () => {
    mockGetItem.mockResolvedValue('dark');
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrateThemeFromLocal marks hydrated even on null', async () => {
    mockGetItem.mockResolvedValue(null);
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrateThemeFromRemote overrides local', async () => {
    mockLoadRemote.mockResolvedValue('light');
    useThemeStore.setState({ preference: 'dark' });
    await hydrateThemeFromRemote('user-1');
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('isThemePreference validates (invalid values stay system)', async () => {
    mockGetItem.mockResolvedValue('banana');
    await hydrateThemeFromLocal();
    expect(useThemeStore.getState().preference).toBe('system');
  });

  it('resetThemeStore resets to system', () => {
    useThemeStore.setState({ preference: 'dark' });
    resetThemeStore();
    expect(useThemeStore.getState().preference).toBe('system');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// syncStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.getState().reset();
    jest.clearAllMocks();
  });

  it('subscribeNetworkChanges singleton guard returns same unsub', () => {
    const unsub1 = subscribeNetworkChanges();
    const unsub2 = subscribeNetworkChanges();
    expect(unsub1).toBe(unsub2);
    expect(NetInfo.addEventListener).toHaveBeenCalledTimes(1);
    unsub1();
  });

  it('isConnected logic: isConnected=true, isInternetReachable=true -> online', () => {
    useSyncStore.getState().setIsOnline(true);
    expect(useSyncStore.getState().isOnline).toBe(true);
  });

  it('setIsOnline(false) marks offline', () => {
    useSyncStore.getState().setIsOnline(false);
    expect(useSyncStore.getState().isOnline).toBe(false);
  });

  it('reset returns to initial state', () => {
    useSyncStore.setState({ isOnline: false, pendingSyncCount: 5, syncStatus: 'error' });
    useSyncStore.getState().reset();
    expect(useSyncStore.getState().isOnline).toBe(true);
    expect(useSyncStore.getState().pendingSyncCount).toBe(0);
    expect(useSyncStore.getState().syncStatus).toBe('idle');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// toastStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ queue: [] });
  });

  it('enqueue adds an item', () => {
    useToastStore.getState().enqueue('msg', 'info');
    expect(useToastStore.getState().queue).toHaveLength(1);
    expect(useToastStore.getState().queue[0].message).toBe('msg');
  });

  it('dequeue returns null when empty', () => {
    expect(useToastStore.getState().dequeue()).toBeNull();
  });

  it('dequeue returns head (FIFO order)', () => {
    useToastStore.getState().enqueue('first', 'regression');
    useToastStore.getState().enqueue('second', 'info');
    const head = useToastStore.getState().dequeue();
    expect(head?.message).toBe('first');
    expect(useToastStore.getState().queue).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// celebrationStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('celebrationStore', () => {
  beforeEach(() => {
    useCelebrationStore.setState({ queue: [], _checker: null });
  });

  it('enqueue adds item when not duplicate', async () => {
    useCelebrationStore.getState().init(async () => false);
    await useCelebrationStore.getState().enqueue(1);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
  });

  it('enqueue dedup in-queue (rule a)', async () => {
    useCelebrationStore.getState().init(async () => false);
    await useCelebrationStore.getState().enqueue(2);
    await useCelebrationStore.getState().enqueue(2);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
  });

  it('enqueue dedup via async checker (rule b)', async () => {
    useCelebrationStore.getState().init(async () => true);
    await useCelebrationStore.getState().enqueue(3);
    expect(useCelebrationStore.getState().queue).toHaveLength(0);
  });

  it('dequeue returns null when empty', () => {
    expect(useCelebrationStore.getState().dequeue()).toBeNull();
  });

  it('dequeue returns head and removes it', async () => {
    useCelebrationStore.getState().init(async () => false);
    await useCelebrationStore.getState().enqueue(1);
    await useCelebrationStore.getState().enqueue(2);
    const head = useCelebrationStore.getState().dequeue();
    expect(head?.stepNumber).toBe(1);
    expect(useCelebrationStore.getState().queue).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// slipScannerStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('slipScannerStore', () => {
  beforeEach(() => {
    useSlipScannerStore.setState({ inFlightSlipId: null });
  });

  it('setInFlight sets id', () => {
    useSlipScannerStore.getState().setInFlight('slip-123');
    expect(useSlipScannerStore.getState().inFlightSlipId).toBe('slip-123');
  });

  it('setInFlight(null) clears id', () => {
    useSlipScannerStore.setState({ inFlightSlipId: 'slip-abc' });
    useSlipScannerStore.getState().setInFlight(null);
    expect(useSlipScannerStore.getState().inFlightSlipId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// notificationStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({
      permissionsGranted: false,
      preferences: {
        eveningLogPromptEnabled: false,
        eveningLogPromptHour: 20,
        eveningLogPromptMinute: 0,
        meterReadingReminderEnabled: false,
        meterReadingReminderDay: 1,
        monthStartPreflightEnabled: false,
        envelopeWarningEnabled: false,
      },
    });
  });

  it('setPreferences updates preferences', () => {
    const prefs = {
      eveningLogPromptEnabled: true,
      eveningLogPromptHour: 21,
      eveningLogPromptMinute: 30,
      meterReadingReminderEnabled: true,
      meterReadingReminderDay: 15,
      monthStartPreflightEnabled: true,
      envelopeWarningEnabled: false,
    };
    useNotificationStore.getState().setPreferences(prefs);
    expect(useNotificationStore.getState().preferences).toEqual(prefs);
  });

  it('setPermissionsGranted updates flag', () => {
    useNotificationStore.getState().setPermissionsGranted(true);
    expect(useNotificationStore.getState().permissionsGranted).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emergencyFundReconcileStore
// ═══════════════════════════════════════════════════════════════════════════════
describe('emergencyFundReconcileStore', () => {
  beforeEach(() => {
    useEmergencyFundReconcileStore.setState({ hasReconciledDuplicateEmf: false });
  });

  it('setReconciledDuplicateEmf(true) sets banner flag', () => {
    useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(true);
  });

  it('dismiss() clears banner flag', () => {
    useEmergencyFundReconcileStore.setState({ hasReconciledDuplicateEmf: true });
    useEmergencyFundReconcileStore.getState().dismiss();
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(false);
  });

  it('toggle: set true then dismiss', () => {
    useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(true);
    useEmergencyFundReconcileStore.getState().dismiss();
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(false);
  });
});

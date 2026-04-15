import { useAppStore } from './appStore';

describe('appStore — household slice', () => {
  beforeEach(() => {
    useAppStore.setState({
      householdId: null,
      paydayDay: 25,
    });
  });

  it('setHouseholdId updates householdId', () => {
    useAppStore.getState().setHouseholdId('hh-001');
    expect(useAppStore.getState().householdId).toBe('hh-001');
  });

  it('setPaydayDay updates paydayDay', () => {
    useAppStore.getState().setPaydayDay(1);
    expect(useAppStore.getState().paydayDay).toBe(1);
  });

  it('clearHousehold resets householdId to null', () => {
    useAppStore.getState().setHouseholdId('hh-001');
    useAppStore.getState().clearHousehold();
    expect(useAppStore.getState().householdId).toBeNull();
  });

  it('reset clears session, householdId and availableHouseholds', () => {
    useAppStore.setState({
      householdId: 'hh-001',
      availableHouseholds: [{ id: 'hh-001', name: 'Home', paydayDay: 25, userLevel: 1 }],
      pendingSyncCount: 5,
      onboardingCompleted: true,
    });
    useAppStore.getState().reset();
    const state = useAppStore.getState();
    expect(state.session).toBeNull();
    expect(state.householdId).toBeNull();
    expect(state.availableHouseholds).toHaveLength(0);
    expect(state.pendingSyncCount).toBe(0);
    expect(state.paydayDay).toBe(25);
    expect(state.onboardingCompleted).toBeNull();
  });

  it('setOnboardingCompleted updates the flag', () => {
    useAppStore.getState().setOnboardingCompleted(true);
    expect(useAppStore.getState().onboardingCompleted).toBe(true);
    useAppStore.getState().setOnboardingCompleted(false);
    expect(useAppStore.getState().onboardingCompleted).toBe(false);
    useAppStore.getState().setOnboardingCompleted(null);
    expect(useAppStore.getState().onboardingCompleted).toBeNull();
  });

  it('setUserLevel, setCurrentPeriod, setSyncStatus, setLastSyncAt, setPendingSyncCount, setAvailableHouseholds all update state', () => {
    const s = useAppStore.getState();
    s.setUserLevel(2);
    s.setCurrentPeriod({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
      label: 'Jan',
    });
    s.setSyncStatus('syncing');
    s.setLastSyncAt('2026-01-15T00:00:00Z');
    s.setPendingSyncCount(7);
    s.setAvailableHouseholds([{ id: 'h', name: 'A', paydayDay: 1, userLevel: 1 }]);
    s.setSession(null);
    const state = useAppStore.getState();
    expect(state.userLevel).toBe(2);
    expect(state.currentPeriod?.label).toBe('Jan');
    expect(state.syncStatus).toBe('syncing');
    expect(state.lastSyncAt).toBe('2026-01-15T00:00:00Z');
    expect(state.pendingSyncCount).toBe(7);
    expect(state.availableHouseholds).toHaveLength(1);
  });

  it('setMonthlyIncomeCents updates value', () => {
    useAppStore.getState().setMonthlyIncomeCents(5000000);
    expect(useAppStore.getState().monthlyIncomeCents).toBe(5000000);
  });

  it('reset clears monthlyIncomeCents', () => {
    useAppStore.setState({ monthlyIncomeCents: 5000000 });
    useAppStore.getState().reset();
    expect(useAppStore.getState().monthlyIncomeCents).toBeNull();
  });
});

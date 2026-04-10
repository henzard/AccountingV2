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
});

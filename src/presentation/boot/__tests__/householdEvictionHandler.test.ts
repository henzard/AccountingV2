import {
  publishHouseholdEviction,
  resetHouseholdEvictions,
} from '../../../data/sync/householdEviction';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { subscribeToHouseholdEvictions } from '../householdEvictionHandler';

const DETECTED_AT = '2026-09-20T12:00:00.000Z';
const HH_A = { id: 'hh-a', name: 'Kruger home', paydayDay: 25, userLevel: 1 as const };
const HH_B = { id: 'hh-b', name: 'Flat share', paydayDay: 1, userLevel: 1 as const };

describe('householdEvictionHandler', () => {
  let enqueue: jest.SpyInstance;

  beforeEach(() => {
    resetHouseholdEvictions();
    useAppStore.getState().setAvailableHouseholds([HH_A, HH_B]);
    useAppStore.getState().setHouseholdId(HH_A.id);
    useAppStore.getState().setPaydayDay(HH_A.paydayDay);
    enqueue = jest.spyOn(useToastStore.getState(), 'enqueue').mockImplementation(() => undefined);
  });

  afterEach(() => enqueue.mockRestore());

  it('switches to another household when the active one is evicted, and says why', () => {
    const unsubscribe = subscribeToHouseholdEvictions();
    publishHouseholdEviction({ householdId: HH_A.id, detectedAt: DETECTED_AT });

    const state = useAppStore.getState();
    expect(state.availableHouseholds.map((h) => h.id)).toEqual([HH_B.id]);
    expect(state.householdId).toBe(HH_B.id);
    expect(state.paydayDay).toBe(HH_B.paydayDay);
    expect(enqueue).toHaveBeenCalledWith("You're no longer a member of Kruger home.", 'error');
    unsubscribe();
  });

  it('falls back to the no-household gate when it was the only household', () => {
    useAppStore.getState().setAvailableHouseholds([HH_A]);
    const unsubscribe = subscribeToHouseholdEvictions();
    publishHouseholdEviction({ householdId: HH_A.id, detectedAt: DETECTED_AT });

    expect(useAppStore.getState().householdId).toBeNull();
    expect(useAppStore.getState().availableHouseholds).toEqual([]);
    unsubscribe();
  });

  it('leaves the active household alone when a different one is evicted', () => {
    const unsubscribe = subscribeToHouseholdEvictions();
    publishHouseholdEviction({ householdId: HH_B.id, detectedAt: DETECTED_AT });

    expect(useAppStore.getState().householdId).toBe(HH_A.id);
    expect(useAppStore.getState().availableHouseholds.map((h) => h.id)).toEqual([HH_A.id]);
    unsubscribe();
  });

  it('handles an eviction that was published before anything subscribed, exactly once', () => {
    publishHouseholdEviction({ householdId: HH_A.id, detectedAt: DETECTED_AT });
    const unsubscribe = subscribeToHouseholdEvictions();

    expect(useAppStore.getState().householdId).toBe(HH_B.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

import {
  consumeHouseholdEviction,
  publishHouseholdEviction,
  resetHouseholdEvictions,
  subscribeHouseholdEviction,
} from './householdEviction';

const EVICTION = { householdId: 'hh-1', detectedAt: '2026-01-01T00:00:00.000Z' };

describe('householdEviction', () => {
  beforeEach(() => resetHouseholdEvictions());
  afterEach(() => resetHouseholdEvictions());

  it('has nothing pending before anything is published', () => {
    expect(consumeHouseholdEviction()).toBeNull();
  });

  it('notifies every live subscriber', () => {
    const a = jest.fn();
    const b = jest.fn();
    subscribeHouseholdEviction(a);
    subscribeHouseholdEviction(b);

    publishHouseholdEviction(EVICTION);

    expect(a).toHaveBeenCalledWith(EVICTION);
    expect(b).toHaveBeenCalledWith(EVICTION);
    // A handled eviction is NOT also latched — a later remount must not
    // replay it.
    expect(consumeHouseholdEviction()).toBeNull();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeHouseholdEviction(listener);
    unsubscribe();

    publishHouseholdEviction(EVICTION);

    expect(listener).not.toHaveBeenCalled();
  });

  it('holds the eviction for a consumer that was not mounted yet, and yields it ONCE', () => {
    // No listener at publish time — the boot-race case the latch exists for.
    publishHouseholdEviction(EVICTION);

    expect(consumeHouseholdEviction()).toEqual(EVICTION);
    // A second read must not re-trigger the switch/toast on the next render.
    expect(consumeHouseholdEviction()).toBeNull();
  });

  it('keeps publishing to the remaining listeners when one throws', () => {
    const throwing = jest.fn(() => {
      throw new Error('render exploded');
    });
    const healthy = jest.fn();
    subscribeHouseholdEviction(throwing);
    subscribeHouseholdEviction(healthy);

    expect(() => publishHouseholdEviction(EVICTION)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(EVICTION);
  });
});

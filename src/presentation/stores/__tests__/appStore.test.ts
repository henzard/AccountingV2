import { useAppStore } from '../appStore';
import type { Session } from '@supabase/supabase-js';
import type { BudgetPeriod } from '../../../domain/shared/types';

const DEFAULT_PAYDAY_DAY = 25;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'token-abc',
    refresh_token: 'refresh-xyz',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
  } as Session;
}

const PERIOD: BudgetPeriod = {
  startDate: new Date('2026-06-01'),
  endDate: new Date('2026-06-30'),
  label: '1 Jun – 30 Jun',
};

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  describe('initial state', () => {
    it('has null session', () => {
      expect(useAppStore.getState().session).toBeNull();
    });

    it('has userLevel 1', () => {
      expect(useAppStore.getState().userLevel).toBe(1);
    });

    it('has null currentPeriod', () => {
      expect(useAppStore.getState().currentPeriod).toBeNull();
    });

    it('has null householdId', () => {
      expect(useAppStore.getState().householdId).toBeNull();
    });

    it('has default paydayDay of 25', () => {
      expect(useAppStore.getState().paydayDay).toBe(DEFAULT_PAYDAY_DAY);
    });

    it('has empty availableHouseholds', () => {
      expect(useAppStore.getState().availableHouseholds).toEqual([]);
    });

    it('has null onboardingCompleted', () => {
      expect(useAppStore.getState().onboardingCompleted).toBeNull();
    });

    it('has null monthlyIncomeCents', () => {
      expect(useAppStore.getState().monthlyIncomeCents).toBeNull();
    });
  });

  describe('setSession', () => {
    it('stores session object', () => {
      const session = makeSession();
      useAppStore.getState().setSession(session);
      expect(useAppStore.getState().session).toBe(session);
    });

    it('accepts null to clear session', () => {
      useAppStore.getState().setSession(makeSession());
      useAppStore.getState().setSession(null);
      expect(useAppStore.getState().session).toBeNull();
    });
  });

  describe('setUserLevel', () => {
    it('sets to level 2', () => {
      useAppStore.getState().setUserLevel(2);
      expect(useAppStore.getState().userLevel).toBe(2);
    });

    it('sets to level 3', () => {
      useAppStore.getState().setUserLevel(3);
      expect(useAppStore.getState().userLevel).toBe(3);
    });
  });

  describe('setCurrentPeriod', () => {
    it('stores budget period', () => {
      useAppStore.getState().setCurrentPeriod(PERIOD);
      expect(useAppStore.getState().currentPeriod).toEqual(PERIOD);
    });
  });

  describe('setHouseholdId', () => {
    it('stores household id', () => {
      useAppStore.getState().setHouseholdId('hh-abc');
      expect(useAppStore.getState().householdId).toBe('hh-abc');
    });
  });

  describe('setPaydayDay', () => {
    it('updates payday day', () => {
      useAppStore.getState().setPaydayDay(1);
      expect(useAppStore.getState().paydayDay).toBe(1);
    });

    it('accepts end of month values', () => {
      useAppStore.getState().setPaydayDay(28);
      expect(useAppStore.getState().paydayDay).toBe(28);
    });
  });

  describe('clearHousehold', () => {
    it('clears householdId to null', () => {
      useAppStore.getState().setHouseholdId('hh-1');
      useAppStore.getState().clearHousehold();
      expect(useAppStore.getState().householdId).toBeNull();
    });

    it('resets paydayDay to default', () => {
      useAppStore.getState().setPaydayDay(15);
      useAppStore.getState().clearHousehold();
      expect(useAppStore.getState().paydayDay).toBe(DEFAULT_PAYDAY_DAY);
    });

    it('does not affect other state', () => {
      useAppStore.getState().setUserLevel(3);
      useAppStore.getState().setHouseholdId('hh-1');
      useAppStore.getState().clearHousehold();
      expect(useAppStore.getState().userLevel).toBe(3);
    });
  });

  describe('setAvailableHouseholds', () => {
    it('stores household summaries', () => {
      const households = [
        { id: 'hh-1', name: 'Home' },
        { id: 'hh-2', name: 'Work' },
      ];
      useAppStore.getState().setAvailableHouseholds(households as never);
      expect(useAppStore.getState().availableHouseholds).toEqual(households);
    });

    it('can be set to empty array', () => {
      useAppStore.getState().setAvailableHouseholds([{ id: 'hh-1', name: 'X' }] as never);
      useAppStore.getState().setAvailableHouseholds([]);
      expect(useAppStore.getState().availableHouseholds).toEqual([]);
    });
  });

  describe('setOnboardingCompleted', () => {
    it('sets to true', () => {
      useAppStore.getState().setOnboardingCompleted(true);
      expect(useAppStore.getState().onboardingCompleted).toBe(true);
    });

    it('sets to false', () => {
      useAppStore.getState().setOnboardingCompleted(false);
      expect(useAppStore.getState().onboardingCompleted).toBe(false);
    });

    it('sets to null', () => {
      useAppStore.getState().setOnboardingCompleted(true);
      useAppStore.getState().setOnboardingCompleted(null);
      expect(useAppStore.getState().onboardingCompleted).toBeNull();
    });
  });

  describe('setMonthlyIncomeCents', () => {
    it('stores income value', () => {
      useAppStore.getState().setMonthlyIncomeCents(5000000);
      expect(useAppStore.getState().monthlyIncomeCents).toBe(5000000);
    });

    it('accepts null', () => {
      useAppStore.getState().setMonthlyIncomeCents(5000000);
      useAppStore.getState().setMonthlyIncomeCents(null);
      expect(useAppStore.getState().monthlyIncomeCents).toBeNull();
    });

    it('accepts zero', () => {
      useAppStore.getState().setMonthlyIncomeCents(0);
      expect(useAppStore.getState().monthlyIncomeCents).toBe(0);
    });
  });

  describe('reset', () => {
    it('restores all state to initial values', () => {
      useAppStore.getState().setSession(makeSession());
      useAppStore.getState().setUserLevel(3);
      useAppStore.getState().setCurrentPeriod(PERIOD);
      useAppStore.getState().setHouseholdId('hh-1');
      useAppStore.getState().setPaydayDay(15);
      useAppStore.getState().setAvailableHouseholds([{ id: 'hh-1', name: 'X' }] as never);
      useAppStore.getState().setOnboardingCompleted(true);
      useAppStore.getState().setMonthlyIncomeCents(5000000);

      useAppStore.getState().reset();

      const s = useAppStore.getState();
      expect(s.session).toBeNull();
      expect(s.userLevel).toBe(1);
      expect(s.currentPeriod).toBeNull();
      expect(s.householdId).toBeNull();
      expect(s.paydayDay).toBe(DEFAULT_PAYDAY_DAY);
      expect(s.availableHouseholds).toEqual([]);
      expect(s.onboardingCompleted).toBeNull();
      expect(s.monthlyIncomeCents).toBeNull();
    });

    it('preserves action functions after reset', () => {
      useAppStore.getState().reset();
      const s = useAppStore.getState();
      expect(typeof s.setSession).toBe('function');
      expect(typeof s.setUserLevel).toBe('function');
      expect(typeof s.setHouseholdId).toBe('function');
      expect(typeof s.reset).toBe('function');
    });
  });
});

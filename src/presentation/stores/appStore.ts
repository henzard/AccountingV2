import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { BudgetPeriod } from '../../domain/shared/types';
import type { HouseholdSummary } from '../../domain/households/EnsureHouseholdUseCase';

const DEFAULT_PAYDAY_DAY = 25;

interface AppState {
  session: Session | null;
  userLevel: 1 | 2 | 3;
  currentPeriod: BudgetPeriod | null;
  householdId: string | null;
  paydayDay: number;
  availableHouseholds: HouseholdSummary[];
  onboardingCompleted: boolean | null;
  monthlyIncomeCents: number | null;
  /**
   * Set when a Supabase password-recovery deep link has been received (see
   * App.tsx's deep-link handler and its `PASSWORD_RECOVERY` auth-listener
   * branch). While true, RootNavigator shows ResetPasswordScreen instead of
   * the normal Auth/Main tree, regardless of session/household state.
   */
  passwordRecoveryPending: boolean;
}

interface AppActions {
  setSession: (session: Session | null) => void;
  setUserLevel: (level: 1 | 2 | 3) => void;
  setCurrentPeriod: (period: BudgetPeriod) => void;
  setHouseholdId: (id: string) => void;
  setPaydayDay: (day: number) => void;
  clearHousehold: () => void;
  setAvailableHouseholds: (households: HouseholdSummary[]) => void;
  setOnboardingCompleted: (done: boolean | null) => void;
  setMonthlyIncomeCents: (cents: number | null) => void;
  setPasswordRecoveryPending: (pending: boolean) => void;
  /** Reset auth-derived state on sign-out. Does NOT call supabase.auth.signOut(). */
  reset: () => void;
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  session: null,
  userLevel: 1,
  currentPeriod: null,
  householdId: null,
  paydayDay: DEFAULT_PAYDAY_DAY,
  availableHouseholds: [],
  onboardingCompleted: null,
  monthlyIncomeCents: null,
  passwordRecoveryPending: false,
  setSession: (session): void => set({ session }),
  setUserLevel: (userLevel): void => set({ userLevel }),
  setCurrentPeriod: (currentPeriod): void => set({ currentPeriod }),
  setHouseholdId: (householdId): void => set({ householdId }),
  setPaydayDay: (paydayDay): void => set({ paydayDay }),
  clearHousehold: (): void => set({ householdId: null, paydayDay: DEFAULT_PAYDAY_DAY }),
  setAvailableHouseholds: (availableHouseholds): void => set({ availableHouseholds }),
  setOnboardingCompleted: (onboardingCompleted): void => set({ onboardingCompleted }),
  setMonthlyIncomeCents: (monthlyIncomeCents): void => set({ monthlyIncomeCents }),
  setPasswordRecoveryPending: (passwordRecoveryPending): void => set({ passwordRecoveryPending }),
  reset: (): void =>
    set({
      session: null,
      userLevel: 1,
      currentPeriod: null,
      householdId: null,
      availableHouseholds: [],
      paydayDay: DEFAULT_PAYDAY_DAY,
      onboardingCompleted: null,
      monthlyIncomeCents: null,
      passwordRecoveryPending: false,
    }),
}));

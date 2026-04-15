import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { BudgetPeriod } from '../../domain/shared/types';
import type { HouseholdSummary } from '../../domain/households/EnsureHouseholdUseCase';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

const DEFAULT_PAYDAY_DAY = 25;

interface AppState {
  session: Session | null;
  userLevel: 1 | 2 | 3;
  currentPeriod: BudgetPeriod | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  pendingSyncCount: number;
  householdId: string | null;
  paydayDay: number;
  availableHouseholds: HouseholdSummary[];
  onboardingCompleted: boolean | null;
}

interface AppActions {
  setSession: (session: Session | null) => void;
  setUserLevel: (level: 1 | 2 | 3) => void;
  setCurrentPeriod: (period: BudgetPeriod) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  setPendingSyncCount: (count: number) => void;
  setHouseholdId: (id: string) => void;
  setPaydayDay: (day: number) => void;
  clearHousehold: () => void;
  setAvailableHouseholds: (households: HouseholdSummary[]) => void;
  setOnboardingCompleted: (done: boolean | null) => void;
  /** Reset auth-derived state on sign-out. Does NOT call supabase.auth.signOut(). */
  reset: () => void;
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  session: null,
  userLevel: 1,
  currentPeriod: null,
  syncStatus: 'idle',
  lastSyncAt: null,
  pendingSyncCount: 0,
  householdId: null,
  paydayDay: DEFAULT_PAYDAY_DAY,
  availableHouseholds: [],
  onboardingCompleted: null,
  setSession: (session): void => set({ session }),
  setUserLevel: (userLevel): void => set({ userLevel }),
  setCurrentPeriod: (currentPeriod): void => set({ currentPeriod }),
  setSyncStatus: (syncStatus): void => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt): void => set({ lastSyncAt }),
  setPendingSyncCount: (pendingSyncCount): void => set({ pendingSyncCount }),
  setHouseholdId: (householdId): void => set({ householdId }),
  setPaydayDay: (paydayDay): void => set({ paydayDay }),
  clearHousehold: (): void => set({ householdId: null, paydayDay: DEFAULT_PAYDAY_DAY }),
  setAvailableHouseholds: (availableHouseholds): void => set({ availableHouseholds }),
  setOnboardingCompleted: (onboardingCompleted): void => set({ onboardingCompleted }),
  reset: (): void =>
    set({
      session: null,
      householdId: null,
      availableHouseholds: [],
      paydayDay: DEFAULT_PAYDAY_DAY,
      syncStatus: 'idle',
      pendingSyncCount: 0,
      onboardingCompleted: null,
    }),
}));

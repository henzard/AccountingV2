import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { BudgetPeriod } from '../../domain/shared/types';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface AppState {
  session: Session | null;
  userLevel: 1 | 2 | 3;
  currentPeriod: BudgetPeriod | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  pendingSyncCount: number;
}

interface AppActions {
  setSession: (session: Session | null) => void;
  setUserLevel: (level: 1 | 2 | 3) => void;
  setCurrentPeriod: (period: BudgetPeriod) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncAt: (isoDate: string) => void;
  setPendingSyncCount: (count: number) => void;
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  session: null,
  userLevel: 1,
  currentPeriod: null,
  syncStatus: 'idle',
  lastSyncAt: null,
  pendingSyncCount: 0,
  setSession: (session) => set({ session }),
  setUserLevel: (userLevel) => set({ userLevel }),
  setCurrentPeriod: (currentPeriod) => set({ currentPeriod }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
}));

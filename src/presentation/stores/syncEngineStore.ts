// src/presentation/stores/syncEngineStore.ts
//
// Holds the app's ONE SyncEngine + SyncScheduler instance (Task 5 boot
// cutover) so any screen -- chiefly the Sync Health / DLQ inbox screen --
// can reach the SAME running engine App.tsx constructed, without a circular
// import of App.tsx itself (App.tsx -> RootNavigator -> ... -> SettingsScreen
// -> SyncHealthScreen -> App.tsx would be circular).
//
// This store holds a stable object reference, not reactive UI state -- the
// engine/scheduler are imperative APIs (methods), not something to re-render
// on. It lives in `presentation/stores` (not `data/sync`) so the data-layer
// files (SyncEngine.ts, SyncScheduler.ts) never import presentation/* --
// dependencies still point inward.

import { create } from 'zustand';
import type { SyncEngine } from '../../data/sync/SyncEngine';
import type { SyncScheduler } from '../../data/sync/SyncScheduler';

interface SyncEngineState {
  engine: SyncEngine | null;
  scheduler: SyncScheduler | null;
}

interface SyncEngineActions {
  /** Called once by App.tsx after the engine+scheduler are constructed
   * (post-mount, see App.tsx's boot rework). */
  setSyncRuntime: (engine: SyncEngine, scheduler: SyncScheduler) => void;
  clearSyncRuntime: () => void;
}

export const useSyncEngineStore = create<SyncEngineState & SyncEngineActions>((set) => ({
  engine: null,
  scheduler: null,
  setSyncRuntime: (engine, scheduler): void => set({ engine, scheduler }),
  clearSyncRuntime: (): void => set({ engine: null, scheduler: null }),
}));

/**
 * emergencyFundReconcileStore — flag set by ReconcileEmergencyFundTypeUseCase
 * when a duplicate emergency fund envelope was found and resolved.
 *
 * The banner on BudgetScreen reads this flag and shows copy verbatim from spec
 * §Duplicate-EMF banner copy.
 *
 * The store is set from `App.tsx`'s `SyncScheduler.onSyncSuccess` hook after
 * a successful sync round if `ReconcileEmergencyFundTypeUseCase` returned
 * `flipped > 0` (previously wired from the OLD `SyncOrchestrator.syncPending`,
 * deleted in slice 5 task 6 — see that use case's own doc comment for the
 * kept-not-deleted rationale).
 *
 * Spec §Duplicate-EMF banner copy.
 */

import { create } from 'zustand';

interface EmfReconcileState {
  /** True when a duplicate EMF was resolved and the banner should show */
  hasReconciledDuplicateEmf: boolean;
}

interface EmfReconcileActions {
  setReconciledDuplicateEmf: (value: boolean) => void;
  dismiss: () => void;
}

export const useEmergencyFundReconcileStore = create<EmfReconcileState & EmfReconcileActions>(
  (set) => ({
    hasReconciledDuplicateEmf: false,

    setReconciledDuplicateEmf: (value: boolean): void => {
      set({ hasReconciledDuplicateEmf: value });
    },

    dismiss: (): void => {
      set({ hasReconciledDuplicateEmf: false });
    },
  }),
);

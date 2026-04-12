/**
 * emergencyFundReconcileStore — flag set by ReconcileEmergencyFundTypeUseCase
 * when a duplicate emergency fund envelope was found and resolved.
 *
 * The banner on BudgetScreen reads this flag and shows copy verbatim from spec
 * §Duplicate-EMF banner copy.
 *
 * The store is set from SyncOrchestrator.syncPending after a clean sync
 * (failed: 0) if ReconcileEmergencyFundTypeUseCase returned flipped > 0.
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

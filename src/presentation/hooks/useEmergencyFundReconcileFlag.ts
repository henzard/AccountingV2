/**
 * useEmergencyFundReconcileFlag — reads the duplicate-EMF resolution flag.
 *
 * Backed by emergencyFundReconcileStore.
 * Returns { hasFlag, dismiss }.
 *
 * Spec §Duplicate-EMF banner copy, task 4.14.
 */

import { useEmergencyFundReconcileStore } from '../stores/emergencyFundReconcileStore';

export interface UseEmergencyFundReconcileFlagResult {
  hasFlag: boolean;
  dismiss: () => void;
}

export function useEmergencyFundReconcileFlag(): UseEmergencyFundReconcileFlagResult {
  const hasFlag = useEmergencyFundReconcileStore((s) => s.hasReconciledDuplicateEmf);
  const dismiss = useEmergencyFundReconcileStore((s) => s.dismiss);
  return { hasFlag, dismiss };
}

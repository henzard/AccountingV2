import { useEmergencyFundReconcileStore } from '../emergencyFundReconcileStore';

describe('emergencyFundReconcileStore', () => {
  beforeEach(() => {
    useEmergencyFundReconcileStore.setState({ hasReconciledDuplicateEmf: false });
  });

  it('defaults hasReconciledDuplicateEmf to false', () => {
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(false);
  });

  it('setReconciledDuplicateEmf sets the flag', () => {
    useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(true);
  });

  it('dismiss resets the flag to false', () => {
    useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
    useEmergencyFundReconcileStore.getState().dismiss();
    expect(useEmergencyFundReconcileStore.getState().hasReconciledDuplicateEmf).toBe(false);
  });
});

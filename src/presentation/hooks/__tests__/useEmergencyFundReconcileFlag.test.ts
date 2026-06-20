import { renderHook, act } from '@testing-library/react-native';

const mockDismiss = jest.fn();
let mockHasFlag = false;

jest.mock('../../stores/emergencyFundReconcileStore', () => ({
  useEmergencyFundReconcileStore: (
    sel: (s: { hasReconciledDuplicateEmf: boolean; dismiss: () => void }) => unknown,
  ) => sel({ hasReconciledDuplicateEmf: mockHasFlag, dismiss: mockDismiss }),
}));

import { useEmergencyFundReconcileFlag } from '../useEmergencyFundReconcileFlag';

describe('useEmergencyFundReconcileFlag', () => {
  beforeEach(() => {
    mockHasFlag = false;
    mockDismiss.mockClear();
  });

  it('returns hasFlag false by default', () => {
    const { result } = renderHook(() => useEmergencyFundReconcileFlag());
    expect(result.current.hasFlag).toBe(false);
  });

  it('returns hasFlag true when store has flag', () => {
    mockHasFlag = true;
    const { result } = renderHook(() => useEmergencyFundReconcileFlag());
    expect(result.current.hasFlag).toBe(true);
  });

  it('dismiss calls store dismiss', () => {
    const { result } = renderHook(() => useEmergencyFundReconcileFlag());
    act(() => {
      result.current.dismiss();
    });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});

import { useSlipScannerStore } from './slipScannerStore';

describe('slipScannerStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useSlipScannerStore.setState({ inFlightSlipId: null });
  });

  it('setInFlight updates inFlightSlipId', () => {
    useSlipScannerStore.getState().setInFlight('slip-123');
    expect(useSlipScannerStore.getState().inFlightSlipId).toBe('slip-123');
  });

  it('setInFlight(null) clears inFlightSlipId', () => {
    useSlipScannerStore.setState({ inFlightSlipId: 'slip-abc' });
    useSlipScannerStore.getState().setInFlight(null);
    expect(useSlipScannerStore.getState().inFlightSlipId).toBeNull();
  });

  it('starts with null inFlightSlipId', () => {
    expect(useSlipScannerStore.getState().inFlightSlipId).toBeNull();
  });
});

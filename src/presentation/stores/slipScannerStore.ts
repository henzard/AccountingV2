import { create } from 'zustand';

interface SlipScannerState {
  inFlightSlipId: string | null;
  setInFlight(id: string | null): void;
}

export const useSlipScannerStore = create<SlipScannerState>((set) => ({
  inFlightSlipId: null,
  setInFlight: (id) => set({ inFlightSlipId: id }),
}));

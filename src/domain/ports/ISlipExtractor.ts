import type { SlipExtraction } from '../slipScanning/types';

export interface ISlipExtractor {
  extract(args: {
    slipId: string;
    householdId: string;
    framesBase64: string[];
  }): Promise<SlipExtraction>;
}

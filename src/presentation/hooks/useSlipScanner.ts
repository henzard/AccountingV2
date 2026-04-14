import { useCallback, useState } from 'react';
import type { SlipScanFlow, ProgressState } from '../../application/SlipScanFlow';
import type { Result } from '../../domain/shared/types';
import type { SlipExtraction } from '../../domain/slipScanning/types';
import type { SlipScanError } from '../../domain/slipScanning/errors';
import { useSlipScannerStore } from '../stores/slipScannerStore';

export function useSlipScanner(flow: SlipScanFlow): {
  start: (input: {
    householdId: string;
    createdBy: string;
    frameLocalUris: string[];
  }) => Promise<Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>>;
  progress: ProgressState;
} {
  const [progress, setProgress] = useState<ProgressState>({ stage: 'capturing' });
  const setInFlight = useSlipScannerStore((s) => s.setInFlight);

  const start = useCallback(
    async (input: {
      householdId: string;
      createdBy: string;
      frameLocalUris: string[];
    }): Promise<Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>> => {
      const result = await flow.start(input, (p) => {
        setProgress(p);
        setInFlight(
          p.stage === 'done' || p.stage === 'failed'
            ? null
            : ((p as { slipId?: string }).slipId ?? null),
        );
      });
      return result;
    },
    [flow, setInFlight],
  );

  return { start, progress };
}

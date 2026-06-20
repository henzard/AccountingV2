import { renderHook, act } from '@testing-library/react-native';
import type { SlipScanFlow, ProgressState } from '../../../application/SlipScanFlow';
import type { Result } from '../../../domain/shared/types';
import type { SlipExtraction } from '../../../domain/slipScanning/types';
import type { SlipScanError } from '../../../domain/slipScanning/errors';

const mockSetInFlight = jest.fn();

jest.mock('../../stores/slipScannerStore', () => ({
  useSlipScannerStore: (sel: (s: { setInFlight: jest.Mock }) => unknown) =>
    sel({ setInFlight: mockSetInFlight }),
}));

import { useSlipScanner } from '../useSlipScanner';

function createMockFlow(
  result: Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>,
  progressSequence: ProgressState[] = [],
): SlipScanFlow {
  return {
    start: jest.fn(async (_input, onProgress) => {
      for (const p of progressSequence) {
        onProgress(p);
      }
      return result;
    }),
  } as unknown as SlipScanFlow;
}

const INPUT = {
  householdId: 'hh-1',
  createdBy: 'user-1',
  frameLocalUris: ['file:///frame1.jpg'],
};

const EXTRACTION: SlipExtraction = {
  merchant: 'Shop',
  slipDate: '2026-06-15',
  totalCents: 15000,
  items: [
    {
      description: 'Milk',
      amountCents: 5000,
      quantity: 1,
      suggestedEnvelopeId: null,
      confidence: 0.95,
    },
  ],
  rawResponseJson: '{}',
  openaiCostCents: 2,
};

describe('useSlipScanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns initial progress as capturing', () => {
    const flow = createMockFlow({
      success: true,
      data: { slipId: 'slip-1', extraction: EXTRACTION },
    });
    const { result } = renderHook(() => useSlipScanner(flow));
    expect(result.current.progress).toEqual({ stage: 'capturing' });
  });

  it('start calls flow.start and returns success result', async () => {
    const successResult: Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError> = {
      success: true,
      data: { slipId: 'slip-1', extraction: EXTRACTION },
    };
    const flow = createMockFlow(successResult, [
      { stage: 'uploading', slipId: 'slip-1' },
      { stage: 'extracting', slipId: 'slip-1' },
      { stage: 'done', slipId: 'slip-1' },
    ]);

    const { result } = renderHook(() => useSlipScanner(flow));

    let scanResult:
      | Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>
      | undefined;
    await act(async () => {
      scanResult = await result.current.start(INPUT);
    });

    expect(scanResult?.success).toBe(true);
    if (scanResult?.success) {
      expect(scanResult.data.slipId).toBe('slip-1');
    }
    expect(flow.start).toHaveBeenCalledWith(INPUT, expect.any(Function));
  });

  it('updates progress through each stage', async () => {
    const stages: ProgressState[] = [
      { stage: 'uploading', slipId: 'slip-1' },
      { stage: 'extracting', slipId: 'slip-1' },
      { stage: 'done', slipId: 'slip-1' },
    ];
    const flow = createMockFlow(
      { success: true, data: { slipId: 'slip-1', extraction: EXTRACTION } },
      stages,
    );

    const { result } = renderHook(() => useSlipScanner(flow));

    await act(async () => {
      await result.current.start(INPUT);
    });

    expect(result.current.progress).toEqual({ stage: 'done', slipId: 'slip-1' });
  });

  it('sets inFlight to slipId during uploading/extracting stages', async () => {
    const stages: ProgressState[] = [
      { stage: 'uploading', slipId: 'slip-1' },
      { stage: 'extracting', slipId: 'slip-1' },
      { stage: 'done', slipId: 'slip-1' },
    ];
    const flow = createMockFlow(
      { success: true, data: { slipId: 'slip-1', extraction: EXTRACTION } },
      stages,
    );

    const { result } = renderHook(() => useSlipScanner(flow));

    await act(async () => {
      await result.current.start(INPUT);
    });

    expect(mockSetInFlight).toHaveBeenCalledWith('slip-1');
    expect(mockSetInFlight).toHaveBeenCalledWith(null);
  });

  it('sets inFlight to null when stage is done', async () => {
    const flow = createMockFlow(
      { success: true, data: { slipId: 'slip-1', extraction: EXTRACTION } },
      [{ stage: 'done', slipId: 'slip-1' }],
    );

    const { result } = renderHook(() => useSlipScanner(flow));

    await act(async () => {
      await result.current.start(INPUT);
    });

    expect(mockSetInFlight).toHaveBeenLastCalledWith(null);
  });

  it('sets inFlight to null when stage is failed', async () => {
    const failResult: Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError> = {
      success: false,
      error: { code: 'SLIP_OFFLINE', message: 'No network' },
    };
    const flow = createMockFlow(failResult, [
      { stage: 'uploading', slipId: 'slip-1' },
      { stage: 'failed', slipId: 'slip-1', error: { code: 'SLIP_OFFLINE', message: 'No network' } },
    ]);

    const { result } = renderHook(() => useSlipScanner(flow));

    await act(async () => {
      await result.current.start(INPUT);
    });

    expect(mockSetInFlight).toHaveBeenLastCalledWith(null);
  });

  it('returns failure result from flow', async () => {
    const failResult: Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError> = {
      success: false,
      error: { code: 'SLIP_UNREADABLE', message: 'Cannot read slip' },
    };
    const flow = createMockFlow(failResult, [
      { stage: 'failed', error: { code: 'SLIP_UNREADABLE', message: 'Cannot read slip' } },
    ]);

    const { result } = renderHook(() => useSlipScanner(flow));

    let scanResult:
      | Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>
      | undefined;
    await act(async () => {
      scanResult = await result.current.start(INPUT);
    });

    expect(scanResult?.success).toBe(false);
    if (!scanResult?.success) {
      expect(scanResult?.error.code).toBe('SLIP_UNREADABLE');
    }
  });

  it('sets inFlight to null for capturing stage (no slipId)', async () => {
    const flow = createMockFlow(
      { success: true, data: { slipId: 'slip-1', extraction: EXTRACTION } },
      [{ stage: 'capturing' }],
    );

    const { result } = renderHook(() => useSlipScanner(flow));

    await act(async () => {
      await result.current.start(INPUT);
    });

    expect(mockSetInFlight).toHaveBeenCalledWith(null);
  });
});

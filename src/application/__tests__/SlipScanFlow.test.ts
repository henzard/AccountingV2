import { SlipScanFlow } from '../SlipScanFlow';

describe('SlipScanFlow', () => {
  it('runs capture → upload → extract on happy path', async () => {
    const capture = {
      execute: jest.fn().mockResolvedValue({ success: true, data: { slipId: 's1' } }),
    };
    const upload = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: true, data: { remotePaths: ['p'], framesBase64: ['b'] } }),
    };
    const extract = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          merchant: 'PnP',
          items: [],
          rawResponseJson: '{}',
          slipDate: 'd',
          totalCents: 0,
          openaiCostCents: 0,
        },
      }),
    };

    const flow = new SlipScanFlow({
      captureSlip: capture as any,
      uploadSlipImages: upload as any,
      extractSlip: extract as any,
    });
    const progress = jest.fn();
    const result = await flow.start(
      { householdId: 'h1', createdBy: 'u1', frameLocalUris: ['x'] },
      progress,
    );

    expect(result.success).toBe(true);
    expect(progress).toHaveBeenCalledWith({ stage: 'uploading', slipId: 's1' });
    expect(progress).toHaveBeenCalledWith({ stage: 'extracting', slipId: 's1' });
    expect(progress).toHaveBeenCalledWith({ stage: 'done', slipId: 's1' });
  });

  it('concurrent start calls each produce a distinct slipId (no singleton enforcement at flow level)', async () => {
    // NOTE: SlipScanFlow does not enforce a singleton-per-device invariant at the
    // flow class level — callers (e.g. useSlipScanner hook) are responsible for
    // blocking a second scan while one is in flight. This test documents the
    // per-call behaviour: each start() independently goes through capture → upload → extract.
    let callCount = 0;
    const makeCapture = () => ({
      execute: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ success: true, data: { slipId: `slip-${++callCount}` } }),
        ),
    });

    const upload = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: true, data: { remotePaths: ['p'], framesBase64: ['b'] } }),
    };
    const extract = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          merchant: null,
          items: [],
          rawResponseJson: '{}',
          slipDate: null,
          totalCents: null,
          openaiCostCents: 0,
        },
      }),
    };

    const capture1 = makeCapture();
    const capture2 = makeCapture();

    const flow1 = new SlipScanFlow({
      captureSlip: capture1 as any,
      uploadSlipImages: upload as any,
      extractSlip: extract as any,
    });
    const flow2 = new SlipScanFlow({
      captureSlip: capture2 as any,
      uploadSlipImages: upload as any,
      extractSlip: extract as any,
    });

    const [r1, r2] = await Promise.all([
      flow1.start({ householdId: 'h1', createdBy: 'u1', frameLocalUris: ['a'] }, jest.fn()),
      flow2.start({ householdId: 'h1', createdBy: 'u1', frameLocalUris: ['b'] }, jest.fn()),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // Each flow produced its own slipId
    if (r1.success && r2.success) {
      expect(r1.data.slipId).not.toBe(r2.data.slipId);
    }
  });

  it('returns failure when extract fails', async () => {
    const capture = {
      execute: jest.fn().mockResolvedValue({ success: true, data: { slipId: 's1' } }),
    };
    const upload = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: true, data: { remotePaths: ['p'], framesBase64: ['b'] } }),
    };
    const extract = {
      execute: jest.fn().mockResolvedValue({
        success: false,
        error: { code: 'SLIP_OPENAI_UNREACHABLE', message: 'down' },
      }),
    };

    const flow = new SlipScanFlow({
      captureSlip: capture as any,
      uploadSlipImages: upload as any,
      extractSlip: extract as any,
    });
    const result = await flow.start(
      { householdId: 'h1', createdBy: 'u1', frameLocalUris: ['x'] },
      jest.fn(),
    );
    expect(result.success).toBe(false);
  });
});

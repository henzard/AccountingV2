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

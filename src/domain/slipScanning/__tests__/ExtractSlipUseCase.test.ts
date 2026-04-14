import { ExtractSlipUseCase } from '../ExtractSlipUseCase';

describe('ExtractSlipUseCase', () => {
  it('returns extraction on success and updates slip_queue', async () => {
    const extraction = {
      merchant: 'Pick n Pay',
      slipDate: '2026-04-13',
      totalCents: 1000,
      items: [],
      rawResponseJson: '{}',
      openaiCostCents: 5,
    };
    const extractor = { extract: jest.fn().mockResolvedValue(extraction) };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };

    const useCase = new ExtractSlipUseCase(extractor as any, repo as any);
    const result = await useCase.execute({
      slipId: 's1',
      householdId: 'h1',
      framesBase64: ['b1'],
    });

    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'completed',
        merchant: 'Pick n Pay',
        totalCents: 1000,
        openaiCostCents: 5,
      }),
    );
  });

  it('marks slip failed and returns SLIP_OPENAI_UNREACHABLE', async () => {
    const extractor = {
      extract: jest.fn().mockRejectedValue({ code: 'SLIP_OPENAI_UNREACHABLE', message: 'down' }),
    };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };
    const useCase = new ExtractSlipUseCase(extractor as any, repo as any);
    const result = await useCase.execute({ slipId: 's1', householdId: 'h1', framesBase64: ['b1'] });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('SLIP_OPENAI_UNREACHABLE');
    expect(repo.update).toHaveBeenCalledWith('s1', { status: 'failed', errorMessage: 'down' });
  });
});

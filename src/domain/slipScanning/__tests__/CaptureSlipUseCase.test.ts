import { CaptureSlipUseCase } from '../CaptureSlipUseCase';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'slip-uuid-1' }));

describe('CaptureSlipUseCase', () => {
  it('creates slip_queue row with status processing', async () => {
    const repo = { create: jest.fn().mockResolvedValue(undefined) };
    const useCase = new CaptureSlipUseCase(repo as any);
    const result = await useCase.execute({
      householdId: 'h1',
      createdBy: 'u1',
      frameLocalUris: ['file:///a.jpg', 'file:///b.jpg'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(typeof result.data.slipId).toBe('string');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        createdBy: 'u1',
        status: 'processing',
        imageUris: ['file:///a.jpg', 'file:///b.jpg'],
      }),
    );
  });

  it('returns failure for empty frames', async () => {
    const repo = { create: jest.fn() };
    const useCase = new CaptureSlipUseCase(repo as any);
    const result = await useCase.execute({
      householdId: 'h1',
      createdBy: 'u1',
      frameLocalUris: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_FRAME_COUNT');
  });
});

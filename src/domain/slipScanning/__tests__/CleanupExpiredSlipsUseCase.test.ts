import { CleanupExpiredSlipsUseCase } from '../CleanupExpiredSlipsUseCase';

describe('CleanupExpiredSlipsUseCase', () => {
  it('deletes local images and nulls rawResponseJson for expired slips', async () => {
    const expiredSlip = {
      id: 's1',
      householdId: 'h1',
      createdBy: 'u',
      imageUris: ['p1', 'p2'],
      status: 'completed' as const,
      errorMessage: null,
      merchant: 'm',
      slipDate: 'd',
      totalCents: 100,
      rawResponseJson: 'json',
      imagesDeletedAt: null,
      openaiCostCents: 1,
      createdAt: 'old',
      updatedAt: 'old',
    };
    const repo = {
      listExpired: jest.fn().mockResolvedValue([expiredSlip]),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const localStore = { delete: jest.fn().mockResolvedValue(undefined) };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();

    expect(result.success).toBe(true);
    expect(localStore.delete).toHaveBeenCalledWith('s1');
    expect(repo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        imagesDeletedAt: expect.any(String),
        rawResponseJson: null,
      }),
    );
  });

  it('is idempotent when no expired slips', async () => {
    const repo = {
      listExpired: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    };
    const localStore = { delete: jest.fn() };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cleanedCount).toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

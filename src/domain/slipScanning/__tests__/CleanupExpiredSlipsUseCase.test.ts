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
    expect(localStore.delete).not.toHaveBeenCalled();
  });

  it('returns failure when localStore.delete throws', async () => {
    const repo = {
      listExpired: jest.fn().mockResolvedValue([{ id: 's1' }]),
      update: jest.fn(),
    };
    const localStore = {
      delete: jest.fn().mockRejectedValue(new Error('filesystem error')),
    };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLEANUP_FAILED');
      expect(result.error.message).toBe('filesystem error');
    }
  });

  it('returns failure when repo.listExpired throws', async () => {
    const repo = {
      listExpired: jest.fn().mockRejectedValue(new Error('DB read error')),
      update: jest.fn(),
    };
    const localStore = { delete: jest.fn() };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLEANUP_FAILED');
      expect(result.error.message).toBe('DB read error');
    }
  });

  it('returns failure with stringified message for non-Error thrown values', async () => {
    const repo = {
      listExpired: jest.fn().mockRejectedValue(42),
      update: jest.fn(),
    };
    const localStore = { delete: jest.fn() };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLEANUP_FAILED');
      expect(result.error.message).toBe('42');
    }
  });

  it('handles multiple expired slips and returns correct cleanedCount', async () => {
    const slips = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
    const repo = {
      listExpired: jest.fn().mockResolvedValue(slips),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const localStore = { delete: jest.fn().mockResolvedValue(undefined) };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cleanedCount).toBe(3);
    expect(localStore.delete).toHaveBeenCalledTimes(3);
    expect(repo.update).toHaveBeenCalledTimes(3);
  });

  it('returns failure when repo.update throws mid-loop', async () => {
    const repo = {
      listExpired: jest.fn().mockResolvedValue([{ id: 's1' }]),
      update: jest.fn().mockRejectedValue(new Error('write failed')),
    };
    const localStore = { delete: jest.fn().mockResolvedValue(undefined) };

    const useCase = new CleanupExpiredSlipsUseCase(repo as any, localStore as any);
    const result = await useCase.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLEANUP_FAILED');
      expect(result.error.message).toBe('write failed');
    }
  });
});

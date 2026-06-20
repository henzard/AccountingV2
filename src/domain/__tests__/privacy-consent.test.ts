import { RecordSlipConsentUseCase } from '../slipScanning/RecordSlipConsentUseCase';
import { CleanupExpiredSlipsUseCase } from '../slipScanning/CleanupExpiredSlipsUseCase';
import type { ISlipImageLocalStore } from '../slipScanning/CleanupExpiredSlipsUseCase';

describe('Privacy & Consent — RecordSlipConsentUseCase', () => {
  it('records consent with a timestamp', async () => {
    const mockRepo = {
      get: jest.fn(),
      setSlipScanConsent: jest.fn().mockResolvedValue(undefined),
    };

    const uc = new RecordSlipConsentUseCase(mockRepo);
    const before = new Date().toISOString();
    const result = await uc.execute({ userId: 'user-1' });
    const after = new Date().toISOString();

    expect(result.success).toBe(true);
    expect(mockRepo.setSlipScanConsent).toHaveBeenCalledWith('user-1', expect.any(String));

    const timestamp = mockRepo.setSlipScanConsent.mock.calls[0][1];
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });

  it('persists consent to the repository', async () => {
    const mockRepo = {
      get: jest.fn(),
      setSlipScanConsent: jest.fn().mockResolvedValue(undefined),
    };

    const uc = new RecordSlipConsentUseCase(mockRepo);
    await uc.execute({ userId: 'user-42' });

    expect(mockRepo.setSlipScanConsent).toHaveBeenCalledTimes(1);
    expect(mockRepo.setSlipScanConsent).toHaveBeenCalledWith('user-42', expect.any(String));
  });

  it('returns failure if DB write fails', async () => {
    const mockRepo = {
      get: jest.fn(),
      setSlipScanConsent: jest.fn().mockRejectedValue(new Error('DB connection lost')),
    };

    const uc = new RecordSlipConsentUseCase(mockRepo);
    const result = await uc.execute({ userId: 'user-1' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DB_ERROR');
      expect(result.error.message).toContain('DB connection lost');
    }
  });
});

describe('Privacy & Consent — CleanupExpiredSlipsUseCase', () => {
  const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

  function makeSlip(id: string, createdAt: string) {
    return {
      id,
      householdId: 'hh-1',
      createdBy: 'user-1',
      imageUris: ['file:///slip.jpg'],
      status: 'completed' as const,
      errorMessage: null,
      merchant: 'Shop',
      slipDate: '2026-05-01',
      totalCents: 150_00,
      rawResponseJson: '{}',
      imagesDeletedAt: null,
      openaiCostCents: 5,
      createdAt,
      updatedAt: createdAt,
    };
  }

  it('cleans up expired slips (>30 days old)', async () => {
    const expiredSlip = makeSlip(
      'slip-old',
      new Date(Date.now() - THIRTY_ONE_DAYS_MS).toISOString(),
    );

    const mockRepo = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      listByHousehold: jest.fn(),
      listExpired: jest.fn().mockResolvedValue([expiredSlip]),
      listProcessingOlderThan: jest.fn(),
    };

    const mockLocalStore: ISlipImageLocalStore = {
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const uc = new CleanupExpiredSlipsUseCase(mockRepo, mockLocalStore);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cleanedCount).toBe(1);
    }
    expect(mockLocalStore.delete).toHaveBeenCalledWith('slip-old');
    expect(mockRepo.update).toHaveBeenCalledWith(
      'slip-old',
      expect.objectContaining({
        imagesDeletedAt: expect.any(String),
        rawResponseJson: null,
      }),
    );
  });

  it('does not touch non-expired slips', async () => {
    const mockRepo = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      listByHousehold: jest.fn(),
      listExpired: jest.fn().mockResolvedValue([]),
      listProcessingOlderThan: jest.fn(),
    };

    const mockLocalStore: ISlipImageLocalStore = {
      delete: jest.fn(),
    };

    const uc = new CleanupExpiredSlipsUseCase(mockRepo, mockLocalStore);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cleanedCount).toBe(0);
    }
    expect(mockLocalStore.delete).not.toHaveBeenCalled();
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it('deletes local image files for expired slips', async () => {
    const slips = [
      makeSlip('slip-1', new Date(Date.now() - THIRTY_ONE_DAYS_MS).toISOString()),
      makeSlip('slip-2', new Date(Date.now() - THIRTY_ONE_DAYS_MS).toISOString()),
    ];

    const mockRepo = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      listByHousehold: jest.fn(),
      listExpired: jest.fn().mockResolvedValue(slips),
      listProcessingOlderThan: jest.fn(),
    };

    const mockLocalStore: ISlipImageLocalStore = {
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const uc = new CleanupExpiredSlipsUseCase(mockRepo, mockLocalStore);
    const result = await uc.execute();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cleanedCount).toBe(2);
    }
    expect(mockLocalStore.delete).toHaveBeenCalledWith('slip-1');
    expect(mockLocalStore.delete).toHaveBeenCalledWith('slip-2');
  });

  it('nullifies rawResponseJson for privacy (POPIA compliance)', async () => {
    const expiredSlip = makeSlip(
      'slip-popia',
      new Date(Date.now() - THIRTY_ONE_DAYS_MS).toISOString(),
    );

    const mockRepo = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      listByHousehold: jest.fn(),
      listExpired: jest.fn().mockResolvedValue([expiredSlip]),
      listProcessingOlderThan: jest.fn(),
    };

    const mockLocalStore: ISlipImageLocalStore = {
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const uc = new CleanupExpiredSlipsUseCase(mockRepo, mockLocalStore);
    await uc.execute();

    expect(mockRepo.update).toHaveBeenCalledWith(
      'slip-popia',
      expect.objectContaining({
        rawResponseJson: null,
      }),
    );
  });

  it('returns failure if cleanup encounters an error', async () => {
    const mockRepo = {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      listByHousehold: jest.fn(),
      listExpired: jest.fn().mockRejectedValue(new Error('disk full')),
      listProcessingOlderThan: jest.fn(),
    };

    const mockLocalStore: ISlipImageLocalStore = {
      delete: jest.fn(),
    };

    const uc = new CleanupExpiredSlipsUseCase(mockRepo, mockLocalStore);
    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CLEANUP_FAILED');
    }
  });
});

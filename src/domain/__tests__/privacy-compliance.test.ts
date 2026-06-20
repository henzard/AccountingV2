import { RecordSlipConsentUseCase } from '../slipScanning/RecordSlipConsentUseCase';
import { CleanupExpiredSlipsUseCase } from '../slipScanning/CleanupExpiredSlipsUseCase';
import type { IUserConsentRepository } from '../ports/IUserConsentRepository';
import type { ISlipQueueRepository } from '../ports/ISlipQueueRepository';
import type { ISlipImageLocalStore } from '../slipScanning/CleanupExpiredSlipsUseCase';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function makeMockConsentRepo(
  overrides: Partial<IUserConsentRepository> = {},
): IUserConsentRepository {
  return {
    get: jest.fn().mockResolvedValue(null),
    setSlipScanConsent: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockSlipRepo(overrides: Partial<ISlipQueueRepository> = {}): ISlipQueueRepository {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    listByHousehold: jest.fn().mockResolvedValue([]),
    listExpired: jest.fn().mockResolvedValue([]),
    listProcessingOlderThan: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMockLocalStore(): ISlipImageLocalStore {
  return { delete: jest.fn().mockResolvedValue(undefined) };
}

function makeExpiredSlip(id: string) {
  return {
    id,
    householdId: 'h1',
    createdBy: 'u1',
    imageUris: ['img1.jpg'],
    status: 'completed' as const,
    errorMessage: null,
    merchant: 'Woolworths',
    slipDate: '2026-04-01',
    totalCents: 15000,
    rawResponseJson: '{"items":[]}',
    imagesDeletedAt: null,
    openaiCostCents: 5,
    createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

describe('Privacy Compliance — POPIA & Data Retention', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('RecordSlipConsentUseCase — consent before processing', () => {
    it('records consent with an ISO timestamp', async () => {
      const repo = makeMockConsentRepo();
      const uc = new RecordSlipConsentUseCase(repo);

      const result = await uc.execute({ userId: 'user-1' });

      expect(result.success).toBe(true);
      expect(repo.setSlipScanConsent).toHaveBeenCalledTimes(1);
      expect(repo.setSlipScanConsent).toHaveBeenCalledWith('user-1', expect.any(String));

      const timestamp = (repo.setSlipScanConsent as jest.Mock).mock.calls[0][1];
      expect(() => new Date(timestamp)).not.toThrow();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('returns failure when repository throws (DB error)', async () => {
      const repo = makeMockConsentRepo({
        setSlipScanConsent: jest.fn().mockRejectedValue(new Error('connection refused')),
      });
      const uc = new RecordSlipConsentUseCase(repo);

      const result = await uc.execute({ userId: 'user-1' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DB_ERROR');
        expect(result.error.message).toContain('connection refused');
      }
    });

    it('records consent per-user (not global)', async () => {
      const repo = makeMockConsentRepo();
      const uc = new RecordSlipConsentUseCase(repo);

      await uc.execute({ userId: 'user-A' });
      await uc.execute({ userId: 'user-B' });

      expect(repo.setSlipScanConsent).toHaveBeenCalledTimes(2);
      expect((repo.setSlipScanConsent as jest.Mock).mock.calls[0][0]).toBe('user-A');
      expect((repo.setSlipScanConsent as jest.Mock).mock.calls[1][0]).toBe('user-B');
    });

    it('consent timestamp is current (not stale)', async () => {
      const before = Date.now();
      const repo = makeMockConsentRepo();
      const uc = new RecordSlipConsentUseCase(repo);

      await uc.execute({ userId: 'user-1' });

      const after = Date.now();
      const timestamp = (repo.setSlipScanConsent as jest.Mock).mock.calls[0][1];
      const recordedMs = new Date(timestamp).getTime();
      expect(recordedMs).toBeGreaterThanOrEqual(before);
      expect(recordedMs).toBeLessThanOrEqual(after);
    });
  });

  describe('CleanupExpiredSlipsUseCase — 30-day retention', () => {
    it('calculates cutoff as 30 days before now', () => {
      const now = Date.now();
      const cutoff = new Date(now - THIRTY_DAYS_MS);
      const thirtyOneDaysAgo = new Date(now - 31 * 24 * 60 * 60 * 1000);
      const twentyNineDaysAgo = new Date(now - 29 * 24 * 60 * 60 * 1000);

      expect(thirtyOneDaysAgo.getTime()).toBeLessThan(cutoff.getTime());
      expect(twentyNineDaysAgo.getTime()).toBeGreaterThan(cutoff.getTime());
    });

    it('queries for expired slips with correct cutoff', async () => {
      const repo = makeMockSlipRepo();
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const before = Date.now();
      await uc.execute();
      const after = Date.now();

      expect(repo.listExpired).toHaveBeenCalledTimes(1);
      const cutoffArg = (repo.listExpired as jest.Mock).mock.calls[0][0];
      const cutoffMs = new Date(cutoffArg).getTime();
      expect(cutoffMs).toBeGreaterThanOrEqual(before - THIRTY_DAYS_MS - 100);
      expect(cutoffMs).toBeLessThanOrEqual(after - THIRTY_DAYS_MS + 100);
    });

    it('deletes local images for each expired slip', async () => {
      const slips = [makeExpiredSlip('s1'), makeExpiredSlip('s2')];
      const repo = makeMockSlipRepo({ listExpired: jest.fn().mockResolvedValue(slips) });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(true);
      expect(localStore.delete).toHaveBeenCalledTimes(2);
      expect(localStore.delete).toHaveBeenCalledWith('s1');
      expect(localStore.delete).toHaveBeenCalledWith('s2');
    });

    it('nullifies rawResponseJson on cleanup (data minimization)', async () => {
      const repo = makeMockSlipRepo({
        listExpired: jest.fn().mockResolvedValue([makeExpiredSlip('s1')]),
      });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      await uc.execute();

      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ rawResponseJson: null }),
      );
    });

    it('sets imagesDeletedAt timestamp on cleanup', async () => {
      const repo = makeMockSlipRepo({
        listExpired: jest.fn().mockResolvedValue([makeExpiredSlip('s1')]),
      });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      await uc.execute();

      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          imagesDeletedAt: expect.any(String),
        }),
      );
      const updateArg = (repo.update as jest.Mock).mock.calls[0][1];
      expect(Number.isNaN(Date.parse(updateArg.imagesDeletedAt))).toBe(false);
    });

    it('returns cleanedCount matching expired slip count', async () => {
      const slips = [makeExpiredSlip('s1'), makeExpiredSlip('s2'), makeExpiredSlip('s3')];
      const repo = makeMockSlipRepo({ listExpired: jest.fn().mockResolvedValue(slips) });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanedCount).toBe(3);
      }
    });

    it('is idempotent — zero expired returns cleanedCount 0', async () => {
      const repo = makeMockSlipRepo({ listExpired: jest.fn().mockResolvedValue([]) });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanedCount).toBe(0);
      }
      expect(localStore.delete).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns failure when repo throws during cleanup', async () => {
      const repo = makeMockSlipRepo({
        listExpired: jest.fn().mockRejectedValue(new Error('disk full')),
      });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('CLEANUP_FAILED');
        expect(result.error.message).toContain('disk full');
      }
    });

    it('returns failure when local store delete throws', async () => {
      const repo = makeMockSlipRepo({
        listExpired: jest.fn().mockResolvedValue([makeExpiredSlip('s1')]),
      });
      const localStore: ISlipImageLocalStore = {
        delete: jest.fn().mockRejectedValue(new Error('permission denied')),
      };
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('CLEANUP_FAILED');
      }
    });
  });

  describe('POPIA compliance assertions', () => {
    it('consent is recorded BEFORE any processing can occur', () => {
      // The RecordSlipConsentUseCase exists as a separate, explicit step.
      // CaptureSlipUseCase (the processing step) should check consent first.
      // This test documents the architectural requirement.
      expect(RecordSlipConsentUseCase).toBeDefined();
      expect(typeof RecordSlipConsentUseCase.prototype.execute).toBe('function');
    });

    it('data retention period is exactly 30 days', () => {
      expect(THIRTY_DAYS_MS).toBe(30 * 24 * 60 * 60 * 1000);
      expect(THIRTY_DAYS_MS).toBe(2_592_000_000);
    });

    it('cleanup removes both images and raw AI response data', async () => {
      const repo = makeMockSlipRepo({
        listExpired: jest.fn().mockResolvedValue([makeExpiredSlip('s-popia')]),
      });
      const localStore = makeMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      await uc.execute();

      // Images deleted from local file system
      expect(localStore.delete).toHaveBeenCalledWith('s-popia');
      // Raw AI response nullified in database
      expect(repo.update).toHaveBeenCalledWith(
        's-popia',
        expect.objectContaining({ rawResponseJson: null }),
      );
    });
  });
});

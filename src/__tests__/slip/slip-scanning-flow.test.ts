/**
 * Slip scanning lifecycle tests: capture -> extract -> confirm -> cleanup.
 * Verifies transactional integrity and error handling.
 */
import { ConfirmSlipUseCase } from '../../domain/slipScanning/ConfirmSlipUseCase';
import { CaptureSlipUseCase } from '../../domain/slipScanning/CaptureSlipUseCase';
import { ExtractSlipUseCase } from '../../domain/slipScanning/ExtractSlipUseCase';
import { CleanupExpiredSlipsUseCase } from '../../domain/slipScanning/CleanupExpiredSlipsUseCase';
import type { ISlipQueueRepository, SlipQueueRow } from '../../domain/ports/ISlipQueueRepository';
import type { ISlipExtractor } from '../../domain/ports/ISlipExtractor';
import type { SlipExtraction } from '../../domain/slipScanning/types';
import { resetFactoryCounter } from '../../__test-utils__/factories';
import { HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-slip-' + Math.random().toString(36).slice(2, 10),
}));

// ─── Mock Helpers ────────────────────────────────────────────────────────────

const KRUGER_ID = HOUSEHOLDS.kruger.id;

function createMockSlipRepo(options?: {
  slips?: SlipQueueRow[];
  expiredSlips?: SlipQueueRow[];
}): ISlipQueueRepository & { updates: any[]; creates: any[] } {
  const updates: any[] = [];
  const creates: any[] = [];
  const slips = options?.slips ?? [];

  return {
    updates,
    creates,
    create: jest.fn(async (row) => {
      creates.push(row);
    }),
    get: jest.fn(async (id) => slips.find((s) => s.id === id) ?? null),
    update: jest.fn(async (id, patch) => {
      updates.push({ id, patch });
    }),
    listByHousehold: jest.fn(async () => slips),
    listExpired: jest.fn(async () => options?.expiredSlips ?? []),
    listProcessingOlderThan: jest.fn(async () => []),
  };
}

function createMockExtractor(result?: SlipExtraction): ISlipExtractor {
  return {
    extract: jest.fn().mockResolvedValue(
      result ?? {
        merchant: 'Checkers',
        slipDate: '2026-01-15',
        totalCents: 185000,
        items: [
          {
            description: 'Groceries',
            amountCents: 185000,
            quantity: 1,
            suggestedEnvelopeId: null,
            confidence: 0.95,
          },
        ],
        rawResponseJson: '{}',
        openaiCostCents: 5,
      },
    ),
  };
}

function createMockLocalStore() {
  const deleted: string[] = [];
  return {
    deleted,
    delete: jest.fn(async (slipId: string) => {
      deleted.push(slipId);
    }),
  };
}

function createMockTransactionDb(shouldFail = false) {
  return {
    transaction: jest.fn().mockImplementation(async (fn: any) => {
      if (shouldFail) {
        throw new Error('SLIP_PARTIAL_SAVE_FAILED: Transaction creation failed');
      }
      return fn({});
    }),
  } as any;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => resetFactoryCounter());

describe('Slip Scanning Flow', () => {
  describe('CaptureSlipUseCase', () => {
    it('creates a slip_queue row with status "processing"', async () => {
      const repo = createMockSlipRepo();
      const uc = new CaptureSlipUseCase(repo);

      const result = await uc.execute({
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        frameLocalUris: ['file:///photo1.jpg'],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slipId).toBeDefined();
      }
      expect(repo.creates).toHaveLength(1);
      expect(repo.creates[0].status).toBe('processing');
      expect(repo.creates[0].householdId).toBe(KRUGER_ID);
    });

    it('rejects 0 frames', async () => {
      const repo = createMockSlipRepo();
      const uc = new CaptureSlipUseCase(repo);

      const result = await uc.execute({
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        frameLocalUris: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SLIP_INVALID_FRAME_COUNT');
      }
    });

    it('rejects > 5 frames', async () => {
      const repo = createMockSlipRepo();
      const uc = new CaptureSlipUseCase(repo);

      const result = await uc.execute({
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        frameLocalUris: ['a', 'b', 'c', 'd', 'e', 'f'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SLIP_INVALID_FRAME_COUNT');
      }
    });

    it('accepts exactly 5 frames', async () => {
      const repo = createMockSlipRepo();
      const uc = new CaptureSlipUseCase(repo);

      const result = await uc.execute({
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        frameLocalUris: ['a', 'b', 'c', 'd', 'e'],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('ExtractSlipUseCase', () => {
    it('updates slip with extracted data on success', async () => {
      const repo = createMockSlipRepo();
      const extractor = createMockExtractor();
      const uc = new ExtractSlipUseCase(extractor, repo);

      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        framesBase64: ['base64data'],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.merchant).toBe('Checkers');
        expect(result.data.totalCents).toBe(185000);
      }
      expect(repo.updates).toHaveLength(1);
      expect(repo.updates[0].patch.status).toBe('completed');
      expect(repo.updates[0].patch.merchant).toBe('Checkers');
    });

    it('marks slip as failed on extractor error', async () => {
      const repo = createMockSlipRepo();
      const extractor: ISlipExtractor = {
        extract: jest.fn().mockRejectedValue({ code: 'SLIP_UNREADABLE', message: 'Cannot read' }),
      };
      const uc = new ExtractSlipUseCase(extractor, repo);

      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        framesBase64: ['base64data'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SLIP_UNREADABLE');
      }
      expect(repo.updates[0].patch.status).toBe('failed');
    });
  });

  describe('ConfirmSlipUseCase (transactional)', () => {
    it('uses db.transaction for all-or-nothing commit', async () => {
      const db = createMockTransactionDb(false);
      const repo = createMockSlipRepo();
      const factory = jest.fn().mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { id: 'tx-1' },
        }),
      });

      const uc = new ConfirmSlipUseCase(db, factory, repo);
      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Milk', amountCents: 3500, envelopeId: 'env-1' }],
      });

      expect(result.success).toBe(true);
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('on failure: rolls back and marks slip as "failed"', async () => {
      const db = createMockTransactionDb(true);
      const repo = createMockSlipRepo();
      const factory = jest.fn();

      const uc = new ConfirmSlipUseCase(db, factory, repo);
      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Bread', amountCents: 2500, envelopeId: 'env-1' }],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SLIP_PARTIAL_SAVE_FAILED');
      }
      expect(repo.updates).toHaveLength(1);
      expect(repo.updates[0].patch.status).toBe('failed');
    });

    it('on failure: neither transaction nor spentCents changes persist', async () => {
      const db = createMockTransactionDb(true);
      const repo = createMockSlipRepo();
      const factory = jest.fn();

      const uc = new ConfirmSlipUseCase(db, factory, repo);
      await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Eggs', amountCents: 4000, envelopeId: 'env-1' }],
      });

      // Factory was never called because db.transaction threw before it ran
      expect(factory).not.toHaveBeenCalled();
    });
  });

  describe('CleanupExpiredSlipsUseCase', () => {
    it('removes expired slips and deletes local images', async () => {
      const expiredSlip: SlipQueueRow = {
        id: 'old-slip-1',
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        imageUris: ['file:///old.jpg'],
        status: 'completed',
        errorMessage: null,
        merchant: 'Old Shop',
        slipDate: '2025-11-01',
        totalCents: 10000,
        rawResponseJson: '{}',
        imagesDeletedAt: null,
        openaiCostCents: 3,
        createdAt: '2025-11-01T00:00:00.000Z',
        updatedAt: '2025-11-01T00:00:00.000Z',
      };

      const repo = createMockSlipRepo({ expiredSlips: [expiredSlip] });
      const localStore = createMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanedCount).toBe(1);
      }
      expect(localStore.deleted).toContain('old-slip-1');
      expect(repo.updates).toHaveLength(1);
      expect(repo.updates[0].patch.rawResponseJson).toBeNull();
    });

    it('returns cleanedCount: 0 when no expired slips exist', async () => {
      const repo = createMockSlipRepo({ expiredSlips: [] });
      const localStore = createMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cleanedCount).toBe(0);
      }
      expect(localStore.deleted).toHaveLength(0);
    });

    it('handles cleanup failure gracefully', async () => {
      const repo = createMockSlipRepo();
      (repo.listExpired as jest.Mock).mockRejectedValue(new Error('DB error'));
      const localStore = createMockLocalStore();
      const uc = new CleanupExpiredSlipsUseCase(repo, localStore);

      const result = await uc.execute();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('CLEANUP_FAILED');
      }
    });
  });
});

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

// ConfirmSlipUseCase now writes every item + the slip completion through ONE
// synchronous `runInUnitOfWork` call using the low-level within-uow write
// primitives (spec §4.5 fix — see ConfirmSlipUseCase.ts's header comment).
// Mocked here so the ConfirmSlipUseCase describe block below can assert on
// ordering/atomicity-of-call-shape without a real SQLite driver; the actual
// real-driver rollback proof lives in tests/realsql/confirmSlipAtomicity.test.ts.
const mockRunInUnitOfWork = jest.fn((_db: unknown, fn: (uow: unknown) => void) =>
  fn({ db: {}, appendOp: jest.fn() }),
);
jest.mock('../../data/uow/UnitOfWork', () => ({
  runInUnitOfWork: (...args: [unknown, (uow: unknown) => void]) => mockRunInUnitOfWork(...args),
}));

const mockInsertRowWithinUow = jest.fn();
const mockUpdateRowWithinUow = jest.fn();
jest.mock('../../data/uow/createSyncedRepo', () => ({
  insertRowWithinUow: (...args: unknown[]) => mockInsertRowWithinUow(...args),
  updateRowWithinUow: (...args: unknown[]) => mockUpdateRowWithinUow(...args),
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

/** Mocks `db.select().from(envelopes).where().limit()`, always resolving one non-income envelope — enough for ConfirmSlipUseCase's up-front per-item validation reads (step 2). */
function createMockValidationDb(): any {
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue([{ id: 'env-1', envelopeType: 'spending' }]),
        })),
      })),
    })),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  resetFactoryCounter();
  mockRunInUnitOfWork.mockClear();
  mockInsertRowWithinUow.mockClear();
  mockUpdateRowWithinUow.mockClear();
  mockRunInUnitOfWork.mockImplementation((_db: unknown, fn: (uow: unknown) => void) =>
    fn({ db: {}, appendOp: jest.fn() }),
  );
});

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
    function slipInProgress(): SlipQueueRow {
      return {
        id: 'slip-1',
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        imageUris: [],
        status: 'processing',
        errorMessage: null,
        merchant: null,
        slipDate: null,
        totalCents: null,
        rawResponseJson: null,
        imagesDeletedAt: null,
        openaiCostCents: 0,
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-15T00:00:00.000Z',
      };
    }

    it('writes the item + slip completion in ONE runInUnitOfWork call (all-or-nothing commit)', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [slipInProgress()] });

      const uc = new ConfirmSlipUseCase(db, repo);
      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Milk', amountCents: 3500, envelopeId: 'env-1' }],
      });

      expect(result.success).toBe(true);
      expect(mockRunInUnitOfWork).toHaveBeenCalledTimes(1);
      expect(mockInsertRowWithinUow).toHaveBeenCalledTimes(1);
      expect(mockUpdateRowWithinUow).toHaveBeenCalledTimes(1);
      // The failure path (repo.update marking the slip 'failed') never runs.
      expect(repo.updates).toHaveLength(0);
    });

    it('on failure: rolls back (mocked) and marks slip as "failed" — never "completed"', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [slipInProgress()] });
      mockInsertRowWithinUow.mockImplementationOnce(() => {
        throw new Error('SLIP_PARTIAL_SAVE_FAILED: Transaction creation failed');
      });

      const uc = new ConfirmSlipUseCase(db, repo);
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
      // The slip-completion update never ran — the throw happened first.
      expect(mockUpdateRowWithinUow).not.toHaveBeenCalled();
    });

    it('on failure: the write transaction throws before the slip is ever marked "completed"', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [slipInProgress()] });
      mockInsertRowWithinUow.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const uc = new ConfirmSlipUseCase(db, repo);
      await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Eggs', amountCents: 4000, envelopeId: 'env-1' }],
      });

      expect(repo.updates.some((u: any) => u.patch.status === 'completed')).toBe(false);
    });

    it('double-confirm is idempotent: an already-"completed" slip returns success with no new writes', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [{ ...slipInProgress(), status: 'completed' }] });

      const uc = new ConfirmSlipUseCase(db, repo);
      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Eggs', amountCents: 4000, envelopeId: 'env-1' }],
      });

      expect(result.success).toBe(true);
      expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
      expect(repo.updates).toHaveLength(0);
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

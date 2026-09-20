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
import { transactions as transactionsTable } from '../../data/local/schema';
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
  fn({ db: { get: jest.fn(() => undefined) }, appendOp: jest.fn() }),
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

/**
 * Mocks `db.select(...).from(table).where(...).limit(...)`. Branches on the
 * `table` argument passed to `.from(...)`: the `transactions` table
 * resolves `existingTxns` (ConfirmSlipUseCase's Step-1 "already confirmed"
 * fast-path read — DOM-1 fix); anything else (the `envelopes` table)
 * always resolves one non-income envelope, enough for the per-item
 * validation reads (step 2).
 */
function createMockValidationDb(existingTxns: unknown[] = []): any {
  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => {
        if (table === transactionsTable) {
          return { where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue(existingTxns) })) };
        }
        return {
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([{ id: 'env-1', envelopeType: 'spending' }]),
          })),
        };
      }),
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
    // `uow.db.get` backs ConfirmSlipUseCase's atomic in-transaction
    // "already confirmed" guard (DOM-1 fix) — no existing row by default.
    fn({ db: { get: jest.fn(() => undefined) }, appendOp: jest.fn() }),
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
    // A freshly-extracted slip: ExtractSlipUseCase ALWAYS sets status
    // 'completed' the moment extraction succeeds (see the ExtractSlipUseCase
    // describe block above), long before the user has confirmed anything.
    // DOM-1: this used to make Confirm's idempotency guard fire on the very
    // FIRST attempt (it keyed off `status === 'completed'`) — Save silently
    // wrote zero transactions, always. These tests seed that same realistic
    // 'completed' status to prove Confirm no longer treats it as "already
    // done".
    function slipReadyToConfirm(): SlipQueueRow {
      return {
        id: 'slip-1',
        householdId: KRUGER_ID,
        createdBy: 'user-1',
        imageUris: [],
        status: 'completed',
        errorMessage: null,
        merchant: 'Checkers',
        slipDate: '2026-01-15',
        totalCents: 3500,
        rawResponseJson: '{}',
        imagesDeletedAt: null,
        openaiCostCents: 5,
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-15T00:00:00.000Z',
      };
    }

    it('DOM-1 regression: confirming a slip whose status is already "completed" (the real post-extraction state) still writes transactions', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [slipReadyToConfirm()] });

      const uc = new ConfirmSlipUseCase(db, repo);
      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Milk', amountCents: 3500, envelopeId: 'env-1' }],
      });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.transactionIds).toHaveLength(1);
      expect(mockRunInUnitOfWork).toHaveBeenCalledTimes(1);
      expect(mockInsertRowWithinUow).toHaveBeenCalledTimes(1);
      expect(mockUpdateRowWithinUow).toHaveBeenCalledTimes(1);
      // The failure path (repo.update marking the slip 'failed') never runs.
      expect(repo.updates).toHaveLength(0);
    });

    it('on failure: rolls back (mocked) and marks slip as "failed"', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [slipReadyToConfirm()] });
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

    it('on failure: the write transaction throws before the slip is ever re-marked "completed"', async () => {
      const db = createMockValidationDb();
      const repo = createMockSlipRepo({ slips: [slipReadyToConfirm()] });
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

    it('double-confirm is idempotent (DOM-1 fix): a slip whose item transactions already exist returns success with no new writes', async () => {
      const db = createMockValidationDb([{ id: 'existing-txn' }]); // Step-1 fast path finds the prior confirm's row
      const repo = createMockSlipRepo({ slips: [slipReadyToConfirm()] });

      const uc = new ConfirmSlipUseCase(db, repo);
      const result = await uc.execute({
        slipId: 'slip-1',
        householdId: KRUGER_ID,
        transactionDate: '2026-01-15',
        items: [{ description: 'Eggs', amountCents: 4000, envelopeId: 'env-1' }],
      });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.transactionIds).toEqual([]);
      expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
      expect(mockInsertRowWithinUow).not.toHaveBeenCalled();
      expect(repo.updates).toHaveLength(0);
    });

    describe('Extract then Confirm end-to-end (no pre-seeded convenient status)', () => {
      /**
       * A minimal, STATEFUL repo + db double: `update()` actually mutates the
       * seeded row (unlike `createMockSlipRepo`, which only records calls),
       * so `ExtractSlipUseCase`'s write is visible to the `ConfirmSlipUseCase`
       * that runs immediately after against the SAME repo state — exactly the
       * real app's flow, and exactly what let DOM-1 hide behind tests that
       * hand-seeded a convenient 'processing' status instead.
       */
      function createStatefulHarness(): {
        repo: ISlipQueueRepository;
        db: any;
        transactionsStore: Array<Record<string, unknown>>;
      } {
        const rows = new Map<string, SlipQueueRow>();
        rows.set('slip-1', {
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
        });
        const transactionsStore: Array<Record<string, unknown>> = [];

        const repo: ISlipQueueRepository = {
          create: jest.fn(async () => {}),
          get: jest.fn(async (id: string) => rows.get(id) ?? null),
          update: jest.fn(async (id: string, patch: Partial<SlipQueueRow>) => {
            const current = rows.get(id);
            if (current) rows.set(id, { ...current, ...patch });
          }),
          listByHousehold: jest.fn(async () => Array.from(rows.values())),
          listExpired: jest.fn(async () => []),
          listProcessingOlderThan: jest.fn(async () => []),
        };

        const db = {
          select: jest.fn(() => ({
            from: jest.fn((table: unknown) => {
              if (table === transactionsTable) {
                return {
                  where: jest.fn(() => ({
                    limit: jest.fn().mockImplementation(() =>
                      Promise.resolve(
                        transactionsStore
                          .filter((t) => !t.deleted_at)
                          .slice(0, 1)
                          .map((t) => ({ id: t.id })),
                      ),
                    ),
                  })),
                };
              }
              return {
                where: jest.fn(() => ({
                  limit: jest.fn().mockResolvedValue([{ id: 'env-1', envelopeType: 'spending' }]),
                })),
              };
            }),
          })),
        };

        return { repo, db, transactionsStore };
      }

      it('writes N transactions with slip_id + payee=merchant, and a second confirm writes none', async () => {
        const { repo, db, transactionsStore } = createStatefulHarness();
        const extractor = createMockExtractor({
          merchant: 'Woolworths',
          slipDate: '2026-01-15',
          totalCents: 8500,
          items: [
            {
              description: 'Milk',
              amountCents: 3500,
              quantity: 1,
              suggestedEnvelopeId: null,
              confidence: 0.9,
            },
            {
              description: 'Bread',
              amountCents: 5000,
              quantity: 1,
              suggestedEnvelopeId: null,
              confidence: 0.9,
            },
          ],
          rawResponseJson: '{}',
          openaiCostCents: 5,
        });

        // `uow.db.get` backs the atomic in-transaction guard; wire it to the
        // same store `insertRowWithinUow` writes to, so a real duplicate
        // would actually be caught (not just possible in principle).
        mockRunInUnitOfWork.mockImplementation((_db: unknown, fn: (uow: unknown) => void) =>
          fn({
            db: {
              get: jest.fn(() =>
                transactionsStore.find((t) => !t.deleted_at) ? { id: 'existing' } : undefined,
              ),
            },
            appendOp: jest.fn(),
          }),
        );
        mockInsertRowWithinUow.mockImplementation((_uow: unknown, table: string, row: any) => {
          if (table === 'transactions') transactionsStore.push(row);
        });

        // --- Extract -----------------------------------------------------
        const extractUc = new ExtractSlipUseCase(extractor, repo);
        const extraction = await extractUc.execute({
          slipId: 'slip-1',
          householdId: KRUGER_ID,
          framesBase64: ['base64data'],
        });
        expect(extraction.success).toBe(true);

        // --- Confirm (against the SAME repo, now reflecting extraction) --
        const confirmUc = new ConfirmSlipUseCase(db, repo);
        const first = await confirmUc.execute({
          slipId: 'slip-1',
          householdId: KRUGER_ID,
          transactionDate: '2026-01-15',
          items: [
            { description: 'Milk', amountCents: 3500, envelopeId: 'env-1' },
            { description: 'Bread', amountCents: 5000, envelopeId: 'env-1' },
          ],
        });

        expect(first.success).toBe(true);
        if (first.success) {
          expect(first.data.transactionIds).toHaveLength(2);
          expect(first.data.totalMismatch).toBe(false);
        }
        expect(transactionsStore).toHaveLength(2);
        for (const row of transactionsStore) {
          expect(row.slip_id).toBe('slip-1');
          expect(row.payee).toBe('Woolworths');
        }

        // --- Second confirm: writes none ----------------------------------
        const second = await confirmUc.execute({
          slipId: 'slip-1',
          householdId: KRUGER_ID,
          transactionDate: '2026-01-15',
          items: [
            { description: 'Milk', amountCents: 3500, envelopeId: 'env-1' },
            { description: 'Bread', amountCents: 5000, envelopeId: 'env-1' },
          ],
        });
        expect(second.success).toBe(true);
        if (second.success) expect(second.data.transactionIds).toEqual([]);
        expect(transactionsStore).toHaveLength(2); // unchanged — no duplicates
      });
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

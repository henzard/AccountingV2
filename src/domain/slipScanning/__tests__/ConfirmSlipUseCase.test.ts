/**
 * Unit tier for ConfirmSlipUseCase — exercises the guard/validation/wiring
 * logic against mocked collaborators (db.select, the repo, and the
 * low-level `runInUnitOfWork`/`insertRowWithinUow`/`updateRowWithinUow`
 * primitives). These mocks make the *ordering* (validate-before-write,
 * one-transaction-for-all-items) and the idempotency guard easy to assert,
 * but they cannot prove real rollback — a mocked `runInUnitOfWork` doesn't
 * roll anything back. The actual atomicity proof (a 2-item slip where item 2
 * fails leaves NEITHER item committed, against the real better-sqlite3
 * driver) lives in `tests/realsql/confirmSlipAtomicity.test.ts`, per the
 * spec §4.5 fix.
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: jest.fn(() => `uuid-${++counter}`) };
});
jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const mockRunInUnitOfWork = jest.fn((_db: unknown, fn: (uow: unknown) => void) =>
  fn({ db: {}, appendOp: jest.fn() }),
);
jest.mock('../../../data/uow/UnitOfWork', () => ({
  runInUnitOfWork: (...args: [unknown, (uow: unknown) => void]) => mockRunInUnitOfWork(...args),
}));

const mockInsertRowWithinUow = jest.fn();
const mockUpdateRowWithinUowGuarded = jest.fn();
jest.mock('../../../data/uow/createSyncedRepo', () => ({
  insertRowWithinUow: (...args: unknown[]) => mockInsertRowWithinUow(...args),
  updateRowWithinUowGuarded: (...args: unknown[]) => mockUpdateRowWithinUowGuarded(...args),
}));

import { ConfirmSlipUseCase } from '../ConfirmSlipUseCase';
import type { ISlipQueueRepository, SlipQueueRow } from '../../ports/ISlipQueueRepository';

const HOUSEHOLD_ID = 'hh-1';

function makeSlip(overrides: Partial<SlipQueueRow> = {}): SlipQueueRow {
  return {
    id: 's1',
    householdId: HOUSEHOLD_ID,
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
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepo(
  slip: SlipQueueRow | null,
): ISlipQueueRepository & { get: jest.Mock; update: jest.Mock } {
  return {
    create: jest.fn(),
    get: jest.fn().mockResolvedValue(slip),
    update: jest.fn().mockResolvedValue(undefined),
    listByHousehold: jest.fn(),
    listExpired: jest.fn(),
    listProcessingOlderThan: jest.fn(),
  };
}

/** Mocks `db.select().from().where().limit()`, resolving one queued envelope-lookup result per call (in call order — one call per item, in item order). */
function makeDb(): { db: { select: jest.Mock }; limit: jest.Mock } {
  const limit = jest.fn();
  const db = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit })),
      })),
    })),
  };
  return { db, limit };
}

const SPENDING_ENVELOPE = [{ id: 'env1', householdId: HOUSEHOLD_ID, envelopeType: 'spending' }];
const INCOME_ENVELOPE = [{ id: 'env-income', householdId: HOUSEHOLD_ID, envelopeType: 'income' }];

beforeEach(() => {
  jest.clearAllMocks();
  mockRunInUnitOfWork.mockImplementation((_db: unknown, fn: (uow: unknown) => void) =>
    fn({ db: {}, appendOp: jest.fn() }),
  );
  // Default: the conditional completion UPDATE matched the row (1 row
  // changed) — i.e. this confirm won. Tests exercising the TOCTOU-loser path
  // override this to return 0.
  mockUpdateRowWithinUowGuarded.mockReturnValue(1);
});

describe('ConfirmSlipUseCase', () => {
  it('rejects an empty item list without reading the db or touching the repo', async () => {
    const { db } = makeDb();
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SLIP_EMPTY_ITEMS');
    expect(repo.get).not.toHaveBeenCalled();
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('fails when the slip does not exist', async () => {
    const { db } = makeDb();
    const repo = makeRepo(null);
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 'missing',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SLIP_NOT_FOUND');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('is idempotent: a slip already "completed" returns success with no new writes (double-confirm guard)', async () => {
    const { db } = makeDb();
    const repo = makeRepo(makeSlip({ status: 'completed' }));
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toEqual([]);
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
    expect(mockInsertRowWithinUow).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('validates every item BEFORE opening the write transaction: an invalid amount on item 1 blocks the whole confirm', async () => {
    const { db, limit } = makeDb();
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'bad', amountCents: 0, envelopeId: 'env1' },
        { description: 'eggs', amountCents: 5000, envelopeId: 'env2' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(limit).not.toHaveBeenCalled(); // never even reached envelope lookups
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('validates the SECOND item too, before writing anything for the first (envelope not found)', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(SPENDING_ENVELOPE).mockResolvedValueOnce([]);
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'bread', amountCents: 3000, envelopeId: 'env-missing' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
    expect(mockInsertRowWithinUow).not.toHaveBeenCalled();
  });

  it('rejects an item targeting an income envelope', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(INCOME_ENVELOPE);
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'salary?', amountCents: 5000, envelopeId: 'env-income' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('happy path: writes all item rows + the slip completion inside ONE runInUnitOfWork call', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(SPENDING_ENVELOPE).mockResolvedValueOnce(SPENDING_ENVELOPE);
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'bread', amountCents: 3000, envelopeId: 'env2' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toHaveLength(2);
    expect(mockRunInUnitOfWork).toHaveBeenCalledTimes(1); // ONE transaction, not one per item
    expect(mockInsertRowWithinUow).toHaveBeenCalledTimes(2);
    expect(mockInsertRowWithinUow).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'transactions',
      expect.objectContaining({
        household_id: HOUSEHOLD_ID,
        envelope_id: 'env1',
        amount_cents: 5000,
        slip_id: 's1',
      }),
      expect.anything(),
    );
    // Slip completion is updated INSIDE the same transaction as the inserts,
    // via the conditional (TOCTOU-guarded) update — the extra arg before ctx
    // is the `status != 'completed'` guard predicate.
    expect(mockUpdateRowWithinUowGuarded).toHaveBeenCalledTimes(1);
    expect(mockUpdateRowWithinUowGuarded).toHaveBeenCalledWith(
      expect.anything(),
      'slip_queue',
      's1',
      HOUSEHOLD_ID,
      expect.objectContaining({ status: 'completed' }),
      expect.anything(), // the SQL guard predicate
      expect.anything(),
    );
    // The failure path (mark slip 'failed' via the repo) must NOT have run.
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('on a mid-transaction throw: rolls back (per the mocked runInUnitOfWork) and marks the slip "failed" — not "completed"', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(SPENDING_ENVELOPE).mockResolvedValueOnce(SPENDING_ENVELOPE);
    mockInsertRowWithinUow
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('boom on item 2');
      });
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'bread', amountCents: 3000, envelopeId: 'env2' },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SLIP_PARTIAL_SAVE_FAILED');
    expect(repo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('boom') }),
    );
    expect(mockUpdateRowWithinUowGuarded).not.toHaveBeenCalled(); // never reached the slip-completion write
  });

  it('TOCTOU loser: the conditional completion UPDATE matching 0 rows returns idempotent success and does NOT mark the slip failed', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(SPENDING_ENVELOPE);
    // Simulate a concurrent confirm having completed the slip after our
    // Step-1 read: the guarded `status != 'completed'` UPDATE matches 0 rows.
    mockUpdateRowWithinUowGuarded.mockReturnValue(0);
    const repo = makeRepo(makeSlip()); // Step-1 read still sees 'processing'
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    // Idempotent success — NOT the SLIP_PARTIAL_SAVE_FAILED failure path.
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toEqual([]);
    // The slip must NOT be marked 'failed' — the other confirm succeeded.
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('writes one best-effort audit log entry per item when an AuditLogger is supplied', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(SPENDING_ENVELOPE).mockResolvedValueOnce(SPENDING_ENVELOPE);
    const repo = makeRepo(makeSlip());
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const useCase = new ConfirmSlipUseCase(db as any, repo, { audit: audit as any });

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'bread', amountCents: 3000, envelopeId: 'env2' },
      ],
    });

    expect(result.success).toBe(true);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('does not fail the use case when audit logging throws (ledger write already committed)', async () => {
    const { db, limit } = makeDb();
    limit.mockResolvedValueOnce(SPENDING_ENVELOPE);
    const repo = makeRepo(makeSlip());
    const audit = { log: jest.fn().mockRejectedValue(new Error('audit db down')) };
    const useCase = new ConfirmSlipUseCase(db as any, repo, { audit: audit as any });

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(true);
  });
});

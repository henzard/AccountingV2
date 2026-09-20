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
 *
 * DOM-1: "already confirmed" is now keyed on `transactions.slip_id`
 * existing, NOT `slip_queue.status` (which `ExtractSlipUseCase` already sets
 * to 'completed' before the user ever confirms) — see `makeDb`'s
 * `existingTxns` option (Step-1 fast path) and `uow.db.get` mocking (the
 * atomic Step-3 guard).
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: jest.fn(() => `uuid-${++counter}`) };
});
jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const mockRunInUnitOfWork = jest.fn((_db: unknown, fn: (uow: unknown) => void) =>
  fn({ db: { get: jest.fn(() => undefined) }, appendOp: jest.fn() }),
);
jest.mock('../../../data/uow/UnitOfWork', () => ({
  runInUnitOfWork: (...args: [unknown, (uow: unknown) => void]) => mockRunInUnitOfWork(...args),
}));

const mockInsertRowWithinUow = jest.fn();
const mockUpdateRowWithinUow = jest.fn();
jest.mock('../../../data/uow/createSyncedRepo', () => ({
  insertRowWithinUow: (...args: unknown[]) => mockInsertRowWithinUow(...args),
  updateRowWithinUow: (...args: unknown[]) => mockUpdateRowWithinUow(...args),
}));

import { ConfirmSlipUseCase } from '../ConfirmSlipUseCase';
import type { ISlipQueueRepository, SlipQueueRow } from '../../ports/ISlipQueueRepository';
import { transactions } from '../../../data/local/schema';

const HOUSEHOLD_ID = 'hh-1';

function makeSlip(overrides: Partial<SlipQueueRow> = {}): SlipQueueRow {
  return {
    id: 's1',
    householdId: HOUSEHOLD_ID,
    createdBy: 'user-1',
    imageUris: [],
    status: 'completed', // ExtractSlipUseCase always sets this BEFORE confirm ever runs (DOM-1).
    errorMessage: null,
    merchant: 'Checkers',
    slipDate: '2026-04-13',
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

/**
 * Mocks `db.select(...).from(table).where(...).limit(...)`. Branches on the
 * `table` argument passed to `.from(...)`: the `transactions` table resolves
 * `existingTxns` (Step-1's "already confirmed" fast-path read); anything
 * else (the `envelopes` table) resolves the next entry off `envelopeResults`,
 * in call order — one call per item.
 */
function makeDb(opts: { existingTxns?: unknown[]; envelopeResults?: unknown[][] } = {}): {
  db: { select: jest.Mock };
  limit: jest.Mock;
} {
  const envelopeQueue = [...(opts.envelopeResults ?? [])];
  const limit = jest.fn(() => Promise.resolve(envelopeQueue.shift() ?? []));
  const db = {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => {
        if (table === transactions) {
          return {
            where: jest.fn(() => ({ limit: jest.fn().mockResolvedValue(opts.existingTxns ?? []) })),
          };
        }
        return { where: jest.fn(() => ({ limit })) };
      }),
    })),
  };
  return { db, limit };
}

const SPENDING_ENVELOPE = [{ id: 'env1', householdId: HOUSEHOLD_ID, envelopeType: 'spending' }];
const INCOME_ENVELOPE = [{ id: 'env-income', householdId: HOUSEHOLD_ID, envelopeType: 'income' }];

beforeEach(() => {
  jest.clearAllMocks();
  mockRunInUnitOfWork.mockImplementation((_db: unknown, fn: (uow: unknown) => void) =>
    fn({ db: { get: jest.fn(() => undefined) }, appendOp: jest.fn() }),
  );
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

  it('is idempotent (Step-1 fast path): a slip whose item transactions already exist returns success with no new writes — even though slip_queue.status is already "completed" from extraction', async () => {
    const { db } = makeDb({ existingTxns: [{ id: 'existing-txn' }] });
    const repo = makeRepo(makeSlip({ status: 'completed' }));
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactionIds).toEqual([]);
      expect(result.data.totalMismatch).toBe(false);
    }
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
    expect(mockInsertRowWithinUow).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('DOM-1 regression: a freshly-extracted slip (status already "completed", no transactions written yet) is CONFIRMED, not short-circuited', async () => {
    const { db, limit } = makeDb({ existingTxns: [], envelopeResults: [SPENDING_ENVELOPE] });
    const repo = makeRepo(makeSlip({ status: 'completed' }));
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toHaveLength(1);
    expect(mockRunInUnitOfWork).toHaveBeenCalledTimes(1);
    expect(mockInsertRowWithinUow).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledTimes(1); // the envelope lookup ran
  });

  it('DOM-12: drops a non-positive line item instead of failing the whole confirm, and never persists it', async () => {
    const { db, limit } = makeDb({ existingTxns: [], envelopeResults: [SPENDING_ENVELOPE] });
    const repo = makeRepo(makeSlip({ totalCents: 5000 }));
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'discount', amountCents: 0, envelopeId: 'env1' },
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.transactionIds).toHaveLength(1);
    // Only the positive item was validated/looked up and inserted.
    expect(limit).toHaveBeenCalledTimes(1);
    expect(mockInsertRowWithinUow).toHaveBeenCalledTimes(1);
    expect(mockInsertRowWithinUow).toHaveBeenCalledWith(
      expect.anything(),
      'transactions',
      expect.objectContaining({ amount_cents: 5000 }),
      expect.anything(),
    );
  });

  it('DOM-12: an all-non-positive item list fails as SLIP_EMPTY_ITEMS rather than writing nothing silently', async () => {
    const { db } = makeDb();
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'discount', amountCents: -500, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SLIP_EMPTY_ITEMS');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('DOM-12: flags totalMismatch (including dropped discount lines in the comparison) without failing the confirm', async () => {
    const { db } = makeDb({
      existingTxns: [],
      envelopeResults: [SPENDING_ENVELOPE, SPENDING_ENVELOPE],
    });
    // Slip's extracted total is 4500 (5000 - 500 discount); items sum to the same.
    const repo = makeRepo(makeSlip({ totalCents: 4500 }));
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const matching = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [
        { description: 'eggs', amountCents: 5000, envelopeId: 'env1' },
        { description: 'discount', amountCents: -500, envelopeId: 'env1' },
      ],
    });
    expect(matching.success).toBe(true);
    if (matching.success) expect(matching.data.totalMismatch).toBe(false);

    const { db: db2 } = makeDb({ existingTxns: [], envelopeResults: [SPENDING_ENVELOPE] });
    const repo2 = makeRepo(makeSlip({ id: 's2', totalCents: 999999 }));
    const useCase2 = new ConfirmSlipUseCase(db2 as any, repo2);
    const mismatched = await useCase2.execute({
      slipId: 's2',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });
    expect(mismatched.success).toBe(true);
    if (mismatched.success) expect(mismatched.data.totalMismatch).toBe(true);
  });

  it('validates the SECOND item too, before writing anything for the first (envelope not found)', async () => {
    const { db } = makeDb({
      existingTxns: [],
      envelopeResults: [SPENDING_ENVELOPE, []],
    });
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
    const { db } = makeDb({ existingTxns: [], envelopeResults: [INCOME_ENVELOPE] });
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

  // REG-12: this use case used to hand-roll its own envelope check (existence
  // + income-type only) instead of the shared `transactionValidation` rules
  // that CreateTransactionUseCase/UpdateTransactionUseCase enforce — an
  // archived or soft-deleted target envelope, an invalid/too-far-future
  // date, and a non-safe-integer amount all slipped through uncaught.

  it('rejects an item targeting an ARCHIVED envelope (REG-12)', async () => {
    const archivedEnvelope = [
      { id: 'env1', householdId: HOUSEHOLD_ID, envelopeType: 'spending', isArchived: true },
    ];
    const { db } = makeDb({ existingTxns: [], envelopeResults: [archivedEnvelope] });
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('rejects an item targeting a SOFT-DELETED envelope (REG-12)', async () => {
    const deletedEnvelope = [
      {
        id: 'env1',
        householdId: HOUSEHOLD_ID,
        envelopeType: 'spending',
        deletedAt: '2026-04-01T00:00:00.000Z',
      },
    ];
    const { db } = makeDb({ existingTxns: [], envelopeResults: [deletedEnvelope] });
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('rejects a transactionDate more than 1 day in the future (REG-12)', async () => {
    const { db } = makeDb({ existingTxns: [] });
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2099-01-01',
      items: [{ description: 'eggs', amountCents: 5000, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('FUTURE_DATE');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('rejects a non-safe-integer amount (fractional cents) even though it is positive (REG-12)', async () => {
    const { db } = makeDb({ existingTxns: [], envelopeResults: [SPENDING_ENVELOPE] });
    const repo = makeRepo(makeSlip());
    const useCase = new ConfirmSlipUseCase(db as any, repo);

    const result = await useCase.execute({
      slipId: 's1',
      householdId: HOUSEHOLD_ID,
      transactionDate: '2026-04-13',
      items: [{ description: 'eggs', amountCents: 50.5, envelopeId: 'env1' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(mockRunInUnitOfWork).not.toHaveBeenCalled();
  });

  it('happy path: writes all item rows (payee = slip.merchant) + the slip completion inside ONE runInUnitOfWork call', async () => {
    const { db } = makeDb({
      existingTxns: [],
      envelopeResults: [SPENDING_ENVELOPE, SPENDING_ENVELOPE],
    });
    const repo = makeRepo(makeSlip({ merchant: 'Checkers', totalCents: 8000 }));
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
    if (result.success) {
      expect(result.data.transactionIds).toHaveLength(2);
      expect(result.data.totalMismatch).toBe(false);
    }
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
        payee: 'Checkers',
        slip_id: 's1',
      }),
      expect.anything(),
    );
    // Slip completion is updated INSIDE the same transaction as the inserts.
    expect(mockUpdateRowWithinUow).toHaveBeenCalledTimes(1);
    expect(mockUpdateRowWithinUow).toHaveBeenCalledWith(
      expect.anything(),
      'slip_queue',
      's1',
      HOUSEHOLD_ID,
      expect.objectContaining({ status: 'completed' }),
      expect.anything(),
    );
    // The failure path (mark slip 'failed' via the repo) must NOT have run.
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('on a mid-transaction throw: rolls back (per the mocked runInUnitOfWork) and marks the slip "failed" — not "completed"', async () => {
    const { db } = makeDb({
      existingTxns: [],
      envelopeResults: [SPENDING_ENVELOPE, SPENDING_ENVELOPE],
    });
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
    expect(mockUpdateRowWithinUow).not.toHaveBeenCalled(); // never reached the slip-completion write
  });

  it('TOCTOU loser: the atomic in-transaction existence check finding a row returns idempotent success and does NOT mark the slip failed', async () => {
    const { db } = makeDb({ existingTxns: [], envelopeResults: [SPENDING_ENVELOPE] });
    // Simulate a concurrent confirm having inserted this slip's transaction
    // between our Step-1 read and this write: the in-transaction existence
    // check (uow.db.get) now finds a row.
    mockRunInUnitOfWork.mockImplementation((_db: unknown, fn: (uow: unknown) => void) =>
      fn({ db: { get: jest.fn(() => ({ id: 'txn-from-other-confirm' })) }, appendOp: jest.fn() }),
    );
    const repo = makeRepo(makeSlip()); // Step-1 fast path still sees no rows (opts.existingTxns: [])
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
    // The loser never inserted a duplicate row.
    expect(mockInsertRowWithinUow).not.toHaveBeenCalled();
  });

  it('writes one best-effort audit log entry per item when an AuditLogger is supplied', async () => {
    const { db } = makeDb({
      existingTxns: [],
      envelopeResults: [SPENDING_ENVELOPE, SPENDING_ENVELOPE],
    });
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
    const { db } = makeDb({ existingTxns: [], envelopeResults: [SPENDING_ENVELOPE] });
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

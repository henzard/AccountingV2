import { UpdateTransactionUseCase } from '../UpdateTransactionUseCase';
import type { SyncedRepo } from '../../../data/uow/createSyncedRepo';
import type { TransactionEntity } from '../TransactionEntity';

/**
 * `mockDb.select` is called twice per execute(): once for the "is this
 * transaction deleted?" re-read, once for the target-envelope check. Each
 * queues its OWN resolved row via a fresh `mockImplementationOnce`.
 */
function queueSelect(db: { select: jest.Mock }, rows: unknown[]): void {
  db.select.mockImplementationOnce(() => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }),
    }),
  }));
}

function makeDb(): { select: jest.Mock } {
  return { select: jest.fn() };
}

function makeFakeRepo(): SyncedRepo & {
  insert: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  increment: jest.Mock;
} {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

const current: TransactionEntity = {
  id: 'tx-1',
  householdId: 'hh-1',
  envelopeId: 'env-1',
  amountCents: 5000,
  payee: 'Pick n Pay',
  description: null,
  transactionDate: '2026-04-10',
  isBusinessExpense: false,
  spendingTriggerNote: null,
  slipId: null,
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
};

const validInput = {
  envelopeId: 'env-1',
  amountCents: 7500,
  payee: 'Woolworths',
  description: 'Groceries',
  transactionDate: '2026-04-12',
};

/** Queues the two selects a happy-path execute() needs, in order. */
function queueHappyPath(db: { select: jest.Mock }): void {
  queueSelect(db, [{ deletedAt: null }]); // not deleted
  queueSelect(db, [{ id: 'env-1', envelopeType: 'spending', isArchived: false, deletedAt: null }]); // envelope ok
}

describe('UpdateTransactionUseCase', () => {
  beforeEach(() => {
    mockAudit.log.mockClear();
  });

  it('rejects amountCents <= 0 before touching the db', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(
      db as any,
      mockAudit as any,
      current,
      { ...validInput, amountCents: 0 },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    expect(db.select).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed transactionDate before touching the db', async () => {
    const db = makeDb();
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(
      db as any,
      mockAudit as any,
      current,
      { ...validInput, transactionDate: 'not-a-date' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_DATE');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects editing a soft-deleted transaction', async () => {
    const db = makeDb();
    queueSelect(db, [{ deletedAt: '2026-04-11T00:00:00.000Z' }]);
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(db as any, mockAudit as any, current, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRANSACTION_DELETED');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects when the transaction no longer exists', async () => {
    const db = makeDb();
    queueSelect(db, []); // no row
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(db as any, mockAudit as any, current, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRANSACTION_NOT_FOUND');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects retargeting to a nonexistent envelope', async () => {
    const db = makeDb();
    queueSelect(db, [{ deletedAt: null }]);
    queueSelect(db, []); // envelope not found
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(db as any, mockAudit as any, current, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects retargeting to an income envelope', async () => {
    const db = makeDb();
    queueSelect(db, [{ deletedAt: null }]);
    queueSelect(db, [{ id: 'env-2', envelopeType: 'income', isArchived: false, deletedAt: null }]);
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(
      db as any,
      mockAudit as any,
      current,
      { ...validInput, envelopeId: 'env-2' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');
  });

  it('rejects retargeting to an archived envelope', async () => {
    const db = makeDb();
    queueSelect(db, [{ deletedAt: null }]);
    queueSelect(db, [{ id: 'env-2', envelopeType: 'spending', isArchived: true, deletedAt: null }]);
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(
      db as any,
      mockAudit as any,
      current,
      { ...validInput, envelopeId: 'env-2' },
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');
  });

  it('updates the transaction row via the synced repo on the happy path', async () => {
    const db = makeDb();
    queueHappyPath(db);
    const repo = makeFakeRepo();
    const uc = new UpdateTransactionUseCase(db as any, mockAudit as any, current, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(7500);
      expect(result.data.payee).toBe('Woolworths');
      expect(result.data.transactionDate).toBe('2026-04-12');
    }
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();

    const [id, householdId, fields] = repo.update.mock.calls[0];
    expect(id).toBe('tx-1');
    expect(householdId).toBe('hh-1');
    expect(fields).toEqual(
      expect.objectContaining({
        envelope_id: 'env-1',
        amount_cents: 7500,
        payee: 'Woolworths',
        description: 'Groceries',
        transaction_date: '2026-04-12',
        is_business_expense: 0,
      }),
    );
  });

  it('never includes slip_id in the write, even for a slip-created transaction', async () => {
    const db = makeDb();
    queueHappyPath(db);
    const repo = makeFakeRepo();
    const slipCreated: TransactionEntity = { ...current, slipId: 'slip-1' };
    const uc = new UpdateTransactionUseCase(db as any, mockAudit as any, slipCreated, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    const [, , fields] = repo.update.mock.calls[0];
    expect(fields).not.toHaveProperty('slip_id');
    // The entity returned still carries the original slipId untouched.
    if (result.success) expect(result.data.slipId).toBe('slip-1');
  });

  it('translates a zero-rows-matched update into TRANSACTION_NOT_FOUND', async () => {
    const db = makeDb();
    queueHappyPath(db);
    const repo = makeFakeRepo();
    repo.update.mockImplementation(() => {
      throw new Error(
        'createSyncedRepo: no row in "transactions" matched id=tx-1 household_id=hh-1 — 0 rows affected, refusing to append an oplog op',
      );
    });
    const uc = new UpdateTransactionUseCase(db as any, mockAudit as any, current, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  it('still returns success when audit.log rejects after the write has committed', async () => {
    const db = makeDb();
    queueHappyPath(db);
    const repo = makeFakeRepo();
    const audit = { log: jest.fn().mockRejectedValue(new Error('audit db down')) };
    const uc = new UpdateTransactionUseCase(db as any, audit as any, current, validInput, {
      repo,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    expect(repo.update).toHaveBeenCalledTimes(1);
  });

  it('defaults isBusinessExpense to false when omitted', async () => {
    const db = makeDb();
    queueHappyPath(db);
    const repo = makeFakeRepo();
    const { ...inputWithoutFlag } = validInput as typeof validInput & {
      isBusinessExpense?: boolean;
    };
    const uc = new UpdateTransactionUseCase(
      db as any,
      mockAudit as any,
      current,
      inputWithoutFlag,
      { repo },
    );
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isBusinessExpense).toBe(false);
  });
});

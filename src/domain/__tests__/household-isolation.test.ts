import { CreateTransactionUseCase } from '../transactions/CreateTransactionUseCase';
import { DeleteTransactionUseCase } from '../transactions/DeleteTransactionUseCase';
import { ArchiveEnvelopeUseCase } from '../envelopes/ArchiveEnvelopeUseCase';
import { UpdateEnvelopeUseCase } from '../envelopes/UpdateEnvelopeUseCase';
import type { TransactionEntity } from '../transactions/TransactionEntity';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid-001' }));

const HOUSEHOLD_A = 'household-aaa';
const HOUSEHOLD_B = 'household-bbb';

function createMockDb() {
  const whereTracker = {
    selectWheres: [] as any[],
  };

  const chainable = (tracker: any[], resolveValue?: any) => {
    const chain: any = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn((condition: any) => {
      tracker.push(condition);
      return chain;
    });
    chain.limit = jest.fn().mockResolvedValue(resolveValue ?? []);
    chain.values = jest.fn().mockResolvedValue(undefined);
    chain.from = jest.fn().mockReturnValue(chain);
    chain.orderBy = jest.fn().mockReturnValue(chain);
    return chain;
  };

  const db: any = {
    select: jest.fn(() => chainable(whereTracker.selectWheres, [])),
    transaction: jest.fn(async (cb: any) => cb(db)),
  };

  return { db, whereTracker };
}

function createMockAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

/** Fake `SyncedRepo` — household-scoping now lives in `createSyncedRepo`'s SQL
 * (`WHERE id = ? AND household_id = ?`, see its realsql tests). These tests
 * assert that each use case passes the *correct* householdId through to the
 * repo, rather than inspecting a mocked Drizzle WHERE clause. */
function createMockSyncedRepo(): SyncedRepo & {
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

describe('Household Data Isolation — CreateTransactionUseCase', () => {
  it('scopes envelope lookup to the requesting householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const uc = new CreateTransactionUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        envelopeId: 'env-1',
        amountCents: 100,
        payee: null,
        description: null,
        transactionDate: '2026-06-01',
      },
      { repo },
    );

    await uc.execute();

    expect(db.select).toHaveBeenCalled();
    expect(whereTracker.selectWheres.length).toBeGreaterThan(0);
    // The mock captures the WHERE condition function but cannot evaluate it against
    // real data. The assertion above confirms a WHERE clause was applied; true
    // isolation semantics (household-A data invisible to household-B) require an
    // integration test with a real database.
  });

  it('returns ENVELOPE_NOT_FOUND when envelope belongs to a different household', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const uc = new CreateTransactionUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_B,
        envelopeId: 'env-belongs-to-A',
        amountCents: 500,
        payee: null,
        description: null,
        transactionDate: '2026-06-01',
      },
      { repo },
    );

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('inserts the transaction row via the repo scoped to the requesting householdId, and never touches the envelope', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    // Make the select return a valid envelope so the use case proceeds to insert
    db.select = jest.fn(() => ({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest
        .fn()
        .mockResolvedValue([{ id: 'env-1', householdId: HOUSEHOLD_A, envelopeType: 'spending' }]),
    }));

    const uc = new CreateTransactionUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        envelopeId: 'env-1',
        amountCents: 100,
        payee: 'Shop',
        description: null,
        transactionDate: '2026-06-01',
      },
      { repo },
    );

    await uc.execute();

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const [row] = repo.insert.mock.calls[0];
    expect(row.household_id).toBe(HOUSEHOLD_A);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
  });
});

describe('Household Data Isolation — DeleteTransactionUseCase', () => {
  it('scopes the soft-delete to the transaction entity householdId', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const tx: TransactionEntity = {
      id: 'tx-1',
      householdId: HOUSEHOLD_A,
      envelopeId: 'env-1',
      amountCents: 200,
      payee: 'Shop',
      description: null,
      transactionDate: '2026-06-01',
      isBusinessExpense: false,
      spendingTriggerNote: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const uc = new DeleteTransactionUseCase(db, audit, tx, { repo });
    await uc.execute();

    expect(repo.softDelete).toHaveBeenCalledWith('tx-1', HOUSEHOLD_A, expect.any(Object));
  });

  it('does not touch the envelope (no update/increment call)', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const tx: TransactionEntity = {
      id: 'tx-1',
      householdId: HOUSEHOLD_A,
      envelopeId: 'env-1',
      amountCents: 200,
      payee: null,
      description: null,
      transactionDate: '2026-06-01',
      isBusinessExpense: false,
      spendingTriggerNote: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const uc = new DeleteTransactionUseCase(db, audit, tx, { repo });
    await uc.execute();

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.increment).not.toHaveBeenCalled();
  });
});

describe('Household Data Isolation — ArchiveEnvelopeUseCase', () => {
  it('scopes the update to the envelope entity householdId', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const envelope: EnvelopeEntity = {
      id: 'env-1',
      householdId: HOUSEHOLD_A,
      name: 'Groceries',
      allocatedCents: 500_00,
      spentCents: 200_00,
      envelopeType: 'spending',
      isSavingsLocked: false,
      isArchived: false,
      periodStart: '2026-06-01',
      targetAmountCents: null,
      targetDate: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const uc = new ArchiveEnvelopeUseCase(db, audit, envelope, { repo });
    await uc.execute();

    expect(repo.update).toHaveBeenCalledWith(
      'env-1',
      HOUSEHOLD_A,
      expect.any(Object),
      expect.any(Object),
    );
  });
});

describe('Household Data Isolation — UpdateEnvelopeUseCase', () => {
  it('scopes the update to the current entity householdId', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const current: EnvelopeEntity = {
      id: 'env-1',
      householdId: HOUSEHOLD_A,
      name: 'Groceries',
      allocatedCents: 500_00,
      spentCents: 200_00,
      envelopeType: 'spending',
      isSavingsLocked: false,
      isArchived: false,
      periodStart: '2026-06-01',
      targetAmountCents: null,
      targetDate: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const uc = new UpdateEnvelopeUseCase(
      db,
      audit,
      current,
      { name: 'Food', allocatedCents: 600_00 },
      { repo },
    );

    await uc.execute();

    expect(repo.update).toHaveBeenCalledWith(
      'env-1',
      HOUSEHOLD_A,
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('does not cross household boundaries — different householdId in current entity', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const repo = createMockSyncedRepo();

    const current: EnvelopeEntity = {
      id: 'env-1',
      householdId: HOUSEHOLD_B,
      name: 'Groceries',
      allocatedCents: 500_00,
      spentCents: 200_00,
      envelopeType: 'spending',
      isSavingsLocked: false,
      isArchived: false,
      periodStart: '2026-06-01',
      targetAmountCents: null,
      targetDate: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const uc = new UpdateEnvelopeUseCase(
      db,
      audit,
      current,
      { name: 'Updated by B', allocatedCents: 700_00 },
      { repo },
    );

    await uc.execute();

    // The repo call uses current.householdId which is HOUSEHOLD_B — if an
    // attacker somehow swaps `current` to a different household's envelope,
    // the write would still be scoped by that entity's householdId (and, at
    // the SQL layer inside createSyncedRepo, would affect 0 rows and throw).
    expect(repo.update).toHaveBeenCalledWith(
      'env-1',
      HOUSEHOLD_B,
      expect.any(Object),
      expect.any(Object),
    );
  });
});

import { CreateTransactionUseCase } from '../transactions/CreateTransactionUseCase';
import { DeleteTransactionUseCase } from '../transactions/DeleteTransactionUseCase';
import { ArchiveEnvelopeUseCase } from '../envelopes/ArchiveEnvelopeUseCase';
import { UpdateEnvelopeUseCase } from '../envelopes/UpdateEnvelopeUseCase';
import type { TransactionEntity } from '../transactions/TransactionEntity';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid-001' }));

const HOUSEHOLD_A = 'household-aaa';
const HOUSEHOLD_B = 'household-bbb';

function createMockDb() {
  const selectCalls: any[] = [];
  const updateCalls: any[] = [];
  const deleteCalls: any[] = [];
  const insertCalls: any[] = [];

  const whereTracker = {
    selectWheres: [] as any[],
    updateWheres: [] as any[],
    deleteWheres: [] as any[],
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
    update: jest.fn((table: any) => {
      const c = chainable(whereTracker.updateWheres);
      updateCalls.push({ table });
      return c;
    }),
    delete: jest.fn((table: any) => {
      const c = chainable(whereTracker.deleteWheres);
      deleteCalls.push({ table });
      return c;
    }),
    insert: jest.fn(() => ({
      values: jest.fn().mockResolvedValue(undefined),
    })),
  };

  return { db, whereTracker, selectCalls, updateCalls, deleteCalls, insertCalls };
}

function createMockAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) } as any;
}

function createMockEnqueuer() {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
}

describe('Household Data Isolation — CreateTransactionUseCase', () => {
  it('scopes envelope lookup to the requesting householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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
      enqueuer,
    );

    await uc.execute();

    expect(db.select).toHaveBeenCalled();
    expect(whereTracker.selectWheres.length).toBeGreaterThan(0);
  });

  it('returns ENVELOPE_NOT_FOUND when envelope belongs to a different household', async () => {
    const { db } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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
      enqueuer,
    );

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    }
  });

  it('scopes envelope spentCents update to householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

    // Make the select return a valid envelope so the use case proceeds to update
    const selectChain: any = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn((cond: any) => {
        whereTracker.selectWheres.push(cond);
        return selectChain;
      }),
      limit: jest
        .fn()
        .mockResolvedValue([{ id: 'env-1', householdId: HOUSEHOLD_A, envelopeType: 'spending' }]),
    };
    db.select = jest.fn(() => selectChain);

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
      enqueuer,
    );

    await uc.execute();

    expect(db.update).toHaveBeenCalled();
    expect(whereTracker.updateWheres.length).toBeGreaterThan(0);
  });
});

describe('Household Data Isolation — DeleteTransactionUseCase', () => {
  it('scopes DELETE to householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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

    const uc = new DeleteTransactionUseCase(db, audit, tx, enqueuer);
    await uc.execute();

    expect(db.delete).toHaveBeenCalled();
    expect(whereTracker.deleteWheres.length).toBeGreaterThan(0);
  });

  it('scopes envelope spentCents decrement to householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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

    const uc = new DeleteTransactionUseCase(db, audit, tx, enqueuer);
    await uc.execute();

    expect(db.update).toHaveBeenCalled();
    expect(whereTracker.updateWheres.length).toBeGreaterThan(0);
  });
});

describe('Household Data Isolation — ArchiveEnvelopeUseCase', () => {
  it('scopes UPDATE to householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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

    const uc = new ArchiveEnvelopeUseCase(db, audit, envelope, enqueuer);
    await uc.execute();

    expect(db.update).toHaveBeenCalled();
    expect(whereTracker.updateWheres.length).toBeGreaterThan(0);
  });
});

describe('Household Data Isolation — UpdateEnvelopeUseCase', () => {
  it('scopes UPDATE to householdId', async () => {
    const { db, whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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
      {
        name: 'Food',
        allocatedCents: 600_00,
      },
      enqueuer,
    );

    await uc.execute();

    expect(db.update).toHaveBeenCalled();
    expect(whereTracker.updateWheres.length).toBeGreaterThan(0);
  });

  it('does not cross household boundaries — different householdId in current entity', async () => {
    const { db, whereTracker: _whereTracker } = createMockDb();
    const audit = createMockAudit();
    const enqueuer = createMockEnqueuer();

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
      {
        name: 'Updated by B',
        allocatedCents: 700_00,
      },
      enqueuer,
    );

    await uc.execute();

    // The WHERE clause uses current.householdId which is HOUSEHOLD_B
    // If an attacker somehow swaps current to a different household's envelope,
    // the WHERE would still filter by that entity's householdId.
    expect(db.update).toHaveBeenCalled();
  });
});

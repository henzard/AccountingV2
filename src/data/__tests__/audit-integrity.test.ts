import { AuditLogger } from '../audit/AuditLogger';
import { CreateTransactionUseCase } from '../../domain/transactions/CreateTransactionUseCase';
import { CreateEnvelopeUseCase } from '../../domain/envelopes/CreateEnvelopeUseCase';
import { DeleteTransactionUseCase } from '../../domain/transactions/DeleteTransactionUseCase';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';
import type { SyncedRepo } from '../uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));

function makeMockDb() {
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const mockInsert = jest.fn().mockReturnValue({ values: insertValues });
  const mockUpdate = jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
  });
  const mockDelete = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  });
  const mockSelect = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([{ id: 'e1', envelopeType: 'spending' }]),
      }),
    }),
  });

  const db = {
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: mockSelect,
  } as any;
  db.transaction = jest.fn(async (cb: any) => cb(db));

  return {
    db,
    insertValues,
    mockInsert,
  };
}

/** Fake `SyncedRepo` — the write dependency the envelope/transaction use cases now use
 * instead of `ISyncEnqueuer` (balance is derived; entity write + oplog append happen
 * atomically inside `createSyncedRepo`, see slice-3 task 3). */
function makeMockSyncedRepo(): SyncedRepo & {
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

describe('Audit Trail Integrity', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('AuditLogger', () => {
    it('inserts an audit event with all required fields', async () => {
      const { db, insertValues } = makeMockDb();
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'transaction',
        entityId: 'tx-1',
        action: 'create',
        previousValue: null,
        newValue: { amountCents: 5000 },
      });

      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'mock-uuid',
          householdId: 'h1',
          entityType: 'transaction',
          entityId: 'tx-1',
          action: 'create',
          createdAt: expect.any(String),
        }),
      );
    });

    it('stores previousValue as JSON string', async () => {
      const { db, insertValues } = makeMockDb();
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'envelope',
        entityId: 'e1',
        action: 'update',
        previousValue: { allocatedCents: 100000 },
        newValue: { allocatedCents: 200000 },
      });

      const insertedRow = insertValues.mock.calls[0][0];
      expect(insertedRow.previousValueJson).toBe(JSON.stringify({ allocatedCents: 100000 }));
      expect(insertedRow.newValueJson).toBe(JSON.stringify({ allocatedCents: 200000 }));
    });

    it('stores null previousValue for create actions', async () => {
      const { db, insertValues } = makeMockDb();
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'transaction',
        entityId: 'tx-1',
        action: 'create',
        previousValue: null,
        newValue: { id: 'tx-1' },
      });

      expect(insertValues.mock.calls[0][0].previousValueJson).toBeNull();
    });

    it('stores null newValue for delete actions', async () => {
      const { db, insertValues } = makeMockDb();
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'transaction',
        entityId: 'tx-1',
        action: 'delete',
        previousValue: { id: 'tx-1', amountCents: 3000 },
        newValue: null,
      });

      expect(insertValues.mock.calls[0][0].newValueJson).toBeNull();
      expect(insertValues.mock.calls[0][0].previousValueJson).not.toBeNull();
    });

    it('does not enqueue onto pending_sync (audit_events is local-only, slice 5)', async () => {
      const insertValues = jest.fn().mockResolvedValue(undefined);
      const mockInsert = jest.fn().mockReturnValue({ values: insertValues });
      const db = { insert: mockInsert } as any;
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'transaction',
        entityId: 'tx-1',
        action: 'create',
        previousValue: null,
        newValue: { id: 'tx-1' },
      });

      // AuditLogger no longer depends on PendingSyncEnqueuer (deleted, slice 5
      // task 6) — db.insert is called exactly once, for audit_events only.
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('includes ISO 8601 timestamp in createdAt', async () => {
      const { db, insertValues } = makeMockDb();
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'envelope',
        entityId: 'e1',
        action: 'create',
        previousValue: null,
        newValue: {},
      });

      const createdAt = insertValues.mock.calls[0][0].createdAt;
      expect(() => new Date(createdAt)).not.toThrow();
      expect(new Date(createdAt).toISOString()).toBe(createdAt);
    });
  });

  describe('CreateTransactionUseCase — audit integration', () => {
    it('produces an audit event on successful creation', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const uc = new CreateTransactionUseCase(
        db,
        mockAudit,
        {
          householdId: 'h1',
          envelopeId: 'e1',
          amountCents: 5000,
          payee: 'Checkers',
          description: null,
          transactionDate: '2026-06-10',
        },
        { repo },
      );

      const result = await uc.execute();
      expect(result.success).toBe(true);
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: 'h1',
          entityType: 'transaction',
          action: 'create',
          previousValue: null,
        }),
      );
    });

    it('audit newValue contains transaction fields', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const uc = new CreateTransactionUseCase(
        db,
        mockAudit,
        {
          householdId: 'h1',
          envelopeId: 'e1',
          amountCents: 7500,
          payee: 'Woolworths',
          description: 'Weekly shop',
          transactionDate: '2026-06-15',
        },
        { repo },
      );

      await uc.execute();
      const auditInput = mockAudit.log.mock.calls[0][0];
      expect(auditInput.newValue).toEqual(
        expect.objectContaining({
          envelopeId: 'e1',
          amountCents: 7500,
          payee: 'Woolworths',
          transactionDate: '2026-06-15',
        }),
      );
    });
  });

  describe('CreateEnvelopeUseCase — audit integration', () => {
    it('produces an audit event on successful creation', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const uc = new CreateEnvelopeUseCase(
        db,
        mockAudit,
        {
          householdId: 'h1',
          name: 'Transport',
          allocatedCents: 200000,
          envelopeType: 'spending',
          periodStart: '2026-06-01',
        },
        { repo },
      );

      const result = await uc.execute();
      expect(result.success).toBe(true);
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: 'h1',
          entityType: 'envelope',
          action: 'create',
          previousValue: null,
        }),
      );
    });

    it('audit newValue contains envelope fields', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const uc = new CreateEnvelopeUseCase(
        db,
        mockAudit,
        {
          householdId: 'h1',
          name: 'Savings',
          allocatedCents: 1000000,
          envelopeType: 'savings',
          periodStart: '2026-06-01',
        },
        { repo },
      );

      await uc.execute();
      const auditInput = mockAudit.log.mock.calls[0][0];
      expect(auditInput.newValue).toEqual(
        expect.objectContaining({
          householdId: 'h1',
          name: 'Savings',
          allocatedCents: 1000000,
          envelopeType: 'savings',
        }),
      );
    });
  });

  describe('DeleteTransactionUseCase — audit integration', () => {
    it('produces an audit event with action=delete', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const tx: TransactionEntity = {
        id: 'tx-del-1',
        householdId: 'h1',
        envelopeId: 'e1',
        amountCents: 4500,
        payee: 'Spar',
        description: null,
        transactionDate: '2026-06-12',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-06-12T08:00:00.000Z',
        updatedAt: '2026-06-12T08:00:00.000Z',
      };

      const uc = new DeleteTransactionUseCase(db, mockAudit, tx, { repo });
      const result = await uc.execute();

      expect(result.success).toBe(true);
      expect(mockAudit.log).toHaveBeenCalledTimes(1);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: 'h1',
          entityType: 'transaction',
          entityId: 'tx-del-1',
          action: 'delete',
          newValue: null,
        }),
      );
    });

    it('audit previousValue contains the deleted transaction data', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const tx: TransactionEntity = {
        id: 'tx-del-2',
        householdId: 'h1',
        envelopeId: 'e1',
        amountCents: 9900,
        payee: 'Takealot',
        description: null,
        transactionDate: '2026-06-10',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-06-10T10:00:00.000Z',
        updatedAt: '2026-06-10T10:00:00.000Z',
      };

      const uc = new DeleteTransactionUseCase(db, mockAudit, tx, { repo });
      await uc.execute();

      const auditInput = mockAudit.log.mock.calls[0][0];
      expect(auditInput.previousValue).toEqual(
        expect.objectContaining({
          id: 'tx-del-2',
          envelopeId: 'e1',
          amountCents: 9900,
          payee: 'Takealot',
        }),
      );
    });

    it('soft-deletes via the synced repo (one oplog op) after resolving success', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const repo = makeMockSyncedRepo();

      const tx: TransactionEntity = {
        id: 'tx-del-3',
        householdId: 'h1',
        envelopeId: 'e1',
        amountCents: 1000,
        payee: null,
        description: null,
        transactionDate: '2026-06-01',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      };

      const uc = new DeleteTransactionUseCase(db, mockAudit, tx, { repo });
      await uc.execute();

      expect(repo.softDelete).toHaveBeenCalledWith('tx-del-3', 'h1', expect.any(Object));
    });
  });
});

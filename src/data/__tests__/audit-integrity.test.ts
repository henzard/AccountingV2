import { AuditLogger } from '../audit/AuditLogger';
import { CreateTransactionUseCase } from '../../domain/transactions/CreateTransactionUseCase';
import { CreateEnvelopeUseCase } from '../../domain/envelopes/CreateEnvelopeUseCase';
import { DeleteTransactionUseCase } from '../../domain/transactions/DeleteTransactionUseCase';
import type { TransactionEntity } from '../../domain/transactions/TransactionEntity';

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

function makeMockEnqueuer() {
  return { enqueue: jest.fn().mockResolvedValue(undefined) };
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
          isSynced: false,
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

    it('enqueues audit event for sync after insertion', async () => {
      const insertValues = jest.fn().mockResolvedValue(undefined);
      const mockInsert = jest.fn().mockReturnValue({ values: insertValues });
      // PendingSyncEnqueuer.enqueue first selects to check for existing entry,
      // then inserts a new pending_sync row when none found.
      const mockSelect = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]), // no existing pending item
          }),
        }),
      });
      const db = { insert: mockInsert, select: mockSelect } as any;
      const logger = new AuditLogger(db);

      await logger.log({
        householdId: 'h1',
        entityType: 'transaction',
        entityId: 'tx-1',
        action: 'create',
        previousValue: null,
        newValue: { id: 'tx-1' },
      });

      // AuditLogger calls db.insert twice: once for audit_events, once via PendingSyncEnqueuer
      expect(mockInsert).toHaveBeenCalledTimes(2);
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
      const enqueuer = makeMockEnqueuer();

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
        enqueuer,
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
      const enqueuer = makeMockEnqueuer();

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
        enqueuer,
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
      const enqueuer = makeMockEnqueuer();

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
        enqueuer,
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
      const enqueuer = makeMockEnqueuer();

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
        enqueuer,
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
      const enqueuer = makeMockEnqueuer();

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

      const uc = new DeleteTransactionUseCase(db, mockAudit, tx, enqueuer);
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
      const enqueuer = makeMockEnqueuer();

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

      const uc = new DeleteTransactionUseCase(db, mockAudit, tx, enqueuer);
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

    it('enqueues DELETE sync operation after audit', async () => {
      const { db } = makeMockDb();
      const mockAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;
      const enqueuer = makeMockEnqueuer();

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

      const uc = new DeleteTransactionUseCase(db, mockAudit, tx, enqueuer);
      await uc.execute();

      expect(enqueuer.enqueue).toHaveBeenCalledWith('transactions', 'tx-del-3', 'DELETE');
    });
  });
});

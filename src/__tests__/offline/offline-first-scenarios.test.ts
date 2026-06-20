/**
 * Offline-first scenarios: verify that domain operations work with a local DB
 * and no network, producing isSynced: false rows and enqueuing to pending_sync.
 */
import { CreateTransactionUseCase } from '../../domain/transactions/CreateTransactionUseCase';
import { CreateEnvelopeUseCase } from '../../domain/envelopes/CreateEnvelopeUseCase';
import { LogDebtPaymentUseCase } from '../../domain/debtSnowball/LogDebtPaymentUseCase';
import { buildEnvelope, buildDebt, resetFactoryCounter } from '../../__test-utils__/factories';
import { HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';
import type { ISyncEnqueuer, SyncOperation } from '../../domain/ports/ISyncEnqueuer';
import type { IDebtRepository } from '../../domain/ports/IDebtRepository';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2, 10),
}));

// ─── Mock Helpers ────────────────────────────────────────────────────────────

interface EnqueueCall {
  tableName: string;
  recordId: string;
  operation: SyncOperation;
}

function createMockEnqueuer(): ISyncEnqueuer & { calls: EnqueueCall[] } {
  const calls: EnqueueCall[] = [];
  return {
    calls,
    enqueue: jest.fn(async (tableName, recordId, operation) => {
      calls.push({ tableName, recordId, operation });
    }),
  };
}

function createMockAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function createMockDebtRepo(): IDebtRepository & { lastUpdate: any } {
  const state = { lastUpdate: null as any };
  return {
    ...state,
    findById: jest.fn().mockResolvedValue(null),
    findByHousehold: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(async (debt: any) => {
      state.lastUpdate = debt;
    }),
    incrementTotalPaid: jest.fn().mockResolvedValue(undefined),
    get lastUpdate() {
      return state.lastUpdate;
    },
  };
}

const KRUGER_ID = HOUSEHOLDS.kruger.id;

function createMockDb(envelopeRows: unknown[] = []) {
  const inserted: { table: string; values: any }[] = [];
  const updated: { table: string; set: any }[] = [];

  const whereClause = {
    limit: jest.fn().mockResolvedValue(envelopeRows),
  };

  const chainable = {
    where: jest.fn().mockReturnValue(whereClause),
  };

  const db: any = {
    inserted,
    updated,
    insert: jest.fn().mockImplementation((_table: any) => ({
      values: jest.fn().mockImplementation((vals: any) => {
        inserted.push({ table: 'insert', values: vals });
        return Promise.resolve();
      }),
    })),
    update: jest.fn().mockImplementation((_table: any) => ({
      set: jest.fn().mockImplementation((vals: any) => {
        updated.push({ table: 'update', set: vals });
        return { where: jest.fn().mockResolvedValue(undefined) };
      }),
    })),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue(chainable),
    }),
    transaction: jest.fn(async (cb: any) => cb(db)),
  };

  return db;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => resetFactoryCounter());

describe('Offline-First Scenarios (airplane mode)', () => {
  describe('CreateTransactionUseCase offline', () => {
    it('saves transaction locally with isSynced: false', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateTransactionUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          envelopeId: envelope.id,
          amountCents: 15000,
          payee: 'Checkers',
          description: null,
          transactionDate: '2026-01-15',
        },
        enqueuer,
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      expect(db.inserted.length).toBe(1);
      expect(db.inserted[0].values.isSynced).toBe(false);
    });

    it('enqueues INSERT to pending_sync for transactions table', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateTransactionUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          envelopeId: envelope.id,
          amountCents: 5000,
          payee: 'Spar',
          description: null,
          transactionDate: '2026-02-10',
        },
        enqueuer,
      );

      await uc.execute();

      expect(enqueuer.enqueue).toHaveBeenCalledWith('transactions', expect.any(String), 'INSERT');
      expect(enqueuer.calls).toHaveLength(1);
      expect(enqueuer.calls[0].tableName).toBe('transactions');
      expect(enqueuer.calls[0].operation).toBe('INSERT');
    });

    it('atomically increments envelope spentCents', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateTransactionUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          envelopeId: envelope.id,
          amountCents: 25000,
          payee: 'Woolworths',
          description: null,
          transactionDate: '2026-03-01',
        },
        enqueuer,
      );

      await uc.execute();

      expect(db.update).toHaveBeenCalled();
      expect(db.updated.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CreateEnvelopeUseCase offline', () => {
    it('saves envelope locally with isSynced: false and spentCents: 0', async () => {
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateEnvelopeUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          name: 'Groceries',
          allocatedCents: 800000,
          envelopeType: 'spending',
          periodStart: '2026-01-01',
        },
        enqueuer,
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spentCents).toBe(0);
        expect(result.data.householdId).toBe(KRUGER_ID);
      }
      expect(db.inserted.length).toBe(1);
      expect(db.inserted[0].values.isSynced).toBe(false);
    });

    it('enqueues INSERT to pending_sync for envelopes table', async () => {
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateEnvelopeUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          name: 'Fuel',
          allocatedCents: 400000,
          envelopeType: 'spending',
          periodStart: '2026-01-01',
        },
        enqueuer,
      );

      await uc.execute();

      expect(enqueuer.enqueue).toHaveBeenCalledWith('envelopes', expect.any(String), 'INSERT');
      expect(enqueuer.calls[0].tableName).toBe('envelopes');
    });

    it('sets isSavingsLocked true for savings-type envelopes', async () => {
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateEnvelopeUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          name: 'Emergency Fund',
          allocatedCents: 500000,
          envelopeType: 'savings',
          periodStart: '2026-01-01',
        },
        enqueuer,
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isSavingsLocked).toBe(true);
      }
    });
  });

  describe('LogDebtPaymentUseCase offline', () => {
    it('updates totalPaidCents and outstandingBalanceCents locally', async () => {
      const debt = buildDebt({
        householdId: KRUGER_ID,
        outstandingBalanceCents: 320000,
        totalPaidCents: 0,
      });
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();
      const repo = createMockDebtRepo();

      const uc = new LogDebtPaymentUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          debtId: debt.id,
          paymentAmountCents: 15000,
          currentDebt: debt,
        },
        enqueuer,
        repo,
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalPaidCents).toBe(15000);
        expect(result.data.outstandingBalanceCents).toBe(305000);
        expect(result.data.isPaidOff).toBe(false);
      }
    });

    it('caps payment at outstanding balance and marks isPaidOff', async () => {
      const debt = buildDebt({
        householdId: KRUGER_ID,
        outstandingBalanceCents: 5000,
        totalPaidCents: 95000,
      });
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();
      const repo = createMockDebtRepo();

      const uc = new LogDebtPaymentUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          debtId: debt.id,
          paymentAmountCents: 10000,
          currentDebt: debt,
        },
        enqueuer,
        repo,
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.outstandingBalanceCents).toBe(0);
        expect(result.data.totalPaidCents).toBe(100000);
        expect(result.data.isPaidOff).toBe(true);
      }
    });

    it('enqueues UPDATE to pending_sync for debts table', async () => {
      const debt = buildDebt({ householdId: KRUGER_ID });
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();
      const repo = createMockDebtRepo();

      const uc = new LogDebtPaymentUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          debtId: debt.id,
          paymentAmountCents: 5000,
          currentDebt: debt,
        },
        enqueuer,
        repo,
      );

      await uc.execute();

      expect(enqueuer.enqueue).toHaveBeenCalledWith('debts', debt.id, 'UPDATE');
      expect(enqueuer.calls[0].tableName).toBe('debts');
      expect(enqueuer.calls[0].operation).toBe('UPDATE');
    });

    it('calls repo.incrementTotalPaid for atomic SQL update', async () => {
      const debt = buildDebt({
        householdId: KRUGER_ID,
        outstandingBalanceCents: 100000,
      });
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();
      const repo = createMockDebtRepo();

      const uc = new LogDebtPaymentUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          debtId: debt.id,
          paymentAmountCents: 20000,
          currentDebt: debt,
        },
        enqueuer,
        repo,
      );

      await uc.execute();

      expect(repo.incrementTotalPaid).toHaveBeenCalledWith(debt.id, KRUGER_ID, 20000);
    });
  });

  describe('All operations create audit trail', () => {
    it('CreateTransactionUseCase logs audit event', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();

      const uc = new CreateTransactionUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          envelopeId: envelope.id,
          amountCents: 10000,
          payee: 'Test',
          description: null,
          transactionDate: '2026-01-15',
        },
        enqueuer,
      );

      await uc.execute();

      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: KRUGER_ID,
          entityType: 'transaction',
          action: 'create',
        }),
      );
    });

    it('LogDebtPaymentUseCase logs audit event with payment action', async () => {
      const debt = buildDebt({ householdId: KRUGER_ID });
      const db = createMockDb();
      const audit = createMockAudit();
      const enqueuer = createMockEnqueuer();
      const repo = createMockDebtRepo();

      const uc = new LogDebtPaymentUseCase(
        db,
        audit as any,
        {
          householdId: KRUGER_ID,
          debtId: debt.id,
          paymentAmountCents: 5000,
          currentDebt: debt,
        },
        enqueuer,
        repo,
      );

      await uc.execute();

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'debt',
          action: 'payment',
        }),
      );
    });
  });
});

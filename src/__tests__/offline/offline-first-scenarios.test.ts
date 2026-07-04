/**
 * Offline-first scenarios: verify that domain operations work with a local DB
 * and no network, producing isSynced: false rows and enqueuing to pending_sync.
 */
import { CreateTransactionUseCase } from '../../domain/transactions/CreateTransactionUseCase';
import { CreateEnvelopeUseCase } from '../../domain/envelopes/CreateEnvelopeUseCase';
import { LogDebtPaymentUseCase } from '../../domain/debtSnowball/LogDebtPaymentUseCase';
import { buildEnvelope, buildDebt, resetFactoryCounter } from '../../__test-utils__/factories';
import { HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2, 10),
}));

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

/** Fake `SyncedRepo` — the write dependency `CreateTransactionUseCase`/`CreateEnvelopeUseCase`
 * now use instead of `ISyncEnqueuer` (balance is derived; entity write + oplog append is one
 * atomic call via `createSyncedRepo`, see slice-3 task 3). */
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
    // LogDebtPaymentUseCase drives runInUnitOfWork directly (raw SQL via
    // `tx.run(...)`) for its combined balance/total_paid/is_paid_off write +
    // its 2 oplog appends (is_paid_off is server-derived, slice 5 task 6) —
    // `ran` records every such call.
    ran: [] as unknown[],
    run: jest.fn().mockImplementation(function (this: any, query: unknown) {
      this.ran.push(query);
    }),
  };

  return db;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => resetFactoryCounter());

describe('Offline-First Scenarios (airplane mode)', () => {
  describe('CreateTransactionUseCase offline', () => {
    it('saves transaction locally via the synced repo (no isSynced column)', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const repo = createMockSyncedRepo();

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
        { repo },
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      expect(repo.insert).toHaveBeenCalledTimes(1);
      const [row] = repo.insert.mock.calls[0];
      expect(row).not.toHaveProperty('is_synced');
    });

    it('appends exactly one oplog op via repo.insert for the transactions table', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const repo = createMockSyncedRepo();

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
        { repo },
      );

      await uc.execute();

      expect(repo.insert).toHaveBeenCalledTimes(1);
      const [row] = repo.insert.mock.calls[0];
      expect(row.household_id).toBe(KRUGER_ID);
      expect(row.envelope_id).toBe(envelope.id);
    });

    it('does NOT touch the envelope — balance is derived, not stored', async () => {
      const envelope = buildEnvelope({
        householdId: KRUGER_ID,
        envelopeType: 'spending',
      });
      const db = createMockDb([envelope]);
      const audit = createMockAudit();
      const repo = createMockSyncedRepo();

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
        { repo },
      );

      await uc.execute();

      expect(db.update).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.increment).not.toHaveBeenCalled();
    });
  });

  describe('CreateEnvelopeUseCase offline', () => {
    it('saves envelope locally via the synced repo (no isSynced or spent_cents column)', async () => {
      const db = createMockDb();
      const audit = createMockAudit();
      const repo = createMockSyncedRepo();

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
        { repo },
      );

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spentCents).toBe(0);
        expect(result.data.householdId).toBe(KRUGER_ID);
      }
      expect(repo.insert).toHaveBeenCalledTimes(1);
      const [row] = repo.insert.mock.calls[0];
      expect(row).not.toHaveProperty('is_synced');
      expect(row).not.toHaveProperty('spent_cents');
    });

    it('appends exactly one oplog op via repo.insert for the envelopes table', async () => {
      const db = createMockDb();
      const audit = createMockAudit();
      const repo = createMockSyncedRepo();

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
        { repo },
      );

      await uc.execute();

      expect(repo.insert).toHaveBeenCalledTimes(1);
      const [row] = repo.insert.mock.calls[0];
      expect(row.household_id).toBe(KRUGER_ID);
    });

    it('sets isSavingsLocked true for savings-type envelopes', async () => {
      const db = createMockDb();
      const audit = createMockAudit();
      const repo = createMockSyncedRepo();

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
        { repo },
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

      const uc = new LogDebtPaymentUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        debtId: debt.id,
        paymentAmountCents: 15000,
        currentDebt: debt,
      });

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

      const uc = new LogDebtPaymentUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        debtId: debt.id,
        paymentAmountCents: 10000,
        currentDebt: debt,
      });

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.outstandingBalanceCents).toBe(0);
        expect(result.data.totalPaidCents).toBe(100000);
        expect(result.data.isPaidOff).toBe(true);
      }
    });

    it('appends its writes via the oplog (no pending_sync enqueue)', async () => {
      const debt = buildDebt({ householdId: KRUGER_ID });
      const db = createMockDb();
      const audit = createMockAudit();

      const uc = new LogDebtPaymentUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        debtId: debt.id,
        paymentAmountCents: 5000,
        currentDebt: debt,
      });

      await uc.execute();

      // One combined entity UPDATE + 2 appendOp INSERTs (balance/total_paid
      // increment ops only — is_paid_off is server-derived as of slice 5
      // task 6, see LogDebtPaymentUseCase's own doc comment), all via raw
      // SQL through the single db.transaction() below — never through
      // ISyncEnqueuer/pending_sync.
      expect(db.ran).toHaveLength(3);
    });

    it('runs the whole payment inside one db.transaction (atomic write + ops)', async () => {
      const debt = buildDebt({
        householdId: KRUGER_ID,
        outstandingBalanceCents: 100000,
      });
      const db = createMockDb();
      const audit = createMockAudit();

      const uc = new LogDebtPaymentUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        debtId: debt.id,
        paymentAmountCents: 20000,
        currentDebt: debt,
      });

      await uc.execute();

      expect(db.transaction).toHaveBeenCalledTimes(1);
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
      const repo = createMockSyncedRepo();

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
        { repo },
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

      const uc = new LogDebtPaymentUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        debtId: debt.id,
        paymentAmountCents: 5000,
        currentDebt: debt,
      });

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

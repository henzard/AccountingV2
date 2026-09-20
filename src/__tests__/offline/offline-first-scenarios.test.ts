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
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

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
    // `runInUnitOfWork` runs against a SYNC-mode Drizzle handle
    // (PortableDb) — the real `db.transaction` invokes its callback
    // synchronously and returns its value, it is NOT async. Modelling it as
    // async made any throw inside the callback surface as an unhandled
    // promise rejection (the use case does not await `runInUnitOfWork`),
    // which kills the jest worker instead of failing a test.
    transaction: jest.fn((cb: any) => cb(db)),
    // LogDebtPaymentUseCase drives runInUnitOfWork directly (raw SQL via
    // `tx.run(...)`) for its combined balance/total_paid/is_paid_off write +
    // its 2 oplog appends (is_paid_off is server-derived, slice 5 task 6) —
    // `ran` records every such call.
    //
    // `run` must return a real affected-row count: the use case now calls
    // `assertRunMatchedRow` on the result so a payment against a missing or
    // already-deleted debt fails with DEBT_NOT_FOUND instead of silently
    // appending ops for a row that does not exist. `{ changes: 1 }` is the
    // "one debt row matched" answer every test here assumes.
    ran: [] as unknown[],
    run: jest.fn().mockImplementation(function (this: any, query: unknown) {
      this.ran.push(query);
      return { changes: 1 };
    }),
  };

  return db;
}

/**
 * `runInUnitOfWork` writes raw `sql` through `tx.run(...)`, and `createMockDb`
 * records every one of those in `db.ran`. These decode that log back into
 * something assertable, so a test can still say "exactly one oplog op for the
 * envelopes table" now that the write goes through the unit of work instead of
 * an injectable `SyncedRepo`.
 */
const dialect = new SQLiteSyncDialect();

interface RanInsert {
  table: string;
  columns: string[];
  params: unknown[];
}

function ranInserts(db: { ran: unknown[] }): RanInsert[] {
  return db.ran
    .map((query) => dialect.sqlToQuery(query as SQL))
    .map(({ sql, params }) => {
      const match = /^\s*INSERT INTO (\w+) \(([^)]*)\) VALUES/.exec(sql);
      if (!match) return null;
      return {
        table: match[1],
        columns: match[2].split(',').map((c) => c.trim()),
        params,
      };
    })
    .filter((entry): entry is RanInsert => entry !== null);
}

/** The single entity row inserted into `table`, as a column map. */
function insertedRow(db: { ran: unknown[] }, table: string): Record<string, unknown> {
  const inserts = ranInserts(db).filter((entry) => entry.table === table);
  expect(inserts).toHaveLength(1);
  const row: Record<string, unknown> = {};
  inserts[0].columns.forEach((column, index) => {
    row[column] = inserts[0].params[index];
  });
  return row;
}

/** How many oplog ops were appended for `table`. */
function oplogOpCount(db: { ran: unknown[] }, table: string): number {
  return ranInserts(db).filter(
    (entry) =>
      entry.table === 'oplog' && entry.params[entry.columns.indexOf('table_name')] === table,
  ).length;
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
    it('saves envelope locally through the unit of work (no isSynced or spent_cents column)', async () => {
      const db = createMockDb();
      const audit = createMockAudit();

      const uc = new CreateEnvelopeUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        name: 'Groceries',
        allocatedCents: 800000,
        envelopeType: 'spending',
        periodStart: '2026-01-01',
      });

      const result = await uc.execute();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spentCents).toBe(0);
        expect(result.data.householdId).toBe(KRUGER_ID);
      }
      // The envelope and (for a persistent type) its creation-period
      // contribution now share ONE transaction, so the write goes through
      // `runInUnitOfWork` rather than an injectable `SyncedRepo` — still
      // purely local, which is what this suite is about.
      expect(db.transaction).toHaveBeenCalledTimes(1);
      const row = insertedRow(db, 'envelopes');
      expect(row.household_id).toBe(KRUGER_ID);
      expect(row).not.toHaveProperty('is_synced');
      expect(row).not.toHaveProperty('spent_cents');
    });

    it('appends exactly ONE oplog op for a period-scoped envelope', async () => {
      const db = createMockDb();
      const audit = createMockAudit();

      const uc = new CreateEnvelopeUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        name: 'Fuel',
        allocatedCents: 400000,
        envelopeType: 'spending',
        periodStart: '2026-01-01',
      });

      await uc.execute();

      expect(oplogOpCount(db, 'envelopes')).toBe(1);
      // A period-scoped envelope holds no balance, so there is nothing to
      // contribute to it.
      expect(oplogOpCount(db, 'envelope_contributions')).toBe(0);
      expect(insertedRow(db, 'envelopes').household_id).toBe(KRUGER_ID);
    });

    it('appends TWO oplog ops for a persistent envelope — the fund and its creation-period contribution', async () => {
      const db = createMockDb();
      const audit = createMockAudit();

      const uc = new CreateEnvelopeUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        name: 'Car Service',
        allocatedCents: 50000,
        envelopeType: 'sinking_fund',
        periodStart: '2026-01-01',
      });

      const result = await uc.execute();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');

      // REG-7: a fund created mid-period never sees a rollover INTO the
      // period it was born in, so it funds that period itself — offline, in
      // the SAME transaction as the fund, which is why a plane-mode create
      // still shows the right saved balance.
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(oplogOpCount(db, 'envelopes')).toBe(1);
      expect(oplogOpCount(db, 'envelope_contributions')).toBe(1);

      const contribution = insertedRow(db, 'envelope_contributions');
      expect(contribution).toEqual(
        expect.objectContaining({
          household_id: KRUGER_ID,
          envelope_id: result.data.id,
          amount_cents: 50000,
          period_start: '2026-01-01',
          source: 'initial',
        }),
      );
    });

    it('sets isSavingsLocked true for savings-type envelopes', async () => {
      const db = createMockDb();
      const audit = createMockAudit();

      const uc = new CreateEnvelopeUseCase(db, audit as any, {
        householdId: KRUGER_ID,
        name: 'Emergency Fund',
        allocatedCents: 500000,
        envelopeType: 'savings',
        periodStart: '2026-01-01',
      });

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

      // One combined entity UPDATE, then 2 oplog appends (balance/total_paid
      // increment ops only — is_paid_off is server-derived as of slice 5
      // task 6, see LogDebtPaymentUseCase's own doc comment), all via raw SQL
      // through the single db.transaction() below — never through
      // ISyncEnqueuer/pending_sync.
      //
      // Each `increment` append is TWO statements: the oplog row itself, plus
      // an `oplog_applied` guard row written in the SAME transaction (SYNC-1).
      // That guard is what stops the puller re-applying this device's own
      // increment and double-counting the payment, so it is part of the
      // payment write, not incidental.
      expect(db.ran).toHaveLength(5);
      const statements = db.ran.map((q: unknown) => JSON.stringify(q));
      expect(statements.filter((sql: string) => sql.includes('oplog_applied'))).toHaveLength(2);
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

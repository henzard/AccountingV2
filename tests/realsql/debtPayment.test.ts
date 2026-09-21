import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { LogDebtPaymentUseCase } from '../../src/domain/debtSnowball/LogDebtPaymentUseCase';
import type { DebtEntity } from '../../src/domain/debtSnowball/DebtEntity';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedDebt(db: Database.Database, overrides: Partial<DebtEntity> = {}): DebtEntity {
  const debt: DebtEntity = {
    id: 'debt-1',
    householdId: 'hh-1',
    creditorName: 'FNB Credit Card',
    debtType: 'credit_card',
    outstandingBalanceCents: 100000,
    initialBalanceCents: 100000,
    interestRatePercent: 22.5,
    minimumPaymentCents: 2500,
    sortOrder: 0,
    isPaidOff: false,
    totalPaidCents: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO debts (
       id, household_id, creditor_name, debt_type, outstanding_balance_cents,
       initial_balance_cents, interest_rate_percent, minimum_payment_cents,
       sort_order, is_paid_off, total_paid_cents, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    debt.id,
    debt.householdId,
    debt.creditorName,
    debt.debtType,
    debt.outstandingBalanceCents,
    debt.initialBalanceCents,
    debt.interestRatePercent,
    debt.minimumPaymentCents,
    debt.sortOrder,
    debt.isPaidOff ? 1 : 0,
    debt.totalPaidCents,
    debt.createdAt,
    debt.updatedAt,
  );
  return debt;
}

interface DebtRow {
  id: string;
  outstanding_balance_cents: number;
  total_paid_cents: number;
  is_paid_off: number;
  updated_at: string;
}

interface OplogRow {
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string;
}

const noopAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

describe('LogDebtPaymentUseCase (real SQLite)', () => {
  it('a partial payment: decrements balance, increments total_paid, appends exactly 2 oplog ops', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const debt = seedDebt(raw);
    const db = drizzle(raw);

    const uc = new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 30000,
      currentDebt: debt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);

    const row = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as DebtRow;
    expect(row.outstanding_balance_cents).toBe(70000);
    expect(row.total_paid_cents).toBe(30000);
    expect(row.is_paid_off).toBe(0);

    const ops = raw
      .prepare('SELECT * FROM oplog WHERE row_id = ? ORDER BY rowid')
      .all('debt-1') as OplogRow[];
    // Slice 5 task 6: the third op (a plain `update` carrying a
    // client-computed is_paid_off) was removed — the server now derives
    // is_paid_off from outstanding_balance_cents via a trigger
    // (supabase/migrations/0001_baseline.sql §9g), closing the divergence
    // risk the Task-1 review flagged. Only the two `increment` ops remain.
    expect(ops).toHaveLength(2);

    const balanceOp = ops.find(
      (o) =>
        o.op_type === 'increment' && JSON.parse(o.payload).field === 'outstanding_balance_cents',
    );
    expect(balanceOp).toBeTruthy();
    expect(JSON.parse(balanceOp!.payload)).toEqual({
      field: 'outstanding_balance_cents',
      delta: -30000,
      clamp: 'floor_zero',
    });

    const totalPaidOp = ops.find(
      (o) => o.op_type === 'increment' && JSON.parse(o.payload).field === 'total_paid_cents',
    );
    expect(totalPaidOp).toBeTruthy();
    expect(JSON.parse(totalPaidOp!.payload)).toEqual({
      field: 'total_paid_cents',
      delta: 30000,
      clamp: 'none',
    });

    for (const op of ops) {
      expect(op.household_id).toBe('hh-1');
      expect(op.table_name).toBe('debts');
    }

    raw.close();
  });

  it('an overpayment: clamps balance at 0 (floor_zero) and marks is_paid_off', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const debt = seedDebt(raw, { outstandingBalanceCents: 5000, initialBalanceCents: 5000 });
    const db = drizzle(raw);

    const uc = new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 20000, // overpays the 5000 balance
      currentDebt: debt,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);

    const row = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as DebtRow;
    // Clamped to the actual outstanding amount, not the full overpayment.
    expect(row.outstanding_balance_cents).toBe(0);
    expect(row.total_paid_cents).toBe(5000);
    expect(row.is_paid_off).toBe(1);

    raw.close();
  });

  it('two sequential payments accumulate correctly (no lost update)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const debt = seedDebt(raw);
    const db = drizzle(raw);

    await new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 20000,
      currentDebt: debt,
    }).execute();

    // Second payment reads the ORIGINAL debt snapshot too (simulating two
    // devices/taps racing off the same stale read) — the SQL-expression-based
    // write must still land both payments correctly rather than the second
    // write clobbering the first's balance decrement (the deep-review bug).
    await new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 15000,
      currentDebt: debt,
    }).execute();

    const row = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as DebtRow;
    expect(row.outstanding_balance_cents).toBe(65000); // 100000 - 20000 - 15000
    expect(row.total_paid_cents).toBe(35000);

    const opCount = (
      raw.prepare('SELECT COUNT(*) AS n FROM oplog WHERE row_id = ?').get('debt-1') as {
        n: number;
      }
    ).n;
    expect(opCount).toBe(4); // 2 ops per payment x 2 payments

    raw.close();
  });

  it('rolls back the entity write and both ops together when the transaction fails mid-write', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const debt = seedDebt(raw);
    const db = drizzle(raw);

    // Pre-seed an oplog row occupying an op_id that a forced genId collision
    // will reuse, so the second appendOp's INSERT hits a PK conflict AFTER
    // the entity UPDATE and the first appendOp have already run inside the
    // same transaction — proving the whole transaction rolls back together.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
         VALUES ('dup-op', 'hh-0', 'debts', 'other-row', 'increment', '{}', 'device-0', ?)`,
      )
      .run(NOW);

    let callCount = 0;
    const uc = new LogDebtPaymentUseCase(
      db as any,
      noopAudit,
      { householdId: 'hh-1', debtId: 'debt-1', paymentAmountCents: 30000, currentDebt: debt },
      { genId: () => (callCount++ === 1 ? 'dup-op' : `unique-${callCount}`) },
    );

    await expect(uc.execute()).rejects.toThrow();

    const row = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as DebtRow;
    expect(row.outstanding_balance_cents).toBe(100000); // unchanged — rolled back
    expect(row.total_paid_cents).toBe(0);

    const opCount = (
      raw.prepare('SELECT COUNT(*) AS n FROM oplog WHERE row_id = ?').get('debt-1') as {
        n: number;
      }
    ).n;
    expect(opCount).toBe(0); // no partial op set survives

    raw.close();
  });

  // -------------------------------------------------------------------------
  // Stale-snapshot over-credit of total_paid_cents.
  //
  // Both pushed deltas used to be sized from `input.currentDebt`, the snapshot
  // the screen was holding. The balance survived that (`MAX(0, ...)` locally,
  // `greatest(0, ...)` on the server) but `total_paid_cents` is pushed with
  // `clamp: 'none'` and has no floor — so a stale snapshot credited money that
  // was never owed. The use case now re-reads the live money columns INSIDE
  // the unit of work and sizes both deltas from those.
  // -------------------------------------------------------------------------

  it('sizes both deltas from the LIVE balance when currentDebt is a stale snapshot', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const staleSnapshot = seedDebt(raw);

    // A first payment lands (a slow submit that did go through, or a pulled
    // payment from the other phone), leaving only 20000 outstanding — while
    // the screen still holds the original 100000 snapshot.
    raw
      .prepare(
        `UPDATE debts SET outstanding_balance_cents = 20000, total_paid_cents = 80000
         WHERE id = 'debt-1'`,
      )
      .run();
    raw.prepare('DELETE FROM oplog').run();

    const db = drizzle(raw);
    const result = await new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 100000, // sized off the stale 100000 balance
      currentDebt: staleSnapshot,
    }).execute();
    expect(result.success).toBe(true);

    const row = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as DebtRow;
    expect(row.outstanding_balance_cents).toBe(0);
    // 80000 already paid + the 20000 that was really owed. Before the fix the
    // local row read 180000 here (and the server would have written the same
    // from the pushed op), crediting 80000 that was never paid.
    expect(row.total_paid_cents).toBe(100000);
    expect(row.is_paid_off).toBe(1);

    const ops = raw
      .prepare('SELECT * FROM oplog WHERE row_id = ? ORDER BY rowid')
      .all('debt-1') as OplogRow[];
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.payload)).toEqual([
      '{"field":"outstanding_balance_cents","delta":-20000,"clamp":"floor_zero"}',
      '{"field":"total_paid_cents","delta":20000,"clamp":"none"}',
    ]);

    // The returned entity reports the live figures too, so the screen's
    // "paid off!" toast and the row it hands back agree with the database.
    if (result.success) {
      expect(result.data.outstandingBalanceCents).toBe(0);
      expect(result.data.totalPaidCents).toBe(100000);
      expect(result.data.isPaidOff).toBe(true);
    }

    raw.close();
  });

  it('fails cleanly and writes NO oplog rows when the debt is already at zero', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const staleSnapshot = seedDebt(raw);

    raw
      .prepare(
        `UPDATE debts SET outstanding_balance_cents = 0, total_paid_cents = 100000, is_paid_off = 1
         WHERE id = 'debt-1'`,
      )
      .run();
    raw.prepare('DELETE FROM oplog').run();

    const db = drizzle(raw);
    const result = await new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 5000,
      currentDebt: staleSnapshot,
    }).execute();

    // Result<T> contract: a clean failure, not a throw and not a silent
    // success. `LogPaymentScreen` surfaces `error.message` and undoes the
    // envelope transaction it may have created first.
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DEBT_ALREADY_PAID_OFF');

    const row = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as DebtRow;
    expect(row.outstanding_balance_cents).toBe(0);
    expect(row.total_paid_cents).toBe(100000); // NOT 105000

    const opCount = (raw.prepare('SELECT COUNT(*) AS n FROM oplog').get() as { n: number }).n;
    expect(opCount).toBe(0);

    raw.close();
  });

  it('a normal payment pushes byte-identical op payloads to before the live re-read', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const debt = seedDebt(raw);
    const db = drizzle(raw);

    const result = await new LogDebtPaymentUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      debtId: 'debt-1',
      paymentAmountCents: 30000,
      currentDebt: debt, // fresh snapshot — live row agrees with it
    }).execute();
    expect(result.success).toBe(true);

    const ops = raw
      .prepare('SELECT * FROM oplog WHERE row_id = ? ORDER BY rowid')
      .all('debt-1') as OplogRow[];
    // Exact wire bytes, in order: the re-read must not have changed what a
    // normal payment sends to the server (shipped clients parse these).
    expect(ops.map((o) => [o.op_type, o.payload])).toEqual([
      ['increment', '{"field":"outstanding_balance_cents","delta":-30000,"clamp":"floor_zero"}'],
      ['increment', '{"field":"total_paid_cents","delta":30000,"clamp":"none"}'],
    ]);

    raw.close();
  });
});

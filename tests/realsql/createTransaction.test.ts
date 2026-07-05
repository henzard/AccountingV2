import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { CreateTransactionUseCase } from '../../src/domain/transactions/CreateTransactionUseCase';
import { AuditLogger } from '../../src/data/audit/AuditLogger';
import type * as schema from '../../src/data/local/schema';

// Real-driver regression for the is_business_expense fix
// (CreateTransactionUseCase writes the boolean as 0/1 rather than a raw JS
// boolean). Mocked-repo unit tests never catch this because a fake repo
// happily accepts a JS boolean; only the REAL better-sqlite3 driver rejects it
// ("SQLite3 can only bind numbers, strings, bigints, buffers, and null"). This
// mirrors archiveEnvelope.test.ts: it runs the use case against a real migrated
// SQLite DB (like production) so it fails the way a real device does if the
// column is ever bound as a raw boolean again.

const NOW_DATE = '2026-07-01';
const HOUSEHOLD_ID = 'hh-txn-1';
const ENVELOPE_ID = 'env-txn-1';
const NOW = '2026-07-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedEnvelope(db: Database.Database): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, 'Groceries', 50000, 'spending', 0, 0, ?, ?, ?)`,
  ).run(ENVELOPE_ID, HOUSEHOLD_ID, NOW_DATE, NOW, NOW);
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

interface TxnRow {
  id: string;
  is_business_expense: number;
}

interface OplogRow {
  row_id: string;
  op_type: string;
  table_name: string;
  payload: string;
}

describe('CreateTransactionUseCase — real SQLite (is_business_expense device bug regression)', () => {
  it('creates a business-expense transaction (is_business_expense becomes 1), succeeds, and appends one insert oplog op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw);

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new CreateTransactionUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_ID,
        envelopeId: ENVELOPE_ID,
        amountCents: 1234,
        payee: 'Supplier',
        description: 'Business lunch',
        transactionDate: NOW_DATE,
        isBusinessExpense: true,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    );

    const result = await uc.execute();

    // A raw JS boolean bound to the real driver would throw and surface as a
    // failure here; the 0/1 conversion keeps this green.
    expect(result.success).toBe(true);

    const [row] = raw
      .prepare('SELECT id, is_business_expense FROM transactions WHERE id = ?')
      .all(result.success ? result.data.id : '') as TxnRow[];
    expect(row).toBeDefined();
    // Stored as an integer 1 (NOT a JS boolean) — the whole point of the fix.
    expect(row.is_business_expense).toBe(1);

    const insertOps = raw
      .prepare("SELECT * FROM oplog WHERE table_name = 'transactions' AND op_type = 'insert'")
      .all() as OplogRow[];
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].row_id).toBe(row.id);
    const payload = JSON.parse(insertOps[0].payload) as Record<string, unknown>;
    expect(payload.is_business_expense).toBe(1);

    raw.close();
  });
});

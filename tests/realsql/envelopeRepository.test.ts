import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { DrizzleEnvelopeRepository } from '../../src/data/repositories/DrizzleEnvelopeRepository';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedEnvelope(
  db: Database.Database,
  args: { id: string; householdId: string; envelopeType: string; periodStart: string },
): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, ?, 50000, ?, 0, 0, ?, ?, ?)`,
  ).run(args.id, args.householdId, args.id, args.envelopeType, args.periodStart, NOW, NOW);
}

function seedTransaction(
  db: Database.Database,
  args: { id: string; householdId: string; envelopeId: string; amountCents: number },
): void {
  db.prepare(
    `INSERT INTO transactions
       (id, household_id, envelope_id, amount_cents, transaction_date,
        is_business_expense, created_at, updated_at)
     VALUES (?, ?, ?, ?, '2026-07-05', 0, ?, ?)`,
  ).run(args.id, args.householdId, args.envelopeId, args.amountCents, NOW, NOW);
}

describe('DrizzleEnvelopeRepository (real SQLite)', () => {
  it('listByHousehold returns spentCents derived from the transaction ledger', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
    const householdId = 'hh-1';
    const periodStart = '2026-07-01';

    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-groceries', householdId, envelopeType: 'spending', periodStart });
    seedEnvelope(raw, { id: 'env-income', householdId, envelopeType: 'income', periodStart });

    seedTransaction(raw, {
      id: 'tx-1',
      householdId,
      envelopeId: 'env-groceries',
      amountCents: 1500,
    });
    seedTransaction(raw, {
      id: 'tx-2',
      householdId,
      envelopeId: 'env-groceries',
      amountCents: 2500,
    });

    const repo = new DrizzleEnvelopeRepository(db);
    const envelopes = await repo.listByHousehold(householdId, periodStart);

    const groceries = envelopes.find((e) => e.id === 'env-groceries');
    const income = envelopes.find((e) => e.id === 'env-income');

    // spentCents must equal the sum of the ledger, not a stored/stale value.
    expect(groceries?.spentCents).toBe(4000);
    expect(income?.spentCents).toBe(0);

    raw.close();
  });

  it('findById returns spentCents derived from the transaction ledger', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
    const householdId = 'hh-1';
    const periodStart = '2026-07-01';

    seedHousehold(raw, householdId);
    seedEnvelope(raw, { id: 'env-groceries', householdId, envelopeType: 'spending', periodStart });
    seedTransaction(raw, {
      id: 'tx-1',
      householdId,
      envelopeId: 'env-groceries',
      amountCents: 999,
    });

    const repo = new DrizzleEnvelopeRepository(db);
    const envelope = await repo.findById('env-groceries', householdId);

    expect(envelope?.spentCents).toBe(999);

    raw.close();
  });
});

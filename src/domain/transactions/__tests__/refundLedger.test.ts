/**
 * REFUNDS, end to end through the LEDGER — the claim the whole feature rests
 * on: a refund is just a transaction row with a negative `amount_cents`, and
 * because every balance in the app is a derived `SUM(amount_cents)` (see
 * `EnvelopeBalanceQuery`) it nets out with no schema change.
 *
 * Uses a REAL migrated better-sqlite3 db (tests/realsql/harness/openMigratedDb)
 * rather than a mocked `db`, exactly like MoveAllocationUseCase.test.ts: the
 * point of these cases is what SQLite's own `SUM` does with a negative row and
 * what the real `transactions` schema accepts, neither of which a mock could
 * prove.
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from '../../../../tests/realsql/harness/openMigratedDb';
import { CreateTransactionUseCase } from '../CreateTransactionUseCase';
import { UpdateTransactionUseCase } from '../UpdateTransactionUseCase';
import { getEnvelopeSpentCents } from '../../../data/local/balances/EnvelopeBalanceQuery';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import type { TransactionEntity } from '../TransactionEntity';
import type * as schema from '../../../data/local/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const PERIOD = '2026-01-01';
const HOUSEHOLD_ID = 'hh-1';
const ENVELOPE_ID = 'env-groceries';

function openDb(): { raw: Database.Database; db: ExpoSQLiteDatabase<typeof schema> } {
  const raw = openMigratedDb();
  const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
  return { raw, db };
}

function seedHousehold(raw: Database.Database): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 25, ?, ?)`,
    )
    .run(HOUSEHOLD_ID, NOW, NOW);
}

function seedEnvelope(raw: Database.Database, allocatedCents = 100000): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'Groceries', ?, 'spending', 0, 0, ?, ?, ?, NULL)`,
    )
    .run(ENVELOPE_ID, HOUSEHOLD_ID, allocatedCents, PERIOD, NOW, NOW);
}

async function record(
  db: ExpoSQLiteDatabase<typeof schema>,
  amountCents: number,
  payee: string,
): Promise<TransactionEntity> {
  const result = await new CreateTransactionUseCase(db, new AuditLogger(db), {
    householdId: HOUSEHOLD_ID,
    envelopeId: ENVELOPE_ID,
    amountCents,
    payee,
    description: null,
    transactionDate: PERIOD,
  }).execute();
  if (!result.success) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.data;
}

async function spentCents(db: ExpoSQLiteDatabase<typeof schema>): Promise<number> {
  const map = await getEnvelopeSpentCents(db, HOUSEHOLD_ID, PERIOD);
  return map.get(ENVELOPE_ID) ?? 0;
}

describe('refunds in the transaction ledger (real sqlite)', () => {
  it('nets a purchase and its equal refund back to exactly zero derived spend', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw);
    seedEnvelope(raw);

    await record(db, 25000, 'Checkers');
    expect(await spentCents(db)).toBe(25000);

    // The refund: same amount, opposite sign, same envelope. The original
    // purchase row is left completely untouched — that is the whole point
    // (editing or deleting it would falsify history).
    const refund = await record(db, -25000, 'Checkers refund');
    expect(refund.amountCents).toBe(-25000);

    expect(await spentCents(db)).toBe(0);

    // Both rows are still there, and the negative one really is stored
    // negative in the synced column (not abs()'d on the way in).
    const rows = raw
      .prepare('SELECT amount_cents FROM transactions WHERE envelope_id = ? ORDER BY amount_cents')
      .all(ENVELOPE_ID) as { amount_cents: number }[];
    expect(rows.map((r) => r.amount_cents)).toEqual([-25000, 25000]);
  });

  it('yields a NEGATIVE derived spend when the refund is larger than the spend, without throwing', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw);
    seedEnvelope(raw);

    await record(db, 10000, 'Checkers');
    await record(db, -30000, 'Returned the lot plus a credit note');

    // No clamp anywhere in the derived-balance path: the envelope simply
    // owes money back, and every consumer reads a signed figure.
    expect(await spentCents(db)).toBe(-20000);
  });

  it('a soft-deleted refund stops counting, restoring the pre-refund spend', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw);
    seedEnvelope(raw);

    await record(db, 25000, 'Checkers');
    const refund = await record(db, -10000, 'Partial refund');
    expect(await spentCents(db)).toBe(15000);

    raw.prepare('UPDATE transactions SET deleted_at = ? WHERE id = ?').run(NOW, refund.id);

    expect(await spentCents(db)).toBe(25000);
  });

  it('an edit that flips a purchase into a refund swings the derived spend by twice the amount', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw);
    seedEnvelope(raw);

    const purchase = await record(db, 25000, 'Checkers');
    expect(await spentCents(db)).toBe(25000);

    const updated = await new UpdateTransactionUseCase(db, new AuditLogger(db), purchase, {
      envelopeId: ENVELOPE_ID,
      amountCents: -25000,
      payee: 'Checkers refund',
      description: null,
      transactionDate: PERIOD,
    }).execute();

    expect(updated.success).toBe(true);
    expect(await spentCents(db)).toBe(-25000);
  });
});

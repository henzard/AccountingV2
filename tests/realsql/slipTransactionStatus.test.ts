import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { getConfirmedSlipIds } from '../../src/domain/slipScanning/SlipTransactionStatusQuery';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedTransaction(
  db: Database.Database,
  args: { id: string; householdId: string; slipId: string | null; deletedAt?: string | null },
): void {
  db.prepare(
    `INSERT INTO transactions
       (id, household_id, envelope_id, amount_cents, transaction_date, slip_id,
        is_business_expense, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'env-1', 1000, '2026-01-01', ?, 0, ?, ?, ?)`,
  ).run(args.id, args.householdId, args.slipId, NOW, NOW, args.deletedAt ?? null);
}

// REG-2: an extraction-only slip (status flipped to 'completed' the instant
// OpenAI succeeds — see ExtractSlipUseCase) must NOT read as "confirmed"
// until it actually has a live transaction. This query is what
// SlipQueueScreen uses to tell the two states apart.
describe('getConfirmedSlipIds (REG-2)', () => {
  let raw: Database.Database;

  beforeEach(() => {
    raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
  });

  afterEach(() => {
    raw.close();
  });

  it('returns an empty set for an empty slipIds input without querying', () => {
    const db = drizzle(raw);
    return getConfirmedSlipIds(db, 'hh-1', []).then((result) => {
      expect(result.size).toBe(0);
    });
  });

  it('excludes a slip that was extracted but never confirmed (no transaction rows)', async () => {
    const db = drizzle(raw);
    const result = await getConfirmedSlipIds(db, 'hh-1', ['slip-extracted-only']);
    expect(result.has('slip-extracted-only')).toBe(false);
  });

  it('includes a slip that has a live (non-deleted) transaction', async () => {
    seedTransaction(raw, { id: 'txn-1', householdId: 'hh-1', slipId: 'slip-confirmed' });
    const db = drizzle(raw);
    const result = await getConfirmedSlipIds(db, 'hh-1', ['slip-confirmed']);
    expect(result.has('slip-confirmed')).toBe(true);
  });

  it('excludes a slip whose only transaction was soft-deleted', async () => {
    seedTransaction(raw, {
      id: 'txn-2',
      householdId: 'hh-1',
      slipId: 'slip-deleted-txn',
      deletedAt: NOW,
    });
    const db = drizzle(raw);
    const result = await getConfirmedSlipIds(db, 'hh-1', ['slip-deleted-txn']);
    expect(result.has('slip-deleted-txn')).toBe(false);
  });

  it('batches multiple slip ids into one query and only returns the confirmed ones', async () => {
    seedTransaction(raw, { id: 'txn-3', householdId: 'hh-1', slipId: 'slip-a' });
    seedTransaction(raw, { id: 'txn-4', householdId: 'hh-1', slipId: 'slip-a' });
    seedTransaction(raw, { id: 'txn-5', householdId: 'hh-1', slipId: 'slip-b' });
    const db = drizzle(raw);
    const result = await getConfirmedSlipIds(db, 'hh-1', ['slip-a', 'slip-b', 'slip-c']);
    expect(result).toEqual(new Set(['slip-a', 'slip-b']));
  });

  it('scopes to the given household — a transaction from another household is ignored', async () => {
    seedHousehold(raw, 'hh-2');
    seedTransaction(raw, { id: 'txn-6', householdId: 'hh-2', slipId: 'slip-other-household' });
    const db = drizzle(raw);
    const result = await getConfirmedSlipIds(db, 'hh-1', ['slip-other-household']);
    expect(result.has('slip-other-household')).toBe(false);
  });
});

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openMigratedDb } from './harness/openMigratedDb';
import { SyncOrchestrator } from '../../src/data/sync/SyncOrchestrator';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * Regression coverage for the isSynced-column crash: migration 0012 dropped the
 * `is_synced` column from every entity table (envelopes, debts, etc.) — sync
 * state now lives entirely in the pending_sync outbox row, not on the entity
 * row. SyncOrchestrator.processItem used to run, after a successful remote
 * upsert:
 *
 *   await this.db.update(table).set({ isSynced: true }).where(...)
 *
 * Against a REAL post-0012 schema, drizzle's buildUpdateSet filters `isSynced`
 * out (the column no longer exists), producing an empty SET clause and an
 * invalid `UPDATE "debts" SET  WHERE ...` statement, which throws
 * SQLITE_ERROR at runtime. Every successful remote sync for a domain still
 * routed through pending_sync (debts, baby steps, meter readings, household,
 * slip, consent) would therefore be counted as failed and eventually
 * dead-lettered despite the remote write having succeeded.
 *
 * The existing SyncOrchestrator.test.ts suite hand-mocks `db.update(...)` with
 * a no-op stub (`update: () => ({ set: () => ({ where: () => Promise.resolve() }) })`),
 * so it can never observe drizzle's real column-filtering behavior. This test
 * exercises the real drizzle + better-sqlite3 stack against the actual
 * migrated schema (via the realsql `openMigratedDb` harness) so the assertion
 * is meaningful: it fails loudly if the isSynced update block ever comes back.
 */
function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedDebt(db: Database.Database, id: string, householdId: string): void {
  db.prepare(
    `INSERT INTO debts
       (id, household_id, creditor_name, debt_type, outstanding_balance_cents,
        interest_rate_percent, minimum_payment_cents, created_at, updated_at)
     VALUES (?, ?, 'Test Bank', 'credit_card', 100000, 20, 500, ?, ?)`,
  ).run(id, householdId, NOW, NOW);
}

function seedPendingSync(
  db: Database.Database,
  args: { id: string; tableName: string; recordId: string },
): void {
  db.prepare(
    `INSERT INTO pending_sync (id, table_name, record_id, operation, retry_count, created_at)
     VALUES (?, ?, ?, 'INSERT', 0, ?)`,
  ).run(args.id, args.tableName, args.recordId, NOW);
}

function makeSuccessfulSupabaseMock(): SupabaseClient {
  return {
    rpc: jest.fn().mockResolvedValue({ error: null }),
    from: () => ({ upsert: jest.fn().mockResolvedValue({ error: null }) }),
  } as unknown as SupabaseClient;
}

describe('SyncOrchestrator.syncPending against a real post-0012 migrated DB', () => {
  it('completes a successful remote upsert without throwing and removes the pending_sync row (debts)', async () => {
    const raw = openMigratedDb();
    try {
      const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;

      seedHousehold(raw, 'hh-1');
      seedDebt(raw, 'debt-1', 'hh-1');
      seedPendingSync(raw, { id: 'ps-1', tableName: 'debts', recordId: 'debt-1' });

      const supabase = makeSuccessfulSupabaseMock();
      const orch = new SyncOrchestrator(db, supabase);

      // Before the fix, this threw SQLITE_ERROR ("near WHERE: syntax error" /
      // similar) because processItem's post-upsert isSynced update produced an
      // empty SET clause against the debts table.
      const result = await orch.syncPending();

      expect(result.failed).toBe(0);
      expect(result.deadLettered).toBe(0);
      expect(result.synced).toBe(1);

      const remaining = raw.prepare('SELECT * FROM pending_sync WHERE id = ?').get('ps-1');
      expect(remaining).toBeUndefined();

      // Sanity: the debts row itself is untouched/still present and consistent.
      const debtRow = raw.prepare('SELECT * FROM debts WHERE id = ?').get('debt-1') as
        | Record<string, unknown>
        | undefined;
      expect(debtRow).toBeTruthy();
      expect(debtRow?.id).toBe('debt-1');
    } finally {
      // Close even if an assertion above throws, so a failing test doesn't
      // leak a real SQLite file handle into the rest of the run.
      raw.close();
    }
  });

  it('does not attempt to update an isSynced/is_synced column on any post-0012 entity table', async () => {
    // Belt-and-braces: directly assert that drizzle's generated UPDATE for this
    // schema never targets a nonexistent isSynced column, by spying on the
    // underlying better-sqlite3 connection's exec/prepare calls during a full
    // syncPending() run and confirming no SQL statement references is_synced.
    const raw = openMigratedDb();
    try {
      const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;

      seedHousehold(raw, 'hh-1');
      seedDebt(raw, 'debt-2', 'hh-1');
      seedPendingSync(raw, { id: 'ps-2', tableName: 'debts', recordId: 'debt-2' });

      const seenSql: string[] = [];
      const originalPrepare = raw.prepare.bind(raw);
      const prepareSpy = jest.fn((sqlText: string) => {
        seenSql.push(sqlText);
        return originalPrepare(sqlText);
      });
      raw.prepare = prepareSpy as unknown as typeof raw.prepare;

      const supabase = makeSuccessfulSupabaseMock();
      const orch = new SyncOrchestrator(db, supabase);
      await orch.syncPending();

      const badStatements = seenSql.filter((s) => /is_synced/i.test(s));
      expect(badStatements).toEqual([]);
    } finally {
      raw.close();
    }
  });
});

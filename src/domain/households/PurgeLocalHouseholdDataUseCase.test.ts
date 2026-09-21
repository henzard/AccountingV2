// src/domain/households/PurgeLocalHouseholdDataUseCase.test.ts
//
// Runs against a REAL migrated better-sqlite3 database (the same
// `openMigratedDb` harness `wipeLocalData.test.ts` and `SyncEngine.test.ts`
// use), because the whole point of this use case is that it discovers the
// household-scoped table list from the database itself and deletes across it
// in ONE transaction — both of which a mock would simply assert away.

import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from '../../../tests/realsql/harness/openMigratedDb';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import {
  PurgeLocalHouseholdDataUseCase,
  listHouseholdScopedTables,
} from './PurgeLocalHouseholdDataUseCase';

const NOW = '2026-01-01T00:00:00.000Z';

/** Every household-scoped table gets a row for BOTH households, so each
 * assertion about "hh-1 is gone" is paired with "hh-2 is untouched". */
function seedHousehold(raw: Database.Database, hh: string, suffix: string): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
       VALUES (?, ?, 25, 1, ?, ?)`,
    )
    .run(hh, `HH ${suffix}`, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at, updated_at)
       VALUES (?, ?, 'u-1', 'member', ?, ?)`,
    )
    .run(`hm-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO envelopes (id, household_id, name, allocated_cents, envelope_type, period_start, created_at, updated_at)
       VALUES (?, ?, 'Groceries', 50000, 'spending', '2026-01-01', ?, ?)`,
    )
    .run(`env-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO envelope_contributions (id, household_id, envelope_id, amount_cents, period_start, source, created_at, updated_at)
       VALUES (?, ?, ?, 1000, '2026-01-01', 'manual', ?, ?)`,
    )
    .run(`ec-${suffix}`, hh, `env-${suffix}`, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO transactions (id, household_id, envelope_id, amount_cents, transaction_date, created_at, updated_at)
       VALUES (?, ?, ?, 2500, '2026-01-02', ?, ?)`,
    )
    .run(`tx-${suffix}`, hh, `env-${suffix}`, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO debts (id, household_id, creditor_name, debt_type, outstanding_balance_cents,
                          interest_rate_percent, minimum_payment_cents, created_at, updated_at)
       VALUES (?, ?, 'Bank', 'loan', 100000, 12.5, 5000, ?, ?)`,
    )
    .run(`debt-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO meter_readings (id, household_id, meter_type, reading_value, reading_date, created_at, updated_at)
       VALUES (?, ?, 'electricity', 1234.5, '2026-01-03', ?, ?)`,
    )
    .run(`mr-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO baby_steps (id, household_id, step_number, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    )
    .run(`bs-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO slip_queue (id, household_id, created_by, image_uris, status, created_at, updated_at)
       VALUES (?, ?, 'u-1', '["a.jpg"]', 'completed', ?, ?)`,
    )
    .run(`slip-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO audit_events (id, household_id, entity_type, entity_id, action, created_at)
       VALUES (?, ?, 'envelopes', ?, 'update', ?)`,
    )
    .run(`ae-${suffix}`, hh, `env-${suffix}`, NOW);
  raw
    .prepare(
      `INSERT INTO score_history (id, household_id, period_start, score, components, created_at)
       VALUES (?, ?, '2026-01-01', 70, '{}', ?)`,
    )
    .run(`sh-${suffix}`, hh, NOW);
  raw
    .prepare(
      `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at, pushed_at)
       VALUES (?, ?, 'envelopes', ?, 'insert', '{}', 'devA', ?, ?)`,
    )
    .run(`op-${suffix}`, hh, `env-${suffix}`, NOW, NOW);
  raw.prepare(`INSERT INTO oplog_applied (op_id) VALUES (?)`).run(`op-${suffix}`);
  raw.prepare(`INSERT INTO sync_cursor (household_id, last_pulled_seq) VALUES (?, 7)`).run(hh);
}

function rowIdsFor(raw: Database.Database, table: string, hh: string): unknown[] {
  const column = table === 'sync_cursor' ? 'household_id' : table === 'oplog' ? 'op_id' : 'id';
  return raw
    .prepare(`SELECT ${column} AS k FROM ${table} WHERE household_id = ?`)
    .all(hh)
    .map((r) => (r as { k: unknown }).k);
}

/** Row counts for EVERY table, so "the other household survived" can be
 * asserted row for row rather than table by table. */
function snapshot(raw: Database.Database): Record<string, unknown[]> {
  const tables = raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as { name: string }[];
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    out[name] = raw.prepare(`SELECT * FROM ${name}`).all();
  }
  return out;
}

describe('PurgeLocalHouseholdDataUseCase (real migrated SQLite)', () => {
  let raw: Database.Database;
  let db: PortableDb;

  beforeEach(() => {
    raw = openMigratedDb();
    db = drizzle(raw) as unknown as PortableDb;
    seedHousehold(raw, 'hh-1', 'a');
    seedHousehold(raw, 'hh-2', 'b');
  });

  afterEach(() => {
    raw.close();
  });

  it('discovers exactly the household-scoped tables, and not households itself', () => {
    // The list is derived from the live schema, so a future migration that
    // adds a household-scoped table makes this fail LOUDLY rather than
    // leaving that table's rows on the phone forever.
    expect(listHouseholdScopedTables(db)).toEqual([
      'audit_events',
      'baby_steps',
      'debts',
      'envelope_contributions',
      'envelopes',
      'household_members',
      'meter_readings',
      'oplog',
      'score_history',
      'slip_queue',
      'sync_cursor',
      'transactions',
    ]);
  });

  it('ignores a table that only MENTIONS household_id without having the column', async () => {
    // e.g. a foreign key pointing at another table's household_id. Selecting it
    // would make `DELETE … WHERE household_id = ?` throw and roll back the purge.
    raw.exec(`
      CREATE TABLE mentions_only (
        id TEXT PRIMARY KEY,
        owner_ref TEXT REFERENCES sync_cursor(household_id)
      );
      INSERT INTO mentions_only (id, owner_ref) VALUES ('m1', NULL);
    `);

    expect(listHouseholdScopedTables(db)).not.toContain('mentions_only');

    const result = await new PurgeLocalHouseholdDataUseCase(db, { householdId: 'hh-1' }).execute();
    expect(result.success).toBe(true);
    expect(raw.prepare('SELECT COUNT(*) AS c FROM mentions_only').get()).toEqual({ c: 1 });
  });

  it('empties every household-scoped table for the household, including the households row', async () => {
    const result = await new PurgeLocalHouseholdDataUseCase(db, { householdId: 'hh-1' }).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.purgedTables).toEqual([...listHouseholdScopedTables(db), 'households']);

    for (const table of [
      'audit_events',
      'baby_steps',
      'debts',
      'envelope_contributions',
      'envelopes',
      'household_members',
      'meter_readings',
      'oplog',
      'score_history',
      'slip_queue',
      'sync_cursor',
      'transactions',
    ]) {
      expect(rowIdsFor(raw, table, 'hh-1')).toEqual([]);
    }
    expect(raw.prepare(`SELECT * FROM households WHERE id = 'hh-1'`).get()).toBeUndefined();
  });

  it('leaves the other household on this phone untouched, row for row', async () => {
    await new PurgeLocalHouseholdDataUseCase(db, { householdId: 'hh-1' }).execute();

    const after = snapshot(raw);
    for (const table of Object.keys(after)) {
      if (table === 'households') continue;
      if (table === 'oplog_applied' || table === '__app_migrations') continue;
      const stray = (after[table] as Record<string, unknown>[]).filter(
        (row) => 'household_id' in row && row.household_id !== 'hh-2',
      );
      expect({ table, stray }).toEqual({ table, stray: [] });
    }
    expect(raw.prepare(`SELECT name FROM households`).all()).toEqual([{ name: 'HH b' }]);
    expect(rowIdsFor(raw, 'transactions', 'hh-2')).toEqual(['tx-b']);
    expect(rowIdsFor(raw, 'envelopes', 'hh-2')).toEqual(['env-b']);
    expect(rowIdsFor(raw, 'oplog', 'hh-2')).toEqual(['op-b']);
    expect(rowIdsFor(raw, 'sync_cursor', 'hh-2')).toEqual(['hh-2']);
  });

  it('leaves oplog_applied alone — it is op-id keyed and guards against double-applied increments', async () => {
    await new PurgeLocalHouseholdDataUseCase(db, { householdId: 'hh-1' }).execute();

    expect(raw.prepare(`SELECT op_id FROM oplog_applied ORDER BY op_id`).all()).toEqual([
      { op_id: 'op-a' },
      { op_id: 'op-b' },
    ]);
  });

  it('deletes the household’s slip image directories from disk, after the rows are gone', async () => {
    const seen: string[] = [];
    const slipImages = {
      delete: jest.fn(async (slipId: string) => {
        // The rows must already be gone by the time the files go: a rolled
        // back purge must never have destroyed an image it still has a row for.
        seen.push(slipId);
        expect(raw.prepare(`SELECT id FROM slip_queue WHERE id = ?`).get(slipId)).toBeUndefined();
      }),
    };

    const result = await new PurgeLocalHouseholdDataUseCase(
      db,
      { householdId: 'hh-1' },
      { slipImages },
    ).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.slipImageDirsDeleted).toBe(1);
    expect(seen).toEqual(['slip-a']);
    // Never the other household's images.
    expect(slipImages.delete).not.toHaveBeenCalledWith('slip-b');
  });

  it('still reports success when a slip image file cannot be removed', async () => {
    const slipImages = { delete: jest.fn().mockRejectedValue(new Error('ENOENT')) };

    const result = await new PurgeLocalHouseholdDataUseCase(
      db,
      { householdId: 'hh-1' },
      { slipImages },
    ).execute();

    // The rows are already gone; an orphaned directory must not be reported
    // as a failed purge the user is asked to retry.
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.slipImageDirsDeleted).toBe(0);
  });

  it('is atomic — a failure part-way through leaves EVERY row in place', async () => {
    // `debts` is the third table in alphabetical order, so audit_events and
    // baby_steps have already been deleted inside the transaction when this
    // trigger aborts it.
    raw.exec(
      `CREATE TRIGGER purge_boom BEFORE DELETE ON debts BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
    const before = snapshot(raw);

    const result = await new PurgeLocalHouseholdDataUseCase(db, { householdId: 'hh-1' }).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('PURGE_FAILED');
    expect(snapshot(raw)).toEqual(before);
  });

  it('does not delete the slip images when the transaction rolled back', async () => {
    raw.exec(
      `CREATE TRIGGER purge_boom BEFORE DELETE ON debts BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
    const slipImages = { delete: jest.fn().mockResolvedValue(undefined) };

    const result = await new PurgeLocalHouseholdDataUseCase(
      db,
      { householdId: 'hh-1' },
      { slipImages },
    ).execute();

    expect(result.success).toBe(false);
    expect(slipImages.delete).not.toHaveBeenCalled();
  });

  it('is a no-op that still succeeds for a household this phone does not hold', async () => {
    const before = snapshot(raw);

    const result = await new PurgeLocalHouseholdDataUseCase(db, {
      householdId: 'hh-nowhere',
    }).execute();

    expect(result.success).toBe(true);
    expect(snapshot(raw)).toEqual(before);
  });
});

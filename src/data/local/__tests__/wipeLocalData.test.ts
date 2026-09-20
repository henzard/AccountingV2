// src/data/local/__tests__/wipeLocalData.test.ts
//
// Runs against a REAL migrated better-sqlite3 database (the same
// `openMigratedDb` harness SyncEngine.test.ts uses), because the whole point
// of `wipeLocalData` is that it discovers the table list from the database
// itself — asserting it against a hand-written list of mocks would test
// nothing.

import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from '../../../../tests/realsql/harness/openMigratedDb';
import type { PortableDb } from '../../uow/UnitOfWork';
import { wipeLocalData, listWipeableTables, WIPE_EXCLUDED_TABLES } from '../wipeLocalData';

const NOW = '2026-01-01T00:00:00.000Z';

function seed(raw: Database.Database): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES ('hh-1', 'Test HH', 25, ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at, updated_at)
       VALUES ('hm-1', 'hh-1', 'u-1', 'owner', ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO envelopes (id, household_id, name, allocated_cents, envelope_type, period_start, created_at, updated_at)
       VALUES ('env-1', 'hh-1', 'Groceries', 50000, 'spending', '2026-01-01', ?, ?)`,
    )
    .run(NOW, NOW);
  raw
    .prepare(
      `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
       VALUES ('op-1', 'hh-1', 'envelopes', 'env-1', 'insert', '{}', 'devA', ?)`,
    )
    .run(NOW);
  raw.prepare(`INSERT INTO sync_cursor (household_id, last_pulled_seq) VALUES ('hh-1', 7)`).run();
  raw
    .prepare(
      `INSERT INTO __app_migrations (name, applied_at, checksum) VALUES ('0000_icy_stellaris', ?, 'abcd1234')`,
    )
    .run(NOW);
}

function openSeeded(): { raw: Database.Database; db: PortableDb } {
  const raw = openMigratedDb();
  raw.exec(
    'CREATE TABLE IF NOT EXISTS `__app_migrations` (`name` TEXT PRIMARY KEY NOT NULL, `applied_at` TEXT NOT NULL, `checksum` TEXT NOT NULL)',
  );
  seed(raw);
  return { raw, db: drizzle(raw) as unknown as PortableDb };
}

function countRows(raw: Database.Database, table: string): number {
  return (raw.prepare(`SELECT COUNT(*) AS c FROM \`${table}\``).get() as { c: number }).c;
}

describe('wipeLocalData', () => {
  it('clears every user-data table', () => {
    const { raw, db } = openSeeded();
    expect(countRows(raw, 'households')).toBe(1);

    wipeLocalData(db);

    for (const table of listWipeableTables(db)) {
      expect({ table, rows: countRows(raw, table) }).toEqual({ table, rows: 0 });
    }
    raw.close();
  });

  it('clears the sync machinery too — a stale cursor would break the next account', () => {
    const { raw, db } = openSeeded();
    expect(countRows(raw, 'sync_cursor')).toBe(1);
    expect(countRows(raw, 'oplog')).toBe(1);

    wipeLocalData(db);

    expect(countRows(raw, 'sync_cursor')).toBe(0);
    expect(countRows(raw, 'oplog')).toBe(0);
    raw.close();
  });

  it('leaves the migration ledger intact so the next launch still boots', () => {
    const { raw, db } = openSeeded();

    wipeLocalData(db);

    expect(countRows(raw, '__app_migrations')).toBe(1);
    expect(WIPE_EXCLUDED_TABLES).toContain('__app_migrations');
    raw.close();
  });

  it('drops no tables — the schema survives', () => {
    const { raw, db } = openSeeded();
    const before = listWipeableTables(db);

    wipeLocalData(db);

    expect(listWipeableTables(db)).toEqual(before);
    expect(before).toEqual(expect.arrayContaining(['households', 'transactions', 'oplog']));
    raw.close();
  });

  it('is idempotent — a second wipe is a harmless no-op', () => {
    const { raw, db } = openSeeded();

    const first = wipeLocalData(db);
    const second = wipeLocalData(db);

    expect(second).toEqual(first);
    expect(countRows(raw, 'households')).toBe(0);
    raw.close();
  });

  it('discovers tables from the database rather than a hard-coded list', () => {
    const { raw, db } = openSeeded();
    raw.exec('CREATE TABLE `future_feature` (`id` TEXT PRIMARY KEY NOT NULL)');
    raw.prepare("INSERT INTO `future_feature` (id) VALUES ('x')").run();

    wipeLocalData(db);

    expect(countRows(raw, 'future_feature')).toBe(0);
    raw.close();
  });
});

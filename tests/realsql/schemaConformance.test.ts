import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../../src/data/local/schema';
import { openMigratedDb } from './harness/openMigratedDb';

const tables = Object.values(schema as Record<string, unknown>).filter((v): v is SQLiteTable =>
  is(v, SQLiteTable),
);

describe('Drizzle schema conformance (real SQLite)', () => {
  it('finds at least one exported Drizzle table', () => {
    expect(tables.length).toBeGreaterThanOrEqual(10);
  });

  it('every Drizzle table and column exists in the fully-migrated database', () => {
    const db = openMigratedDb();
    for (const table of tables) {
      const cfg = getTableConfig(table);
      const info = db.prepare(`PRAGMA table_info(${cfg.name})`).all() as { name: string }[];
      expect({ table: cfg.name, exists: info.length > 0 }).toEqual({
        table: cfg.name,
        exists: true,
      });
      const dbColumns = info.map((c) => c.name);
      for (const column of cfg.columns) {
        expect({
          table: cfg.name,
          column: column.name,
          present: dbColumns.includes(column.name),
        }).toEqual({
          table: cfg.name,
          column: column.name,
          present: true,
        });
      }
    }
    db.close();
  });
});

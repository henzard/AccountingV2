import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql, type SQL } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { runInUnitOfWork } from '../../src/data/uow/UnitOfWork';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function insertEnvelopeSql(id: string, householdId: string): SQL {
  return sql`INSERT INTO envelopes (id, household_id, name, envelope_type, period_start, created_at, updated_at)
    VALUES (${id}, ${householdId}, 'Groceries', 'spending', '2026-01-01', ${NOW}, ${NOW})`;
}

describe('runInUnitOfWork (real SQLite)', () => {
  it('commits the entity write and the appended oplog row in one transaction', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    runInUnitOfWork(db, (uow) => {
      uow.db.run(insertEnvelopeSql('env-1', 'hh-1'));
      uow.appendOp({
        opId: 'op-1',
        householdId: 'hh-1',
        tableName: 'envelopes',
        rowId: 'env-1',
        opType: 'insert',
        payload: { name: 'Groceries' },
        actorUserId: 'user-1',
        deviceId: 'device-1',
        clientCreatedAt: NOW,
      });
    });

    const envelope = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-1');
    const op = raw.prepare('SELECT * FROM oplog WHERE op_id = ?').get('op-1') as
      | Record<string, unknown>
      | undefined;

    expect(envelope).toBeTruthy();
    expect(op).toBeTruthy();
    expect(op?.op_type).toBe('insert');
    expect(op?.payload).toBe('{"name":"Groceries"}');
    expect(op?.pushed_at).toBeNull();

    raw.close();
  });

  it('rolls back both the entity write and the oplog append when fn throws', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    expect(() => {
      runInUnitOfWork(db, (uow) => {
        uow.db.run(insertEnvelopeSql('env-2', 'hh-1'));
        uow.appendOp({
          opId: 'op-2',
          householdId: 'hh-1',
          tableName: 'envelopes',
          rowId: 'env-2',
          opType: 'insert',
          payload: { name: 'Groceries' },
          actorUserId: 'user-1',
          deviceId: 'device-1',
          clientCreatedAt: NOW,
        });
        throw new Error('boom');
      });
    }).toThrow('boom');

    const envelope = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-2');
    const op = raw.prepare('SELECT * FROM oplog WHERE op_id = ?').get('op-2');

    expect(envelope).toBeUndefined();
    expect(op).toBeUndefined();

    raw.close();
  });
});

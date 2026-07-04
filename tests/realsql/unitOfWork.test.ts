import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql, type SQL } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { runInUnitOfWork, onOplogWrite } from '../../src/data/uow/UnitOfWork';

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

  // ---------------------------------------------------------------------
  // onOplogWrite — the after-write sync trigger's source (slice-5 Task 4).
  // SyncScheduler.test.ts (app tier) covers the debounced-requestSync
  // consumer side; these prove the PRODUCER side is R6-safe: notify only
  // after a real commit, never on rollback.
  // ---------------------------------------------------------------------
  describe('onOplogWrite (after-write trigger source)', () => {
    it('notifies listeners with the household id AFTER a successful commit', () => {
      const raw = openMigratedDb();
      seedHousehold(raw, 'hh-1');
      const db = drizzle(raw);
      const notified: string[] = [];
      const unsubscribe = onOplogWrite((hh) => notified.push(hh));

      try {
        runInUnitOfWork(db, (uow) => {
          uow.db.run(insertEnvelopeSql('env-3', 'hh-1'));
          uow.appendOp({
            opId: 'op-3',
            householdId: 'hh-1',
            tableName: 'envelopes',
            rowId: 'env-3',
            opType: 'insert',
            payload: { name: 'Groceries' },
            actorUserId: 'user-1',
            deviceId: 'device-1',
            clientCreatedAt: NOW,
          });
          // Not yet notified — the transaction hasn't committed while fn is running.
          expect(notified).toEqual([]);
        });

        expect(notified).toEqual(['hh-1']);
      } finally {
        unsubscribe();
        raw.close();
      }
    });

    it('does NOT notify when the transaction rolls back (fn throws)', () => {
      const raw = openMigratedDb();
      seedHousehold(raw, 'hh-1');
      const db = drizzle(raw);
      const notified: string[] = [];
      const unsubscribe = onOplogWrite((hh) => notified.push(hh));

      try {
        expect(() => {
          runInUnitOfWork(db, (uow) => {
            uow.appendOp({
              opId: 'op-4',
              householdId: 'hh-1',
              tableName: 'envelopes',
              rowId: 'env-4',
              opType: 'insert',
              payload: {},
              actorUserId: 'user-1',
              deviceId: 'device-1',
              clientCreatedAt: NOW,
            });
            throw new Error('boom');
          });
        }).toThrow('boom');

        expect(notified).toEqual([]);
      } finally {
        unsubscribe();
        raw.close();
      }
    });

    it('notifies once per distinct household even with multiple appendOp calls for the same household', () => {
      const raw = openMigratedDb();
      seedHousehold(raw, 'hh-1');
      const db = drizzle(raw);
      const notified: string[] = [];
      const unsubscribe = onOplogWrite((hh) => notified.push(hh));

      try {
        runInUnitOfWork(db, (uow) => {
          uow.db.run(insertEnvelopeSql('env-5', 'hh-1'));
          uow.appendOp({
            opId: 'op-5a',
            householdId: 'hh-1',
            tableName: 'envelopes',
            rowId: 'env-5',
            opType: 'insert',
            payload: { name: 'Groceries' },
            actorUserId: 'user-1',
            deviceId: 'device-1',
            clientCreatedAt: NOW,
          });
          uow.appendOp({
            opId: 'op-5b',
            householdId: 'hh-1',
            tableName: 'envelopes',
            rowId: 'env-5',
            opType: 'update',
            payload: { name: 'Groceries 2' },
            actorUserId: 'user-1',
            deviceId: 'device-1',
            clientCreatedAt: NOW,
          });
        });

        expect(notified).toEqual(['hh-1']);
      } finally {
        unsubscribe();
        raw.close();
      }
    });

    it('an unsubscribed listener stops receiving notifications', () => {
      const raw = openMigratedDb();
      seedHousehold(raw, 'hh-1');
      const db = drizzle(raw);
      const notified: string[] = [];
      const unsubscribe = onOplogWrite((hh) => notified.push(hh));
      unsubscribe();

      runInUnitOfWork(db, (uow) => {
        uow.db.run(insertEnvelopeSql('env-6', 'hh-1'));
        uow.appendOp({
          opId: 'op-6',
          householdId: 'hh-1',
          tableName: 'envelopes',
          rowId: 'env-6',
          opType: 'insert',
          payload: { name: 'Groceries' },
          actorUserId: 'user-1',
          deviceId: 'device-1',
          clientCreatedAt: NOW,
        });
      });

      expect(notified).toEqual([]);
      raw.close();
    });

    it('a listener that throws is caught — never breaks the write it is notifying about', () => {
      const raw = openMigratedDb();
      seedHousehold(raw, 'hh-1');
      const db = drizzle(raw);
      const unsubscribe = onOplogWrite(() => {
        throw new Error('listener exploded');
      });

      try {
        expect(() => {
          runInUnitOfWork(db, (uow) => {
            uow.db.run(insertEnvelopeSql('env-7', 'hh-1'));
            uow.appendOp({
              opId: 'op-7',
              householdId: 'hh-1',
              tableName: 'envelopes',
              rowId: 'env-7',
              opType: 'insert',
              payload: { name: 'Groceries' },
              actorUserId: 'user-1',
              deviceId: 'device-1',
              clientCreatedAt: NOW,
            });
          });
        }).not.toThrow();

        const envelope = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-7');
        expect(envelope).toBeTruthy();
      } finally {
        unsubscribe();
        raw.close();
      }
    });
  });
});

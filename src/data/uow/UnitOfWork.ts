import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * The minimal Drizzle database shape the UnitOfWork needs. Both the
 * production `ExpoSQLiteDatabase` (drizzle-orm/expo-sqlite) and the
 * `BetterSQLite3Database` used in the realsql test tier
 * (drizzle-orm/better-sqlite3) extend this same 'sync'-mode base class, so
 * `runInUnitOfWork` works unchanged against either engine — matching the
 * portable-db pattern established in EnvelopeBalanceQuery.
 */
export type PortableDb = BaseSQLiteDatabase<'sync', unknown, Record<string, unknown>>;

export type OplogOpType = 'insert' | 'update' | 'delete' | 'increment';

/** One local oplog row to append. `payload` is JSON-stringified by appendOp. */
export interface AppendOpInput {
  opId: string;
  householdId: string | null;
  tableName: string;
  rowId: string;
  opType: OplogOpType;
  payload: unknown;
  actorUserId: string | null;
  deviceId: string;
  clientCreatedAt: string;
}

/** Handed to the callback passed to `runInUnitOfWork`. */
export interface UnitOfWork {
  /** The transactional database handle — entity writes must go through this, not the outer `db`. */
  db: PortableDb;
  /** Appends exactly one local oplog row, in the same transaction as `db`'s writes. */
  appendOp(input: AppendOpInput): void;
}

/**
 * Runs `fn` inside one SQLite transaction (`db.transaction`), giving it a
 * `UnitOfWork` whose `appendOp` helper inserts a local oplog row. Any throw
 * inside `fn` rolls back both the entity writes made via `uow.db` and any
 * oplog rows appended via `uow.appendOp` — they are the same transaction.
 */
export function runInUnitOfWork<T>(db: PortableDb, fn: (uow: UnitOfWork) => T): T {
  return db.transaction((tx) => {
    const uow: UnitOfWork = {
      db: tx,
      appendOp(input: AppendOpInput): void {
        tx.run(sql`
          INSERT INTO oplog (
            op_id, household_id, table_name, row_id, op_type, payload,
            actor_user_id, device_id, client_created_at, pushed_at
          ) VALUES (
            ${input.opId}, ${input.householdId}, ${input.tableName}, ${input.rowId},
            ${input.opType}, ${JSON.stringify(input.payload)},
            ${input.actorUserId}, ${input.deviceId}, ${input.clientCreatedAt}, NULL
          )
        `);
      },
    };
    return fn(uow);
  });
}

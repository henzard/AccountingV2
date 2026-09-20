import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { logger } from '../../infrastructure/logging/Logger';

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

// ---------------------------------------------------------------------------
// After-write sync trigger (slice-5 Task 4, spec §4).
//
// Every entity write in this app funnels through `runInUnitOfWork` (directly,
// or via `createSyncedRepo`) — it is the single choke point for "a local
// oplog op was just committed". Rather than have every domain use case
// remember to call a `requestSync()` after writing (easy to forget, and it
// would touch dozens of call sites), `runInUnitOfWork` itself notifies a
// small listener registry once the SQLite transaction has actually committed
// (i.e. AFTER `db.transaction(...)` returns without throwing — a rollback
// never reaches the notify call, so a failed write never triggers a sync).
// `SyncScheduler` (src/data/sync/SyncScheduler.ts) is the only production
// listener: it debounces this into one `sync(householdId)` call per burst of
// writes (~300-500ms). This keeps SyncEngine's push()/pull()/sync() core
// (Task 3) completely unaware of triggers — the wiring lives here + in
// SyncScheduler, not in the engine.
// ---------------------------------------------------------------------------

export type OplogWriteListener = (householdId: string) => void;

const oplogWriteListeners = new Set<OplogWriteListener>();

/** Registers a listener notified once per committed `runInUnitOfWork` call
 * that appended at least one op for a given household (deduped per call, so
 * a batch touching one household notifies once even with several `appendOp`s).
 * Returns an unsubscribe function. */
export function onOplogWrite(listener: OplogWriteListener): () => void {
  oplogWriteListeners.add(listener);
  return () => {
    oplogWriteListeners.delete(listener);
  };
}

/**
 * Appends one local oplog row (and, for an `increment`, its `oplog_applied`
 * guard) to an ALREADY-OPEN transaction.
 *
 * Exported so code that legitimately writes outside `runInUnitOfWork`'s own
 * transaction — the puller's emergency-fund demotion, which must be atomic
 * with the batch it is applying — appends ops through the SAME statement as
 * every domain write, instead of duplicating the INSERT. Prefer
 * `runInUnitOfWork`; reach for this only when you already hold the
 * transaction.
 */
export function appendOplogRowWithin(tx: PortableDb, input: AppendOpInput): void {
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
  // Own-increment guard (SYNC-1), belt-and-braces. An `increment` is
  // commutative but NOT idempotent and is folded into local state by the
  // entity write this op accompanies, so the puller must never re-apply this
  // device's own increment when it comes back down the oplog. The puller's
  // primary defence is the receiver ledger `oplog_applied` (R5) — recording
  // the op here, in the SAME transaction as the write, makes the skip a fact
  // about THIS op rather than a device-id comparison that silently breaks if
  // the writer's device id and the engine's ever diverge. Only `increment`
  // needs it: `insert`/`update`/`delete` are deliberately re-applied in
  // server-seq order to converge (see SyncEngine.applyPulledBatch).
  if (input.opType === 'increment') {
    tx.run(sql`INSERT OR IGNORE INTO oplog_applied (op_id) VALUES (${input.opId})`);
  }
}

/** Notifies the `onOplogWrite` listeners for `householdId`. Exported for the
 * same reason as `appendOplogRowWithin`: a committed op written outside
 * `runInUnitOfWork` should still wake the after-write sync trigger so it is
 * pushed promptly rather than waiting for an unrelated trigger. */
export function notifyOplogWrite(householdId: string): void {
  for (const listener of oplogWriteListeners) {
    try {
      listener(householdId);
    } catch (err) {
      logger.warn('notifyOplogWrite: onOplogWrite listener threw', {
        householdId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Runs `fn` inside one SQLite transaction (`db.transaction`), giving it a
 * `UnitOfWork` whose `appendOp` helper inserts a local oplog row. Any throw
 * inside `fn` rolls back both the entity writes made via `uow.db` and any
 * oplog rows appended via `uow.appendOp` — they are the same transaction.
 *
 * After a successful commit, notifies `onOplogWrite` listeners once per
 * distinct `householdId` that had an op appended during this call (the
 * after-write sync trigger — see the block comment above). A throw inside
 * `fn` propagates out of `db.transaction` before this notification runs, so
 * a rolled-back write never fires a spurious sync trigger.
 */
export function runInUnitOfWork<T>(db: PortableDb, fn: (uow: UnitOfWork) => T): T {
  const writtenHouseholdIds = new Set<string>();

  const result = db.transaction((tx) => {
    const uow: UnitOfWork = {
      db: tx,
      appendOp(input: AppendOpInput): void {
        appendOplogRowWithin(tx, input);
        if (input.householdId) writtenHouseholdIds.add(input.householdId);
      },
    };
    return fn(uow);
  });

  // Only reached on a successful commit (a throw above propagates past this).
  // A listener (SyncScheduler) must never break the caller's write, so
  // `notifyOplogWrite` logs and swallows anything a listener throws — this is
  // best-effort trigger plumbing, not part of the write itself.
  for (const householdId of writtenHouseholdIds) {
    notifyOplogWrite(householdId);
  }

  return result;
}

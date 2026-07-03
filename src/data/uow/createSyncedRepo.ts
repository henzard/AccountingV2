import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { runInUnitOfWork, type PortableDb } from './UnitOfWork';

/** Clamp applied to an `increment` write's arithmetic. */
export type IncrementClamp = 'none' | 'floor_zero';

/**
 * Per-call context threaded through every synced-repo write. Carries the
 * things a repository must never read directly from ambient globals
 * (device id, actor, "now") so writes stay deterministic and testable.
 * `genId` defaults to uuid v4 when omitted.
 */
export interface SyncedRepoCtx {
  deviceId: string;
  actorUserId: string | null;
  /** Returns the current time as an ISO-8601 string. */
  clock: () => string;
  /** Generates the oplog `op_id`. Defaults to uuid v4. */
  genId?: () => string;
}

export interface SyncedRepo {
  /** Inserts `row` (already snake_case, matching DB columns) and appends one `insert` op. */
  insert(row: Record<string, unknown>, ctx: SyncedRepoCtx): void;
  /** Updates `fields` (snake_case) on the row and appends one `update` op with those fields as payload. */
  update(
    id: string,
    householdId: string,
    fields: Record<string, unknown>,
    ctx: SyncedRepoCtx,
  ): void;
  /** Sets `deleted_at` to `ctx.clock()` and appends one `delete` op. */
  softDelete(id: string, householdId: string, ctx: SyncedRepoCtx): void;
  /** Applies `field += delta` (optionally clamped) and appends one `increment` op. */
  increment(
    id: string,
    householdId: string,
    field: string,
    delta: number,
    clamp: IncrementClamp,
    ctx: SyncedRepoCtx,
  ): void;
}

export interface CreateSyncedRepoConfig {
  /** The physical table name — used both for the entity write and the oplog `table_name` column. */
  tableName: string;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/** Column/table names here are internal callers' literal strings, never end-user input — this guards against typos, not attackers. */
function assertSafeIdent(name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`createSyncedRepo: unsafe identifier "${name}"`);
  }
}

function resolveOpId(ctx: SyncedRepoCtx): string {
  return ctx.genId ? ctx.genId() : uuidv4();
}

function buildAssignments(fields: Record<string, unknown>): SQL {
  const columns = Object.keys(fields);
  columns.forEach(assertSafeIdent);
  const assignments = columns.map((column) => sql`${sql.raw(column)} = ${fields[column]}`);
  return sql.join(assignments, sql.raw(', '));
}

/**
 * Derives a small write-only repository over `tableName`: every write
 * performs the entity write AND appends exactly one matching local `oplog`
 * row, in ONE `db.transaction` (via `runInUnitOfWork`). This replaces the
 * old write-then-separately-enqueue `PendingSyncEnqueuer` pattern — the op
 * cannot be forgotten because it is part of the same call.
 *
 * Rows/fields are plain objects keyed by DB column name (snake_case) — no
 * camelCase<->snake_case conversion happens here; payloads are written
 * snake_case once at this boundary, per the oplog design (§2).
 */
export function createSyncedRepo(db: PortableDb, config: CreateSyncedRepoConfig): SyncedRepo {
  const { tableName } = config;
  assertSafeIdent(tableName);

  return {
    insert(row, ctx) {
      const rowId = row.id;
      const householdId = row.household_id;
      if (typeof rowId !== 'string' || typeof householdId !== 'string') {
        throw new Error('createSyncedRepo.insert: row.id and row.household_id must be strings');
      }

      runInUnitOfWork(db, (uow) => {
        const columns = Object.keys(row);
        columns.forEach(assertSafeIdent);
        const columnList = sql.raw(columns.join(', '));
        const values = sql.join(
          columns.map((column) => sql`${row[column]}`),
          sql.raw(', '),
        );
        uow.db.run(sql`INSERT INTO ${sql.raw(tableName)} (${columnList}) VALUES (${values})`);

        uow.appendOp({
          opId: resolveOpId(ctx),
          householdId,
          tableName,
          rowId,
          opType: 'insert',
          payload: row,
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: ctx.clock(),
        });
      });
    },

    update(id, householdId, fields, ctx) {
      runInUnitOfWork(db, (uow) => {
        uow.db.run(
          sql`UPDATE ${sql.raw(tableName)} SET ${buildAssignments(fields)} WHERE id = ${id} AND household_id = ${householdId}`,
        );

        uow.appendOp({
          opId: resolveOpId(ctx),
          householdId,
          tableName,
          rowId: id,
          opType: 'update',
          payload: fields,
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: ctx.clock(),
        });
      });
    },

    softDelete(id, householdId, ctx) {
      runInUnitOfWork(db, (uow) => {
        const deletedAt = ctx.clock();
        uow.db.run(
          sql`UPDATE ${sql.raw(tableName)} SET deleted_at = ${deletedAt} WHERE id = ${id} AND household_id = ${householdId}`,
        );

        uow.appendOp({
          opId: resolveOpId(ctx),
          householdId,
          tableName,
          rowId: id,
          opType: 'delete',
          payload: { deleted_at: deletedAt },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: deletedAt,
        });
      });
    },

    increment(id, householdId, field, delta, clamp, ctx) {
      assertSafeIdent(field);
      runInUnitOfWork(db, (uow) => {
        const expression =
          clamp === 'floor_zero'
            ? sql`MAX(0, ${sql.raw(field)} + ${delta})`
            : sql`${sql.raw(field)} + ${delta}`;
        uow.db.run(
          sql`UPDATE ${sql.raw(tableName)} SET ${sql.raw(field)} = ${expression} WHERE id = ${id} AND household_id = ${householdId}`,
        );

        uow.appendOp({
          opId: resolveOpId(ctx),
          householdId,
          tableName,
          rowId: id,
          opType: 'increment',
          payload: { field, delta, clamp },
          actorUserId: ctx.actorUserId,
          deviceId: ctx.deviceId,
          clientCreatedAt: ctx.clock(),
        });
      });
    },
  };
}

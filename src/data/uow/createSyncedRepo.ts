import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';
import { runInUnitOfWork, type PortableDb, type UnitOfWork } from './UnitOfWork';

/** Clamp applied to an `increment` write's arithmetic. */
export type IncrementClamp = 'none' | 'floor_zero';

/**
 * Per-call context threaded through every synced-repo write. Carries the
 * things a repository must never read directly from ambient globals
 * (device id, actor, "now") so writes stay deterministic and testable.
 * `genId` defaults to `expo-crypto`'s `randomUUID()` (a v4 UUID) when
 * omitted.
 */
export interface SyncedRepoCtx {
  deviceId: string;
  actorUserId: string | null;
  /** Returns the current time as an ISO-8601 string. */
  clock: () => string;
  /** Generates the oplog `op_id`. Defaults to `expo-crypto`'s `randomUUID()`. */
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

/**
 * Columns no `update`/`increment` caller may ever target, mirroring the
 * server-side `forbidden_column` allowlist (see oplog RPC contract). The
 * WHERE clause on every write already scopes by the row's ORIGINAL
 * `id`/`household_id`, but nothing stopped a caller from also putting
 * `household_id` (or `id`, or `created_at`) into `fields`/`field` — which
 * would silently move the matched row to a different household or falsify
 * its identity/creation time while still matching the WHERE. This is
 * defense-in-depth: no current call site does this, but a future/careless
 * one could.
 */
const FORBIDDEN_COLUMNS = new Set(['id', 'household_id', 'created_at']);

function assertNotForbiddenColumn(column: string): void {
  if (FORBIDDEN_COLUMNS.has(column)) {
    throw new Error(
      `createSyncedRepo: "${column}" is a forbidden column for update/increment — id, household_id, and created_at are immutable through this path`,
    );
  }
}

function resolveOpId(ctx: SyncedRepoCtx): string {
  return ctx.genId ? ctx.genId() : randomUUID();
}

function buildAssignments(fields: Record<string, unknown>): SQL {
  const columns = Object.keys(fields);
  if (columns.length === 0) {
    throw new Error('createSyncedRepo.update: requires at least one field');
  }
  columns.forEach(assertSafeIdent);
  columns.forEach(assertNotForbiddenColumn);
  const assignments = columns.map((column) => sql`${sql.raw(column)} = ${fields[column]}`);
  return sql.join(assignments, sql.raw(', '));
}

/**
 * Extracts the affected-row count from a `db.run()` result in a way that
 * works across both `PortableDb` engines: better-sqlite3's `RunResult`
 * (`{changes, lastInsertRowid}`) and expo-sqlite's `SQLiteRunResult`
 * (`{changes, lastInsertRowId}`) both expose a numeric `changes` field, even
 * though `PortableDb`'s `TRunResult` generic is `unknown` — so this is a
 * runtime type-guard rather than a driver-specific cast.
 */
function extractChanges(result: unknown): number {
  if (
    typeof result === 'object' &&
    result !== null &&
    'changes' in result &&
    typeof (result as { changes: unknown }).changes === 'number'
  ) {
    return (result as { changes: number }).changes;
  }
  throw new Error(
    'createSyncedRepo: could not read an affected-row "changes" count from db.run() result',
  );
}

/**
 * Matches the message `assertRowMatched` throws below. Exported so callers
 * (e.g. `UpdateEnvelopeUseCase`) can distinguish "the row didn't exist /
 * didn't match" from any other failure (DB error, constraint violation,
 * etc.) without treating every exception from a synced-repo write as
 * not-found.
 */
const ROW_NOT_MATCHED_RE = /^createSyncedRepo: no row in ".+" matched id=.+ household_id=.+/;

/** True if `err` is the zero-rows-affected error a synced-repo write throws — see `ROW_NOT_MATCHED_RE`. */
export function isRowNotMatchedError(err: unknown): boolean {
  return err instanceof Error && ROW_NOT_MATCHED_RE.test(err.message);
}

/**
 * Matches the message both local SQLite engines raise for a UNIQUE
 * constraint violation: better-sqlite3 throws a `SqliteError` (code
 * `SQLITE_CONSTRAINT_UNIQUE`) and expo-sqlite throws an error wrapping the
 * same underlying SQLite engine message — both read
 * `UNIQUE constraint failed: <table>.<column>[, ...]`. Matching on message
 * text rather than requiring a specific error class keeps this working
 * across both drivers without importing either as a type-only dependency.
 */
const UNIQUE_CONSTRAINT_RE = /UNIQUE constraint failed/;

/**
 * True if `err` is a UNIQUE constraint violation from an `insert` — the
 * signal a caller can use to translate a DB-level race loss (e.g. two
 * overlapping `execute()` calls both passing an application-level
 * pre-check) into a clean domain failure instead of an unhandled throw. See
 * `CreateEnvelopeUseCase`'s emergency_fund duplicate guard for the intended
 * use: the partial unique index in `0013_emf_unique.sql` is the actual
 * guarantee, the pre-check is only a fast-path UX improvement.
 *
 * Drizzle wraps the driver-thrown error (better-sqlite3's `SqliteError`,
 * message-compatible with expo-sqlite's) in its own `DrizzleQueryError`,
 * whose `.message` is a generic "Failed to run the query ..." — the actual
 * `UNIQUE constraint failed: ...` text is on `.cause`. This walks a short
 * `.cause` chain so it matches either the raw driver error or Drizzle's
 * wrapper around it.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  // Walk the `.cause` chain by DUCK-TYPING, not `instanceof Error`. drizzle
  // wraps the driver error as `DrizzleError { cause: SqliteError }`, and under
  // Jest's sandboxed module realms `SqliteError instanceof Error` can be false
  // (the better-sqlite3 error's prototype resolves to a different realm's
  // Error than the one in scope here) — which previously stopped the walk
  // before it ever reached the real SQLite message, intermittently missing a
  // genuine unique violation. Check BOTH the message and the stable SQLite
  // error `code` (`SQLITE_CONSTRAINT*`), since messages are less reliable than
  // codes across driver/wrapper layers.
  let current: unknown = err;
  for (let i = 0; i < 5 && current != null && typeof current === 'object'; i += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && UNIQUE_CONSTRAINT_RE.test(message)) return true;
    // Only UNIQUE/PRIMARYKEY constraint codes mean "duplicate" — a broad
    // `startsWith('SQLITE_CONSTRAINT')` would also swallow NOT NULL, CHECK and
    // FOREIGN KEY failures (real write bugs) as idempotent duplicates.
    const code = (current as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Throws a clear not-found error for a write that matched zero rows, so no oplog op is appended for it. */
function assertRowMatched(
  tableName: string,
  id: string,
  householdId: string,
  changes: number,
): void {
  if (changes === 0) {
    throw new Error(
      `createSyncedRepo: no row in "${tableName}" matched id=${id} household_id=${householdId} — 0 rows affected, refusing to append an oplog op`,
    );
  }
}

/**
 * Performs one row insert + its paired oplog append against an ALREADY-OPEN
 * `uow` (the callback argument `runInUnitOfWork` hands to its `fn`), instead
 * of opening a new transaction of its own. `createSyncedRepo(...).insert` is
 * a thin wrapper around this for the common single-entity-per-transaction
 * case.
 *
 * Call this directly — inside your own single `runInUnitOfWork` callback —
 * when several writes across one or more tables must share ONE atomic
 * transaction. `ConfirmSlipUseCase` is the motivating case (spec §4.5 fix):
 * it inserts N transaction rows and flips the slip to 'completed', and every
 * one of those writes must commit or roll back together. Looping calls to
 * `createSyncedRepo(...).insert` would instead open N *separate*
 * transactions — item 1 could commit while item 2 fails, the exact bug this
 * primitive exists to avoid.
 */
export function insertRowWithinUow(
  uow: UnitOfWork,
  tableName: string,
  row: Record<string, unknown>,
  ctx: SyncedRepoCtx,
): void {
  assertSafeIdent(tableName);
  const rowId = row.id;
  const householdId = row.household_id;
  if (typeof rowId !== 'string' || typeof householdId !== 'string') {
    throw new Error('insertRowWithinUow: row.id and row.household_id must be strings');
  }

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
}

/**
 * Same as `insertRowWithinUow`, but for an `update` — see that function's
 * doc for when to reach for this instead of `createSyncedRepo(...).update`.
 */
export function updateRowWithinUow(
  uow: UnitOfWork,
  tableName: string,
  id: string,
  householdId: string,
  fields: Record<string, unknown>,
  ctx: SyncedRepoCtx,
): void {
  assertSafeIdent(tableName);
  const result = uow.db.run(
    sql`UPDATE ${sql.raw(tableName)} SET ${buildAssignments(fields)} WHERE id = ${id} AND household_id = ${householdId}`,
  );
  assertRowMatched(tableName, id, householdId, extractChanges(result));

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
}

/**
 * Like `updateRowWithinUow`, but the UPDATE carries an extra caller-supplied
 * `guard` predicate (ANDed onto the `id` + `household_id` match) and 0 rows
 * affected is NOT an error — the affected-row count is RETURNED so the caller
 * can distinguish "guard held, row updated" (>0) from "guard failed, nothing
 * to do" (0) and react accordingly (e.g. an idempotent already-done
 * short-circuit). The oplog op is appended ONLY when a row was actually
 * changed, so a no-op guard-miss never enqueues a phantom op.
 *
 * Motivating case (ConfirmSlipUseCase, TOCTOU fix): the slip completion write
 * guards on `status != 'completed'` so two overlapping confirms that both
 * read 'processing' cannot BOTH complete and duplicate the item
 * transactions — the loser's UPDATE matches 0 rows and its caller rolls the
 * whole transaction back.
 */
export function updateRowWithinUowGuarded(
  uow: UnitOfWork,
  tableName: string,
  id: string,
  householdId: string,
  fields: Record<string, unknown>,
  guard: SQL,
  ctx: SyncedRepoCtx,
): number {
  assertSafeIdent(tableName);
  const result = uow.db.run(
    sql`UPDATE ${sql.raw(tableName)} SET ${buildAssignments(fields)} WHERE id = ${id} AND household_id = ${householdId} AND (${guard})`,
  );
  const changes = extractChanges(result);
  if (changes > 0) {
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
  }
  return changes;
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
      runInUnitOfWork(db, (uow) => insertRowWithinUow(uow, tableName, row, ctx));
    },

    update(id, householdId, fields, ctx) {
      runInUnitOfWork(db, (uow) =>
        updateRowWithinUow(uow, tableName, id, householdId, fields, ctx),
      );
    },

    softDelete(id, householdId, ctx) {
      runInUnitOfWork(db, (uow) => {
        const deletedAt = ctx.clock();
        const result = uow.db.run(
          sql`UPDATE ${sql.raw(tableName)} SET deleted_at = ${deletedAt} WHERE id = ${id} AND household_id = ${householdId}`,
        );
        assertRowMatched(tableName, id, householdId, extractChanges(result));

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
      assertNotForbiddenColumn(field);
      runInUnitOfWork(db, (uow) => {
        const expression =
          clamp === 'floor_zero'
            ? sql`MAX(0, ${sql.raw(field)} + ${delta})`
            : sql`${sql.raw(field)} + ${delta}`;
        const result = uow.db.run(
          sql`UPDATE ${sql.raw(tableName)} SET ${sql.raw(field)} = ${expression} WHERE id = ${id} AND household_id = ${householdId}`,
        );
        assertRowMatched(tableName, id, householdId, extractChanges(result));

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

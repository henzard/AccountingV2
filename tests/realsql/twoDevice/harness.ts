// tests/realsql/twoDevice/harness.ts
//
// TWO-DEVICE CONVERGENCE HARNESS (spec test tier 3) — the gate for slice 5.
//
// Models N "devices" (each an independent migrated better-sqlite3 in-memory DB
// carrying the real local oplog + sync_cursor + entity tables) talking to ONE
// shared "server" — the local Supabase Postgres — through the REAL server RPCs
// `public.sync_push` / `public.sync_pull` from supabase/migrations/0001_baseline.sql.
// Nothing here re-implements the server merge logic in JS; that is the whole
// point of this tier (catch client<->server protocol mismatches).
//
// This file is the REFERENCE pusher/puller. Task 3 builds the production
// SyncEngine; its push/pull core MUST have the same shape as `push()`/`pull()`
// here so it can be validated against this harness. The reference logic is kept
// inside the test tier (not src/) so Task 2 stays self-contained and does not
// pre-empt Task 3's production design — see .superpowers/sdd/task-2-report.md.
//
// Sync-safety rules honored (weighsoft-sync-safety):
//   R2  push marks a local op `pushed_at` ONLY for the exact op_id the server
//       acknowledged as applied — never an unconditional mark-by-id.
//   R4  delete-wins: a pulled delete stamps the row's `deleted_at` from the
//       ORIGIN op's payload (deterministic, not re-stamped to "now") so devices
//       converge on an identical tombstone value.
//   R5  apply is idempotent: every pulled op is guarded by an `_applied_ops`
//       set keyed by op_id, so a re-delivered op (retry / duplicate) is a no-op
//       with zero value churn. The server itself dedups by op_id too.
//   R6  each pulled op applies inside one better-sqlite3 transaction.
//   R8  ops apply in server `seq` order (parents before children).

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Client } from 'pg';
import { openMigratedDb } from '../harness/openMigratedDb';
import {
  createSyncedRepo,
  type SyncedRepo,
  type SyncedRepoCtx,
  type IncrementClamp,
} from '../../../src/data/uow/createSyncedRepo';
import type { PortableDb } from '../../../src/data/uow/UnitOfWork';

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
function assertIdent(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`harness: unsafe identifier "${name}"`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Operation vocabulary a device can perform locally.
// ---------------------------------------------------------------------------

export interface InsertOp {
  kind: 'insert';
  table: string;
  row: Record<string, unknown>;
}
export interface UpdateOp {
  kind: 'update';
  table: string;
  id: string;
  householdId: string;
  fields: Record<string, unknown>;
}
export interface DeleteOp {
  kind: 'delete';
  table: string;
  id: string;
  householdId: string;
}
export interface IncrementOp {
  kind: 'increment';
  table: string;
  id: string;
  householdId: string;
  field: string;
  delta: number;
  clamp: IncrementClamp;
}
export type DeviceOp = InsertOp | UpdateOp | DeleteOp | IncrementOp;

// ---------------------------------------------------------------------------
// Row shapes.
// ---------------------------------------------------------------------------

interface LocalOplogRow {
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string; // JSON string
  actor_user_id: string | null;
  device_id: string;
  client_created_at: string;
}

interface ServerOplogRow {
  seq: string | number; // pg bigint -> string
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: Record<string, unknown> | null; // pg jsonb -> object
  device_id: string;
}

interface WireOp {
  v: '1';
  op_id: string;
  household_id: string;
  table: string;
  row_id: string;
  op_type: string;
  payload: Record<string, unknown>;
  device_id: string;
  actor_user_id: string | null;
  client_created_at: string;
}

interface PushResult {
  op_id: string;
  status: 'applied' | 'rejected';
  code: string | null;
}

// ---------------------------------------------------------------------------
// Device — one replica.
// ---------------------------------------------------------------------------

export class Device {
  readonly id: string;
  readonly actorUserId: string;
  readonly raw: Database.Database;
  private readonly db: PortableDb;
  private readonly repos = new Map<string, SyncedRepo>();
  private clockSeq = 0;

  constructor(id: string, actorUserId: string) {
    this.id = id;
    this.actorUserId = actorUserId;
    this.raw = openMigratedDb();
    this.db = drizzle(this.raw) as unknown as PortableDb;
    // Local idempotency guard for pulled ops (R5). Not part of the shipped
    // schema — a receiver-side dedupe set the production SyncEngine will own.
    this.raw.exec('CREATE TABLE IF NOT EXISTS _applied_ops (op_id TEXT PRIMARY KEY)');
  }

  private repo(tableName: string): SyncedRepo {
    assertIdent(tableName);
    let r = this.repos.get(tableName);
    if (!r) {
      r = createSyncedRepo(this.db, { tableName });
      this.repos.set(tableName, r);
    }
    return r;
  }

  // A strictly-increasing local clock so client_created_at values are unique
  // and ordered per device (display/tiebreak only; ordering is by server seq).
  private ctx(): SyncedRepoCtx {
    this.clockSeq += 1;
    const iso = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + this.clockSeq).toISOString();
    return {
      deviceId: this.id,
      actorUserId: this.actorUserId,
      clock: () => iso,
    };
  }

  /** Apply one op to this device's LOCAL entity table + append one local oplog op. */
  write(op: DeviceOp): void {
    const repo = this.repo(op.table);
    switch (op.kind) {
      case 'insert':
        repo.insert(op.row, this.ctx());
        break;
      case 'update':
        repo.update(op.id, op.householdId, op.fields, this.ctx());
        break;
      case 'delete':
        repo.softDelete(op.id, op.householdId, this.ctx());
        break;
      case 'increment':
        repo.increment(op.id, op.householdId, op.field, op.delta, op.clamp, this.ctx());
        break;
    }
  }

  /** Unpushed local ops, oldest first (rowid = local insertion order). */
  drainable(): LocalOplogRow[] {
    return this.raw
      .prepare('SELECT * FROM oplog WHERE pushed_at IS NULL ORDER BY rowid')
      .all() as LocalOplogRow[];
  }

  markPushed(opIds: string[]): void {
    if (opIds.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.raw.prepare('UPDATE oplog SET pushed_at = ? WHERE op_id = ?');
    const tx = this.raw.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(now, id);
    });
    tx(opIds);
  }

  cursor(householdId: string): number {
    const row = this.raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(householdId) as { s: number } | undefined;
    return row ? Number(row.s) : 0;
  }

  setCursor(householdId: string, seq: number): void {
    this.raw
      .prepare(
        `INSERT INTO sync_cursor (household_id, last_pulled_seq) VALUES (?, ?)
         ON CONFLICT (household_id) DO UPDATE SET last_pulled_seq = excluded.last_pulled_seq`,
      )
      .run(householdId, seq);
  }

  /** Apply one pulled server op to this device's local entity tables (idempotent). */
  applyPulled(op: ServerOplogRow): void {
    const table = assertIdent(op.table_name);
    const payload = op.payload ?? {};
    const tx = this.raw.transaction(() => {
      // R5: dedupe by op_id. If we've applied this op before, it's a no-op.
      const claimed = this.raw
        .prepare('INSERT OR IGNORE INTO _applied_ops (op_id) VALUES (?)')
        .run(op.op_id);
      if (claimed.changes === 0) return;

      if (op.op_type === 'insert') {
        const keys = Object.keys(payload).map(assertIdent);
        const cols = ['id', 'household_id', ...keys];
        const vals = [op.row_id, op.household_id, ...keys.map((k) => payload[k])];
        const placeholders = cols.map(() => '?').join(', ');
        // ON CONFLICT DO NOTHING mirrors the server's insert idempotency (§6.6).
        this.raw
          .prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
          .run(...(vals as never[]));
      } else if (op.op_type === 'update') {
        const keys = Object.keys(payload).map(assertIdent);
        if (keys.length > 0) {
          const setClause = keys.map((k) => `${k} = ?`).join(', ');
          this.raw
            .prepare(`UPDATE ${table} SET ${setClause} WHERE id = ? AND household_id = ?`)
            .run(...(keys.map((k) => payload[k]) as never[]), op.row_id, op.household_id);
        }
      } else if (op.op_type === 'delete') {
        // R4 + M5: stamp the ORIGIN's deleted_at (never a local "now"). Applied
        // for OWN delete ops too (see pull()); a double-delete converges by
        // LAST-WRITER-BY-SEQ — both replicas replay in seq order and end on the
        // higher-seq tombstone. No `deleted_at IS NULL` guard: the server's
        // apply is unconditional last-write, so a guard would diverge from it
        // (mirrors SyncEngine.applyOne).
        const deletedAt =
          typeof payload.deleted_at === 'string' ? payload.deleted_at : new Date().toISOString();
        this.raw
          .prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ? AND household_id = ?`)
          .run(deletedAt, op.row_id, op.household_id);
      } else if (op.op_type === 'increment') {
        const field = assertIdent(String(payload.field));
        const delta = Number(payload.delta);
        const expr = payload.clamp === 'floor_zero' ? `MAX(0, ${field} + ?)` : `${field} + ?`;
        this.raw
          .prepare(`UPDATE ${table} SET ${field} = ${expr} WHERE id = ? AND household_id = ?`)
          .run(delta, op.row_id, op.household_id);
        // M6: mirror the server's is_paid_off trigger locally when a debts
        // balance increment is applied (mirrors SyncEngine.applyOne).
        if (table === 'debts' && field === 'outstanding_balance_cents') {
          this.raw
            .prepare(
              `UPDATE debts SET is_paid_off = (outstanding_balance_cents <= 0) WHERE id = ? AND household_id = ?`,
            )
            .run(op.row_id, op.household_id);
        }
      }
    });
    tx();
  }

  close(): void {
    this.raw.close();
  }
}

// ---------------------------------------------------------------------------
// Harness — wires devices to the shared server (real Postgres RPCs).
// ---------------------------------------------------------------------------

export class TwoDeviceHarness {
  private readonly client: Client;
  private readonly devices = new Map<string, Device>();

  constructor(client: Client) {
    this.client = client;
  }

  /** Registers a device. `actorUserId` must be the jwt `sub` seeded as a household member. */
  addDevice(id: string, actorUserId: string): Device {
    const dev = new Device(id, actorUserId);
    this.devices.set(id, dev);
    return dev;
  }

  /** Local write on `dev` — appends to its oplog + applies locally. */
  deviceWrite(dev: Device, op: DeviceOp): void {
    dev.write(op);
  }

  /**
   * Drains `dev`'s unpushed local ops, calls the REAL `sync_push`, and marks
   * pushed ONLY the op_ids the server acknowledged as applied (R2).
   */
  async push(dev: Device): Promise<PushResult[]> {
    const rows = dev.drainable();
    if (rows.length === 0) return [];
    const ops: WireOp[] = rows.map((r) => this.toWireOp(r));
    const res = await this.client.query<{ r: PushResult[] }>(
      'SELECT public.sync_push($1::jsonb) AS r',
      [JSON.stringify(ops)],
    );
    const results = res.rows[0].r;
    const appliedIds = results.filter((x) => x.status === 'applied').map((x) => x.op_id);
    dev.markPushed(appliedIds);
    return results;
  }

  /**
   * Pulls new ops for `householdId` from `dev`'s cursor via the REAL
   * `sync_pull`, applies each (skipping own device_id) in seq order, and
   * advances the cursor. Loops until the server returns fewer than the limit.
   */
  async pull(dev: Device, householdId: string): Promise<void> {
    const limit = 200;
    let cursor = dev.cursor(householdId);
    for (;;) {
      const res = await this.client.query<ServerOplogRow>(
        'SELECT * FROM public.sync_pull($1, $2, $3)',
        [householdId, cursor, limit],
      );
      const rows = res.rows;
      if (rows.length === 0) break;
      for (const row of rows) {
        const seq = Number(row.seq);
        // Convergence (H4/M5): re-apply this device's OWN absolute-value ops
        // (insert/update/delete) in server-`seq` order — the server oplog seq is
        // the single authoritative total order, so replaying every op (own +
        // remote) in that order makes all replicas converge to the highest-seq
        // write. Only own `increment` ops are skipped (already folded in locally
        // at creation + non-idempotent, so re-applying would double-count).
        // Mirrors src/data/sync/SyncEngine.applyPulledBatch.
        if (!(row.device_id === dev.id && row.op_type === 'increment')) {
          dev.applyPulled(row);
        }
        if (seq > cursor) cursor = seq;
      }
      dev.setCursor(householdId, cursor);
      if (rows.length < limit) break;
    }
  }

  private toWireOp(r: LocalOplogRow): WireOp {
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    // The server's payload column allowlist forbids id/household_id (they are
    // carried as top-level row_id/household_id). createSyncedRepo.insert stores
    // the whole row (incl. id/household_id) in the LOCAL payload, so strip them
    // for the wire. update/delete/increment payloads never carry them.
    const clean = { ...payload };
    delete clean.id;
    delete clean.household_id;
    return {
      v: '1',
      op_id: r.op_id,
      household_id: r.household_id,
      table: r.table_name,
      row_id: r.row_id,
      op_type: r.op_type,
      payload: clean,
      device_id: r.device_id,
      actor_user_id: r.actor_user_id,
      client_created_at: r.client_created_at,
    };
  }

  // ----- convergence assertions ---------------------------------------------

  /**
   * Canonical projection of a device's entity table for the household: every
   * row keyed by id. Two devices CONVERGE iff this projection is deep-equal.
   *
   * Normalizations (both defensible under weighsoft-sync-safety):
   *   - `is_synced` (local-only bookkeeping, never part of the sync protocol)
   *     is dropped.
   *   - `deleted_at` is collapsed to a sentinel: null stays null, any value
   *     becomes `'<deleted>'`. A tombstone's exact wall-clock instant is a
   *     display value only (R3); convergence means both replicas agree the row
   *     is deleted and it STAYS deleted (R4 delete-wins), not that they hold
   *     the identical deletion timestamp — which two concurrent deletes with
   *     different origin clocks legitimately would not.
   */
  snapshot(
    dev: Device,
    table: string,
    householdId: string,
  ): Record<string, Record<string, unknown>> {
    assertIdent(table);
    const rows = dev.raw
      .prepare(`SELECT * FROM ${table} WHERE household_id = ? ORDER BY id`)
      .all(householdId) as Record<string, unknown>[];
    const out: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      const { is_synced: _ignored, deleted_at, ...rest } = row;
      void _ignored;
      out[String(row.id)] = {
        ...rest,
        deleted_at: deleted_at == null ? null : '<deleted>',
      };
    }
    return out;
  }

  closeAll(): void {
    for (const dev of this.devices.values()) dev.close();
  }
}

// ---------------------------------------------------------------------------
// Server-side helpers (shared setup/reset used by the test file).
// ---------------------------------------------------------------------------

/** Fixed test identifiers. The member user_id MUST equal the jwt `sub` below. */
export const TEST_USER_UUID = '11111111-1111-1111-1111-111111111111';

/**
 * Makes `auth.uid()` return TEST_USER_UUID for this connection so the
 * `sync_push` membership check (private.is_household_member) passes. Run once
 * per connection, OUTSIDE any transaction, so a per-test BEGIN/ROLLBACK does
 * not revert it.
 */
export async function setSessionUser(client: Client, userUuid = TEST_USER_UUID): Promise<void> {
  await client.query('SELECT set_config($1, $2, false)', [
    'request.jwt.claims',
    JSON.stringify({ sub: userUuid }),
  ]);
}

/** Seeds the household + an active membership row for TEST_USER_UUID. */
export async function seedHousehold(
  client: Client,
  householdId: string,
  userUuid = TEST_USER_UUID,
): Promise<void> {
  await client.query(
    `INSERT INTO public.households (id, name, payday_day, user_level, created_at, updated_at)
     VALUES ($1, 'Convergence HH', 1, 1, now(), now())`,
    [householdId],
  );
  await client.query(
    `INSERT INTO public.household_members (id, household_id, user_id, role, joined_at, updated_at)
     VALUES ($1, $2, $3, 'owner', now(), now())`,
    [`member-${householdId}`, householdId, userUuid],
  );
}

/**
 * A ready-to-insert local debt row (snake_case = DB columns). `debts` is used
 * as the harness entity because its money columns (`total_paid_cents`,
 * `outstanding_balance_cents`) exist on BOTH the local SQLite schema and the
 * server schema, so `increment` ops apply identically on each side — unlike
 * `envelopes.spent_cents`, which is now a derived (local-only) balance. Only
 * NOT-NULL / meaningful columns are set; booleans are left to their column
 * defaults so no JS boolean is ever bound to SQLite. `created_at`/`updated_at`
 * are deterministic so the insert payload (and thus both devices) converge
 * exactly. `total_paid_cents` is the accumulating "debt paydown" field the
 * increment tests drive.
 */
export function debtRow(
  id: string,
  householdId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const NOW = '2026-01-01T00:00:00.000Z';
  return {
    id,
    household_id: householdId,
    creditor_name: 'Visa',
    debt_type: 'credit_card',
    outstanding_balance_cents: 100000,
    interest_rate_percent: 19.9,
    minimum_payment_cents: 5000,
    total_paid_cents: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

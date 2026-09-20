// src/data/sync/SyncEngine.ts
//
// PRODUCTION sync engine — the pusher + puller that drain the local oplog
// to/from the server via the `public.sync_push` / `public.sync_pull` RPCs
// (supabase/migrations/0001_baseline.sql, §9). This is the shipped counterpart
// to the two-device convergence harness (tests/realsql/twoDevice/harness.ts):
// its push/pull core has the SAME SHAPE as the harness reference logic and is
// validated against the SAME convergence properties (the GATE).
//
// weighsoft-sync-safety rules honored (see the class doc-comments for the exact
// line each rule guards):
//   R2  push marks a local op `pushed_at` ONLY when the server acknowledged
//       THAT op_id as applied, and the mark is guarded (`pushed_at IS NULL`) so
//       a concurrent drain / already-dead-lettered op is never clobbered. Never
//       an unconditional mark-by-id.
//   R4  a pulled delete stamps the row's `deleted_at` from the ORIGIN op's
//       payload (deterministic, never re-stamped to a local "now") so replicas
//       converge on the same tombstone; delete-wins is the server's own rule.
//   R5  pull apply is idempotent: every applied op_id is recorded in the local
//       receiver table `oplog_applied`, so a re-delivered op (retry / re-pull)
//       is a no-op with zero value churn.
//   R6  each pulled batch applies inside ONE local transaction, and the pull
//       cursor advances IN THAT SAME transaction — a rollback reverts both, so
//       the cursor can never point past an unapplied op.
//   R8  ops apply in server `seq` order (the server returns them ordered).
//   §7.2 the puller reuses the pusher's classification/backoff shape: a
//       transient transport failure backs off (capped exponential) and never
//       throws out of pull(); a batch that repeatedly fails to APPLY (not a
//       network error) never advances the cursor (no data loss — R6) but
//       stops auto-retrying after `maxPullApplyRetries` and is surfaced via
//       `getPullHealth()` as a poison batch (a code-fix situation).
//
// The engine depends on an injected `SyncTransport` (not the raw supabase
// client) so it is testable against either the real `sync_push`/`sync_pull`
// RPCs (via `createSupabaseSyncTransport`) or a Postgres-backed test transport.

import { sql } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyOplogWrite, type PortableDb } from '../uow/UnitOfWork';
import { getSyncWriteDefaults } from '../../domain/shared/syncWrite';
import { isActiveEmergencyFund, resolveIncomingEmergencyFund } from './emergencyFundConflict';
import { publishHouseholdEviction } from './householdEviction';
import { logger } from '../../infrastructure/logging/Logger';

// ---------------------------------------------------------------------------
// Wire + result vocabulary (mirrors the harness + the server RPC contract).
// ---------------------------------------------------------------------------

/** One operation as sent to `sync_push`. `id`/`household_id` are carried as
 * top-level `row_id`/`household_id`, never inside `payload` (server allowlist). */
export interface WireOp {
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

/** Per-op outcome returned by `sync_push`, in input order. */
export interface PushResult {
  op_id: string;
  status: 'applied' | 'rejected';
  code: string | null;
}

/** One oplog row as returned by `sync_pull` (server-assigned `seq`). */
export interface ServerOplogRow {
  seq: string | number; // pg bigint -> string; supabase jsonb -> number
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: Record<string, unknown> | null;
  device_id: string;
}

/** The transport the engine drives. Abstracts `supabase.rpc(...)` so the engine
 * is unit- and integration-testable. `signal` carries the engine's 30s timeout. */
export interface SyncTransport {
  push(ops: WireOp[], signal: AbortSignal): Promise<PushResult[]>;
  pull(
    householdId: string,
    afterSeq: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ServerOplogRow[]>;
  /** Fetches the current server state of one row (`public.sync_row_state`,
   * membership-checked and table-allowlisted server-side) — Task 5's DLQ
   * "discard" action (spec §6.10). Returns `null` if the row doesn't exist
   * server-side (or the caller isn't a household member). Optional so
   * existing push/pull-only test doubles remain valid without a rowState
   * stub; the production transport (`createSupabaseSyncTransport`) always
   * implements it. */
  rowState?(
    householdId: string,
    table: string,
    rowId: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> | null>;
  /**
   * Authoritative answer to "is this device's user still an ACTIVE member of
   * `householdId`?" — the single check that decides whether a household is
   * evicted locally (see `SyncEngine.checkMembershipAndEvict`).
   *
   * The contract is deliberately three-valued, encoded as resolve/resolve/
   * throw, because a false "no" destroys a household's presence on this
   * device:
   *   - resolves `true`  — the server answered and the user IS a member;
   *   - resolves `false` — the server EXPLICITLY answered that they are not;
   *   - THROWS           — inconclusive (offline, 5xx, timeout, abort, no
   *                        signed-in user, unrecognised error). Never guess.
   *
   * Optional so existing push/pull-only test doubles stay valid; the
   * production transport (`createSupabaseSyncTransport`) implements it.
   */
  membershipCheck?(householdId: string, signal: AbortSignal): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Local oplog row shape (snake_case = DB columns) for the pusher.
// ---------------------------------------------------------------------------

interface PushableOp {
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string; // JSON string in the local oplog
  actor_user_id: string | null;
  device_id: string;
  client_created_at: string;
  retry_count: number;
}

export interface PushSummary {
  batches: number;
  applied: number;
  deadLettered: number;
  backedOff: number;
  /** True if a `sync_push` call itself failed (network / 5xx / timeout /
   * abort). The ops are intact and backed off — but the round did NOT reach
   * the server, so the caller must not report it as a successful sync
   * (SYNC-10). */
  transportFailed: boolean;
}

export interface PullSummary {
  batches: number;
  applied: number;
  /** True if this household's puller is currently blocked on a poison batch
   * (a batch that repeatedly failed to apply locally — see `getPullHealth`
   * for the diagnostic detail). When true, this call did not contact the
   * transport at all (§7.2). */
  blocked: boolean;
  /** True if a `sync_pull` call itself failed (network / 5xx / timeout /
   * abort) — see `PushSummary.transportFailed`. */
  transportFailed: boolean;
}

/** Outcome of one full `sync()` round (SYNC-10). `transportFailed` or
 * `pullBlocked` mean the round did NOT fully succeed, so the caller must not
 * stamp a "last synced at" for it. `skipped` means a round for the same scope
 * was already in flight (single-flight) — neither success nor failure. */
export interface SyncSummary {
  push?: PushSummary;
  pull?: PullSummary;
  transportFailed: boolean;
  pullBlocked: boolean;
  skipped: boolean;
}

/** Side effects one applied batch produced that must be acted on only after
 * its transaction has COMMITTED (a rollback must undo them too). */
interface ApplyEffects {
  /** A SYNC-5 emergency-fund demotion appended a local op that needs pushing. */
  queuedLocalOps: boolean;
}

/** Diagnostic surface for a household's puller (Task 5's Sync Health UI).
 * `opIds`/`error` are populated only when `blocked` is true. Never includes
 * op payloads (§7.4 — financial data), only op_ids and the error message. */
export interface PullHealth {
  blocked: boolean;
  opIds?: string[];
  error?: string;
  blockedAt?: string;
}

/** One dead-lettered local op (Task 5's Sync Health / DLQ inbox). Deliberately
 * NEVER includes `payload` (§7.4 — financial data): only enough metadata to
 * show + action the row in the UI. */
export interface DeadLetteredOp {
  opId: string;
  householdId: string;
  table: string;
  rowId: string;
  opType: string;
  deadLetteredAt: string;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Classification: the server reject codes we treat as PERMANENT.
//
// A rejection with one of these codes is deterministic — the server evaluated
// the op and refused it; retrying the identical op yields the identical
// rejection — so the op is dead-lettered (journaled, inspectable, retryable by
// an operator), NOT silently dropped (R1) and NOT retried forever.
//
// Everything else is transient:
//   - a transport failure (network / 5xx / timeout / abort) throws out of the
//     RPC call -> the whole batch is left unpushed and backed off (no discard);
//   - an UNEXPECTED per-op reject code (a raw SQLSTATE from the server's
//     apply_one_op EXCEPTION handler) is retried with capped backoff and only
//     dead-lettered after `maxRejectRetries`, so a genuinely permanent unknown
//     error is eventually journaled rather than spinning forever.
// ---------------------------------------------------------------------------

export const PERMANENT_REJECT_CODES: ReadonlySet<string> = new Set([
  'unsupported',
  'forbidden_column',
  'wrong_household',
  'not_member',
  // Both are `private.apply_one_op`'s household_members guard (0007, live
  // body in 0010) and are as deterministic as the four above: the SAME op
  // re-pushed re-evaluates the SAME committed state and is refused
  // identically. They were missing from this set, so they fell through to
  // the "unexpected code" branch in `drainPush` — retried ten times with
  // capped backoff and, worse, marking the household `stalled` on every one
  // of those rounds, which holds up every UNRELATED op behind them. They now
  // dead-letter on the first rejection and never stall the queue.
  //
  // `forbidden_member`: the op tried to write somebody else's membership row,
  //   insert a second/elevated row for itself, or update a membership row at
  //   all. Only the owner RPCs (create_invitation,
  //   join_household_via_invite, remove_household_member) may do those, and
  //   they bypass sync_push entirely — so no amount of retrying turns this
  //   into an applied op.
  // `last_owner`: a household's last ACTIVE owner tried to delete their own
  //   membership row (leave). `LeaveHouseholdUseCase` pre-checks the exact
  //   same condition locally so a correct client never emits this op; a
  //   second device acting on a stale roster still can, and it must surface
  //   as one inspectable dead letter rather than ten stalled rounds.
  'forbidden_member',
  'last_owner',
]);

/**
 * Reject codes that are KNOWN-transient: the op is well-formed and the caller
 * is entitled to it, the server just cannot apply it YET. These are backed
 * off indefinitely (capped exponential — at most one attempt a minute) and
 * NEVER dead-lettered, because the reason they fail is an ordering condition
 * that resolves itself once the op they depend on lands.
 *
 * `row_missing`: the target row does not exist server-side yet, i.e. its
 * `insert` op is still queued (or still backing off) on this device. Before
 * the server distinguished it, this came back as `wrong_household` — a
 * PERMANENT code — so a perfectly good update/delete was dead-lettered
 * forever whenever per-op backoff let it overtake its own insert (SYNC-4).
 * The head-of-line rule in `fetchPushable` stops that overtake happening in
 * the first place; this is the safety net for an op that already got ahead.
 */
export const TRANSIENT_REJECT_CODES: ReadonlySet<string> = new Set(['row_missing']);

/**
 * The push reject code that means "the server does not consider you a member
 * of this household". It is already PERMANENT (the op is dead-lettered), but
 * it is ALSO the only signal a removed member's device can ever receive that
 * it has been removed: `sync_pull` is SECURITY INVOKER over an RLS-protected
 * `oplog`, so the removal op — like every other op for that household — is
 * simply invisible to them, and their pulls return zero rows forever, which
 * is indistinguishable from "nothing new". See `checkMembershipAndEvict`.
 */
const MEMBERSHIP_REJECT_CODE = 'not_member';

/**
 * A pull failure whose SHAPE says "permission", not "network". Only these
 * make the engine even ASK whether it is still a member; the answer itself
 * always comes from `transport.membershipCheck`, never from this predicate.
 *
 * Today the server cannot actually produce one of these for `sync_pull` (RLS
 * returns zero rows rather than an error, and EXECUTE is granted to every
 * authenticated role), so this is the safety net for a server that later
 * tightens that — it must not be read as the main detection path.
 */
const PERMISSION_ERROR_RE = /\b42501\b|permission denied|insufficient_privilege|not authori[sz]ed/i;

function isPermissionShapedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return PERMISSION_ERROR_RE.test(message);
}

export interface SyncEngineOptions {
  /** Max ops per `sync_push` call. Default 50. */
  batchSize?: number;
  /** `sync_pull` page size. Default 200. */
  pullLimit?: number;
  /** Per-RPC AbortController timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Exponential backoff base in ms. Default 1_000. */
  backoffBaseMs?: number;
  /** Exponential backoff cap in ms. Default 60_000. */
  backoffMaxMs?: number;
  /** Retries of an UNEXPECTED per-op reject code before it is dead-lettered. Default 10. */
  maxRejectRetries?: number;
  /** Consecutive local-apply failures of the SAME pulled batch (same cursor
   * position) before the puller flags it a poison batch, stops retrying it
   * automatically, and surfaces `getPullHealth().blocked` (§7.2). Default 5. */
  maxPullApplyRetries?: number;
}

export interface SyncEngineDeps {
  db: PortableDb;
  transport: SyncTransport;
  deviceId: string;
  /** Returns "now" as an ISO-8601 string. Injected for deterministic tests. */
  clock?: () => string;
  options?: SyncEngineOptions;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
function assertIdent(name: string): string {
  // Internal literal column/table names only — guards typos, not attackers.
  if (!IDENT_RE.test(name)) {
    throw new Error(`SyncEngine: unsafe identifier "${name}"`);
  }
  return name;
}

/** better-sqlite3 / expo-sqlite cannot bind a JS boolean — coerce to 1/0. */
function coerceValue(value: unknown): unknown {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/** Strips `id`/`household_id` from the local payload (carried top-level on the wire). */
function toWireOp(op: PushableOp): WireOp {
  const parsed = JSON.parse(op.payload) as Record<string, unknown>;
  const payload = { ...parsed };
  delete payload.id;
  delete payload.household_id;
  return {
    v: '1',
    op_id: op.op_id,
    household_id: op.household_id,
    table: op.table_name,
    row_id: op.row_id,
    op_type: op.op_type,
    payload,
    device_id: op.device_id,
    actor_user_id: op.actor_user_id,
    client_created_at: op.client_created_at,
  };
}

/**
 * Keeps a household's bootstrap pair in ONE `sync_push` call (SYNC-4).
 *
 * Creating a household writes two ops back to back: the `households` insert
 * and the owner's `household_members` insert. The server's membership check
 * runs per op against committed state, so a `households` insert that lands in
 * batch N with its owner membership left for batch N+1 leaves a window in
 * which the creator is not yet a member of the household they just made —
 * every op in between is rejected `not_member`, which is PERMANENT, so the
 * whole burst is dead-lettered.
 *
 * `ops` is one op longer than `limit` (the peeked next op). If the batch would
 * end on a `households` insert whose adjacent `household_members` insert falls
 * on the other side of the boundary, drop the `households` insert too so the
 * pair moves together into the next batch.
 */
function trimHouseholdBootstrapSplit(ops: PushableOp[], limit: number): PushableOp[] {
  const last = ops[limit - 1];
  const next = ops[limit];
  const splitsBootstrap =
    limit > 1 &&
    last.table_name === 'households' &&
    last.op_type === 'insert' &&
    next.table_name === 'household_members' &&
    next.op_type === 'insert' &&
    next.household_id === last.household_id;
  return ops.slice(0, splitsBootstrap ? limit - 1 : limit);
}

/** Capped exponential backoff: min(cap, base * 2^retryCount) added to `nowIso`. */
function nextAttemptAt(retryCount: number, baseMs: number, maxMs: number, nowIso: string): string {
  const delay = Math.min(maxMs, baseMs * 2 ** retryCount);
  return new Date(Date.parse(nowIso) + delay).toISOString();
}

// ---------------------------------------------------------------------------
// SyncEngine.
// ---------------------------------------------------------------------------

/** How long an acknowledged local oplog row is kept before `prunePushedOps`
 * drops it. Long enough to stay a useful local audit trail and to outlive any
 * realistic re-delivery window, short enough to bound the table. */
const OPLOG_RETENTION_DAYS = 30;

export class SyncEngine {
  private readonly db: PortableDb;
  private readonly transport: SyncTransport;
  private readonly deviceId: string;
  private readonly clock: () => string;
  private readonly batchSize: number;
  private readonly pullLimit: number;
  private readonly timeoutMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxRejectRetries: number;
  private readonly maxPullApplyRetries: number;

  /** Single-flight guard keyed by scope (`push`, `pull:<hh>`, `sync:<hh>`). A
   * hung RPC releases its key when the 30s timeout aborts the call. */
  private readonly inFlight = new Set<string>();

  // ----- puller resilience state (§7.2) --------------------------------
  //
  // Deliberately IN-MEMORY, not persisted on `sync_cursor` — a transient
  // network failure only needs to survive until the next foreground trigger
  // calls pull() again, and a process restart legitimately wants to try
  // immediately (no stale backoff/poison state surviving a fresh process, and
  // no migration needed for a value with no meaning across restarts).

  /** Per-household transient transport-failure backoff (mirrors the pusher's
   * capped exponential backoff). Cleared on the next successful pull. */
  private readonly pullBackoff = new Map<string, { retryCount: number; nextAttemptAtMs: number }>();

  /** Per-household count of consecutive LOCAL APPLY failures (not transport
   * failures) for the batch read from the same cursor position. Cleared on
   * the next successful pull. */
  private readonly pullApplyFailures = new Map<string, { cursor: number; attempts: number }>();

  /** Households whose puller is blocked on a poison batch — a batch that
   * failed to apply `maxPullApplyRetries` times in a row. This is a code-fix
   * situation (client/server schema drift), not a transient condition, so it
   * is cleared only by restarting the process (after a fix ships), never
   * automatically. */
  private readonly pullBlocked = new Map<
    string,
    { opIds: string[]; error: string; blockedAt: string }
  >();

  /** Tables a pulled op named that this app version's schema does not have,
   * and `table.column` pairs likewise — one warning each per session (see
   * `applyOne`'s forward-compatibility note). */
  private readonly loggedUnknownTables = new Set<string>();
  private readonly loggedUnknownColumns = new Set<string>();

  constructor(deps: SyncEngineDeps) {
    this.db = deps.db;
    this.transport = deps.transport;
    this.deviceId = deps.deviceId;
    this.clock = deps.clock ?? ((): string => new Date().toISOString());
    const o = deps.options ?? {};
    this.batchSize = o.batchSize ?? 50;
    this.pullLimit = o.pullLimit ?? 200;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.backoffBaseMs = o.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = o.backoffMaxMs ?? 60_000;
    this.maxRejectRetries = o.maxRejectRetries ?? 10;
    this.maxPullApplyRetries = o.maxPullApplyRetries ?? 5;
    // Receiver-side idempotency ledger (R5). Local-only bookkeeping — NOT part
    // of the sync protocol, so it lives outside the shipped migration chain.
    this.db.run(sql`CREATE TABLE IF NOT EXISTS oplog_applied (op_id text PRIMARY KEY)`);
  }

  // ----- public API ---------------------------------------------------------

  /** Drains unpushed local ops to the server. Returns `undefined` if a push is
   * already in flight (single-flight skip). */
  push(): Promise<PushSummary | undefined> {
    return this.withLock('push', () => this.drainPush());
  }

  /** Pulls + applies new ops for `householdId` from the cursor. Returns
   * `undefined` if a pull for this household is already in flight. */
  pull(householdId: string): Promise<PullSummary | undefined> {
    return this.withLock(`pull:${householdId}`, () => this.drainPull(householdId));
  }

  /**
   * Full round: push everything, then drain-pull the household. Returns what
   * actually happened (SYNC-10) — a transport failure never throws out of
   * push/pull, so without this summary the caller cannot tell a round that
   * reached the server from one that never left the device and would stamp
   * "last synced" on a completely failed round.
   */
  async sync(householdId: string): Promise<SyncSummary> {
    const summary = await this.withLock(`sync:${householdId}`, async () => {
      const push = await this.withLock('push', () => this.drainPush());
      const pull = await this.withLock(`pull:${householdId}`, () => this.drainPull(householdId));
      const result: SyncSummary = {
        push,
        pull,
        // An inner single-flight skip (`undefined`) means another round is
        // already draining that half — not a failure, and not this round's
        // success to claim either.
        transportFailed: Boolean(push?.transportFailed) || Boolean(pull?.transportFailed),
        pullBlocked: Boolean(pull?.blocked),
        skipped: push === undefined && pull === undefined,
      };
      return result;
    });
    if (summary && !summary.transportFailed && !summary.pullBlocked && !summary.skipped) {
      this.prunePushedOps();
    }
    return summary ?? { transportFailed: false, pullBlocked: false, skipped: true };
  }

  /**
   * SEC2-14. Drops local oplog rows the server acknowledged more than
   * `OPLOG_RETENTION_DAYS` ago. The outbox is append-only otherwise, so on a
   * long-lived install it grows without bound — every transaction, every
   * balance increment, payload and all, kept on the device forever.
   *
   * Strictly limited to rows with a `pushed_at` older than the cutoff:
   *  - an UNPUSHED row is still owed to the server (deleting it loses the
   *    write outright);
   *  - a DEAD-LETTERED row is the DLQ's only record of a rejected write and
   *    is what `retryDeadLettered`/`discardDeadLettered` act on;
   *  - `oplog_applied` is deliberately untouched — it is the receiver-side
   *    idempotency ledger (R5) and pruning it would let a re-delivered
   *    `increment` double-count.
   *
   * The 30-day floor keeps `isOwnIncrement`'s "was this op written here?"
   * lookup correct for anything the server could still be re-delivering: the
   * puller's cursor only moves forward, so a pruned op can reappear only via
   * a full restore, which resets the cursor and rebuilds from a snapshot.
   *
   * Best-effort — never throws out of a successful round.
   */
  private prunePushedOps(): void {
    const cutoff = new Date(
      Date.parse(this.clock()) - OPLOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    try {
      this.db.run(sql`
        DELETE FROM oplog
        WHERE pushed_at IS NOT NULL
          AND dead_lettered_at IS NULL
          AND pushed_at < ${cutoff}
      `);
    } catch (err) {
      logger.warn('SyncEngine: pruning pushed oplog rows failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Sync Health surface (Task 5): is this household's puller stalled on a
   * poison batch? See `pullBlocked` for why this is a code-fix situation, not
   * a transient one. Never exposes op payloads (§7.4), only op_ids + the
   * error message. */
  getPullHealth(householdId: string): PullHealth {
    const b = this.pullBlocked.get(householdId);
    return b ? { blocked: true, ...b } : { blocked: false };
  }

  /** Diagnostic surface (Task 4's `syncStore.pendingCount`, Task 5's Sync
   * Health UI): count of local oplog ops not yet pushed and not
   * dead-lettered. Read-only — mirrors `fetchPushable`'s eligibility
   * predicate minus the backoff-window clause (pending means "not yet
   * synced", whether or not it's currently backing off), never mutates
   * state. Global (not household-scoped), matching the pusher's own
   * household-agnostic drain. */
  getPendingPushCount(): number {
    const row = this.db.get<{ c: number }>(sql`
      SELECT COUNT(*) AS c FROM oplog WHERE pushed_at IS NULL AND dead_lettered_at IS NULL
    `);
    return row ? Number(row.c) : 0;
  }

  /** Manual unblock for a household's poison-batch pull block (Task 5's Sync
   * Health "Retry" action). `getPullHealth().blocked` otherwise clears only on
   * a process restart (Task 3 review finding) — this lets the UI clear it
   * in-process after a code fix ships (or to give a fresh set of retries),
   * without waiting for the user to relaunch the app. Also resets the
   * apply-failure/backoff counters for this household so the NEXT `pull()`
   * gets a full fresh attempt cycle rather than re-blocking after one retry. */
  clearPullBlock(householdId: string): void {
    this.pullBlocked.delete(householdId);
    this.pullApplyFailures.delete(householdId);
    this.pullBackoff.delete(householdId);
    logger.info('SyncEngine: pull block manually cleared', { householdId });
  }

  /** Lists this household's dead-lettered ops, newest-first (Task 5's DLQ
   * inbox). Never returns `payload` (§7.4 — financial data). */
  listDeadLettered(householdId: string): DeadLetteredOp[] {
    const rows = this.db.all<{
      op_id: string;
      household_id: string;
      table_name: string;
      row_id: string;
      op_type: string;
      dead_lettered_at: string;
      retry_count: number;
    }>(sql`
      SELECT op_id, household_id, table_name, row_id, op_type, dead_lettered_at, retry_count
      FROM oplog
      WHERE household_id = ${householdId} AND dead_lettered_at IS NOT NULL
      ORDER BY dead_lettered_at DESC
    `);
    return rows.map((r) => ({
      opId: r.op_id,
      householdId: r.household_id,
      table: r.table_name,
      rowId: r.row_id,
      opType: r.op_type,
      deadLetteredAt: r.dead_lettered_at,
      retryCount: r.retry_count,
    }));
  }

  /** Requeues a dead-lettered op for the pusher: clears `dead_lettered_at` +
   * resets `retry_count`/`next_attempt_at` so the NEXT `push()` picks it up
   * immediately (it's back in `fetchPushable`'s eligible set). Guarded on
   * `dead_lettered_at IS NOT NULL` so a stale/duplicate UI action is a no-op
   * rather than clobbering an op that already pushed or was discarded.
   * Idempotent — safe to call twice. */
  retryDeadLettered(opId: string): void {
    this.db.run(sql`
      UPDATE oplog SET dead_lettered_at = NULL, retry_count = 0, next_attempt_at = NULL
      WHERE op_id = ${opId} AND dead_lettered_at IS NOT NULL
    `);
    logger.info('SyncEngine: dead-lettered op requeued for retry', { opId });
  }

  /**
   * Discards a dead-lettered op (Task 5's DLQ "discard" action, spec §6.10):
   * fetches the row's CURRENT server state via `sync_row_state` and applies
   * it locally (full replace), then removes the local op. This is the
   * "re-pull the row" half of discard — a permanently-rejected local write
   * must never leave the row silently diverged from the server forever. If
   * the server has no such row (e.g. a permanently-rejected INSERT never
   * existed server-side), the local phantom row is deleted instead, so
   * discard always converges local state to server truth.
   *
   * Idempotent — a second call for an already-discarded/retried op_id is a
   * no-op (the guarded SELECT below finds nothing). Throws (leaving the op
   * dead-lettered, untouched) if the `sync_row_state` RPC itself fails —
   * discard must never silently drop the op on a transient network error.
   */
  async discardDeadLettered(opId: string): Promise<void> {
    const op = this.db.get<{
      op_id: string;
      household_id: string;
      table_name: string;
      row_id: string;
    }>(sql`
      SELECT op_id, household_id, table_name, row_id FROM oplog
      WHERE op_id = ${opId} AND dead_lettered_at IS NOT NULL
    `);
    if (!op) return; // already discarded/retried/never existed -- idempotent no-op

    const rowState = this.transport.rowState;
    if (!rowState) {
      throw new Error('SyncEngine.discardDeadLettered: transport does not support rowState');
    }

    let state: Record<string, unknown> | null;
    try {
      state = await this.withTimeout((signal) =>
        rowState(op.household_id, op.table_name, op.row_id, signal),
      );
    } catch (err) {
      logger.warn('SyncEngine.discardDeadLettered: sync_row_state failed, op left dead-lettered', {
        opId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const table = assertIdent(op.table_name);
    this.db.transaction((tx) => {
      if (state) {
        // Full replace with the server's current row -- converges local
        // state to server truth regardless of what the rejected write left
        // behind locally.
        //
        // Intersect with the LOCAL table's real columns (SYNC-8): the server
        // row legitimately carries columns this schema does not have (e.g.
        // `envelopes.spent_cents`, derived server-side and deliberately
        // dropped locally in migration 0012), and naming a nonexistent column
        // makes the INSERT throw -- turning "discard this dead-lettered op"
        // into an unrecoverable error for exactly the tables most likely to
        // need it.
        const localColumns = this.localColumns(tx, table);
        const keys = Object.keys(state)
          .map(assertIdent)
          .filter((k) => localColumns.has(k));
        if (keys.length === 0) {
          throw new Error(
            `SyncEngine.discardDeadLettered: server row for "${table}" has no column in common with the local schema`,
          );
        }
        const colList = sql.raw(keys.join(', '));
        const values = sql.join(
          keys.map((k) => sql`${coerceValue(state![k])}`),
          sql.raw(', '),
        );
        tx.run(sql`INSERT OR REPLACE INTO ${sql.raw(table)} (${colList}) VALUES (${values})`);
      } else {
        // No server truth for this row -- remove the local phantom row so
        // discard can't leave it silently diverged forever (spec §6.10).
        tx.run(
          sql`DELETE FROM ${sql.raw(table)} WHERE id = ${op.row_id} AND household_id = ${op.household_id}`,
        );
      }
      tx.run(sql`DELETE FROM oplog WHERE op_id = ${opId}`);
    });
    logger.info('SyncEngine: dead-lettered op discarded, row refreshed from server', { opId });
  }

  /** The column names the LOCAL `table` actually has, via `PRAGMA table_info`
   * (`table` is already `assertIdent`-checked by the caller). */
  private localColumns(tx: PortableDb, table: string): Set<string> {
    const rows = tx.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`));
    return new Set(rows.map((r) => r.name));
  }

  // ----- pusher -------------------------------------------------------------

  private async drainPush(): Promise<PushSummary> {
    const summary: PushSummary = {
      batches: 0,
      applied: 0,
      deadLettered: 0,
      backedOff: 0,
      transportFailed: false,
    };

    // Households whose head-of-line op was transiently rejected during THIS
    // drain. Everything behind that op is causally downstream of it, so we
    // stop sending this household's ops for the rest of the drain rather than
    // letting a later op reach the server ahead of the one it depends on
    // (SYNC-4). The next drain re-reads state from the oplog, where the
    // rejected op's `next_attempt_at` now holds the line via `fetchPushable`.
    const stalledHouseholds = new Set<string>();

    // Households the server rejected `not_member` during THIS drain. Checked
    // (authoritatively) once the drain is over — see `checkMembershipAndEvict`.
    const membershipRejected = new Set<string>();

    for (;;) {
      const batch = this.fetchPushable(this.clock(), this.batchSize, stalledHouseholds);
      if (batch.length === 0) break;
      summary.batches += 1;
      const ops = batch.map(toWireOp);

      let results: PushResult[];
      try {
        results = await this.withTimeout((signal) => this.transport.push(ops, signal));
      } catch (err) {
        // Transient transport failure (network / 5xx / timeout / abort): NO
        // committed write is lost — every op stays unpushed and is scheduled for
        // a capped-backoff retry. No age-based discard (spec removed it). The
        // link is down, so stop draining.
        const now = this.clock();
        for (const op of batch) this.backoffOp(op.op_id, op.retry_count, now);
        summary.backedOff += batch.length;
        summary.transportFailed = true;
        logger.warn('SyncEngine.push: transport failure, batch backed off', {
          count: batch.length,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }

      const byId = new Map(results.map((r) => [r.op_id, r]));
      const now = this.clock();
      for (const op of batch) {
        const res = byId.get(op.op_id);
        if (!res) {
          // Server omitted this op from the response: treat as transient (never
          // mark it pushed — that would be a lost write).
          this.backoffOp(op.op_id, op.retry_count, now);
          summary.backedOff += 1;
          continue;
        }
        if (res.status === 'applied') {
          // R2: mark pushed ONLY for the acknowledged op_id, guarded so a
          // concurrent drain / dead-letter is never clobbered.
          this.markPushed(op.op_id, now);
          summary.applied += 1;
        } else if (res.code !== null && TRANSIENT_REJECT_CODES.has(res.code)) {
          // Known-transient (see TRANSIENT_REJECT_CODES): back off forever,
          // never dead-letter — the op is valid, its prerequisite just hasn't
          // landed. Stalls the household for the rest of this drain.
          this.backoffOp(op.op_id, op.retry_count, now);
          summary.backedOff += 1;
          stalledHouseholds.add(op.household_id);
        } else if (res.code !== null && PERMANENT_REJECT_CODES.has(res.code)) {
          this.deadLetter(op.op_id, now, res.code);
          summary.deadLettered += 1;
          // NOT added to `stalledHouseholds`: a permanent rejection is this
          // op's own verdict, not an ordering problem, so the household's
          // remaining ops keep draining this round.
          if (res.code === MEMBERSHIP_REJECT_CODE) membershipRejected.add(op.household_id);
        } else if (op.retry_count + 1 >= this.maxRejectRetries) {
          // Unexpected reject code retried to the cap -> journal it (R1: never
          // silently drop a committed write; a dead-letter is inspectable).
          this.deadLetter(op.op_id, now, res.code ?? 'unknown');
          summary.deadLettered += 1;
        } else {
          this.backoffOp(op.op_id, op.retry_count, now);
          summary.backedOff += 1;
          stalledHouseholds.add(op.household_id);
        }
      }
      // Applied -> pushed_at set; dead-lettered -> dead_lettered_at set; backed
      // off -> next_attempt_at in the future. Every processed op leaves the
      // eligible set, so the next fetch strictly shrinks and the loop drains
      // until no eligible op remains (all remaining are backing off).
    }

    // After the drain, never during it: a `not_member` rejection is the only
    // way this device can learn it has been removed from a household, but the
    // rejection alone is not proof (it is also what a household whose
    // bootstrap ops have not landed yet looks like), so each suspect gets ONE
    // authoritative check before anything local is touched.
    for (const householdId of membershipRejected) {
      await this.checkMembershipAndEvict(householdId);
    }

    return summary;
  }

  // ----- membership loss / local eviction -----------------------------------

  /**
   * Confirms, authoritatively, whether this device's user is still a member of
   * `householdId` — and if the server says they are NOT, evicts the household
   * locally (`evictHousehold`). Returns true only if an eviction happened.
   *
   * The whole point of the round trip is that the TRIGGER is not trusted. A
   * `not_member` push rejection and a permission-shaped pull error are both
   * suggestive, never conclusive; only `transport.membershipCheck` resolving
   * `false` is. Every inconclusive outcome — no transport support, network
   * failure, 5xx, timeout, abort, no signed-in user, an error shape the
   * transport did not recognise — throws out of the check and is swallowed
   * here as "do nothing", because evicting a household that the user is in
   * fact still a member of would tear a live household off their device over
   * a flaky connection.
   */
  async checkMembershipAndEvict(householdId: string): Promise<boolean> {
    // Bound to the transport: a transport may legitimately implement this as a
    // class method that uses `this` (test doubles do), and an unbound call
    // would throw and be swallowed below as "inconclusive" — silently turning
    // detection off.
    const membershipCheck = this.transport.membershipCheck?.bind(this.transport);
    if (!membershipCheck) {
      logger.warn(
        'SyncEngine: membership loss suspected but the transport cannot verify it — not evicting',
        { householdId },
      );
      return false;
    }

    let stillMember: boolean;
    try {
      stillMember = await this.withTimeout((signal) => membershipCheck(householdId, signal));
    } catch (err) {
      // Inconclusive. Deliberately NOT an eviction and NOT a retry schedule:
      // the next push that gets rejected `not_member` asks again.
      logger.warn('SyncEngine: membership check inconclusive — not evicting', {
        householdId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    if (stillMember) {
      logger.info('SyncEngine: membership check says still a member — no eviction', {
        householdId,
      });
      return false;
    }

    return this.evictHousehold(householdId);
  }

  /**
   * Makes a household this device is no longer a member of UNREACHABLE
   * locally, in ONE transaction, and announces it once.
   *
   * What it does, and why each part:
   *   - soft-deletes this user's local `household_members` row WITHOUT
   *     appending an oplog op. The server already holds the truth (it is the
   *     one that removed them); an op would be a push this device is no
   *     longer entitled to make, rejected `not_member`, dead-lettered. This
   *     is also what stops `EnsureHouseholdUseCase` resurrecting the
   *     household on the next cold start.
   *   - dead-letters the household's remaining UNPUSHED ops instead of
   *     leaving them to be re-pushed and rejected one by one forever. They
   *     are journaled, not dropped (R1): still listed by `listDeadLettered`,
   *     so nothing committed is silently lost if the user is re-invited.
   *   - drops the pull cursor, so a re-invite restores from seq 0 rather than
   *     resuming mid-stream past ops it never applied.
   *
   * It deliberately does NOT delete the household's financial rows: if the
   * user is re-invited, `RestoreService` reconciles them, and a wrongly
   * triggered eviction must not be able to destroy data.
   *
   * Idempotent: the active-membership-row probe is the guard, so a second
   * call is a no-op that announces nothing.
   */
  evictHousehold(householdId: string): boolean {
    const userId = getSyncWriteDefaults().actorUserId;
    if (!userId) {
      // Without an actor there is no way to know WHOSE membership row to
      // retire, and a signed-out process should not be syncing at all.
      logger.error(
        'SyncEngine.evictHousehold: no actor user id installed — refusing to evict',
        new Error('missing actorUserId'),
        { householdId },
      );
      return false;
    }

    const now = this.clock();
    const evicted = this.db.transaction((tx) => {
      const active = tx.get(sql`
        SELECT 1 AS x FROM household_members
        WHERE household_id = ${householdId} AND user_id = ${userId} AND deleted_at IS NULL
      `);
      if (!active) return false; // already evicted (or never joined here) -- no-op, no event

      tx.run(sql`
        UPDATE household_members SET deleted_at = ${now}
        WHERE household_id = ${householdId} AND user_id = ${userId} AND deleted_at IS NULL
      `);
      tx.run(sql`
        UPDATE oplog SET dead_lettered_at = ${now}
        WHERE household_id = ${householdId} AND pushed_at IS NULL AND dead_lettered_at IS NULL
      `);
      tx.run(sql`DELETE FROM sync_cursor WHERE household_id = ${householdId}`);
      return true;
    });

    if (!evicted) {
      logger.info('SyncEngine.evictHousehold: already evicted locally, nothing to do', {
        householdId,
      });
      return false;
    }

    // In-memory puller state for a household this device can no longer read.
    this.pullBackoff.delete(householdId);
    this.pullApplyFailures.delete(householdId);
    this.pullBlocked.delete(householdId);

    logger.warn('SyncEngine: household evicted locally — this device is no longer a member', {
      householdId,
    });
    // AFTER the commit, so every listener sees a local DB that already
    // reflects the eviction.
    publishHouseholdEviction({ householdId, detectedAt: now });
    return true;
  }

  /**
   * The next eligible ops to push, oldest-first, with CAUSAL ORDER preserved
   * per household (SYNC-4).
   *
   * The `NOT EXISTS` clause is the head-of-line rule: an op is eligible only
   * while NO EARLIER unpushed, non-dead-lettered op of the same household is
   * still inside its backoff window. Without it, per-op backoff reorders a
   * household's stream — an `insert` that transiently failed sits out its
   * backoff while the `update`/`delete` for the SAME row is pushed ahead of
   * it and is rejected against a row the server has never seen (permanently
   * dead-lettered as `wrong_household` before the server grew `row_missing`).
   *
   * "Earlier" is `rowid`: the local oplog is append-only and `seq_local` is
   * never populated by the writer, so insertion order IS rowid order — the
   * same order the `ORDER BY` below drains in. `household_id IS` (not `=`)
   * so the comparison also groups the NULL-household ops correctly.
   *
   * `stalled` households are excluded outright — see `drainPush`.
   */
  private fetchPushable(
    nowIso: string,
    limit: number,
    stalled: ReadonlySet<string> = new Set(),
  ): PushableOp[] {
    const stalledClause =
      stalled.size > 0
        ? sql`AND (o.household_id IS NULL OR o.household_id NOT IN (${sql.join(
            [...stalled].map((h) => sql`${h}`),
            sql.raw(', '),
          )}))`
        : sql``;

    // One extra row so the batch-boundary check below can look at the op that
    // WOULD have been first in the next batch without a second query.
    const rows = this.db.all<PushableOp>(sql`
      SELECT op_id, household_id, table_name, row_id, op_type, payload,
             actor_user_id, device_id, client_created_at, retry_count
      FROM oplog AS o
      WHERE pushed_at IS NULL
        AND dead_lettered_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${nowIso})
        ${stalledClause}
        AND NOT EXISTS (
          SELECT 1 FROM oplog AS earlier
          WHERE earlier.household_id IS o.household_id
            AND earlier.rowid < o.rowid
            AND earlier.pushed_at IS NULL
            AND earlier.dead_lettered_at IS NULL
            AND earlier.next_attempt_at IS NOT NULL
            AND earlier.next_attempt_at > ${nowIso}
        )
      ORDER BY seq_local ASC, rowid ASC
      LIMIT ${limit + 1}
    `);

    if (rows.length <= limit) return rows;
    return trimHouseholdBootstrapSplit(rows, limit);
  }

  private markPushed(opId: string, pushedAtIso: string): void {
    // R2 guard: `pushed_at IS NULL` ensures we mark exactly the version we
    // pushed (oplog ops are append-only + immutable — a later edit is a NEW op,
    // never a mutation of this one — so this closes the double-drain race).
    this.db.run(sql`
      UPDATE oplog SET pushed_at = ${pushedAtIso}
      WHERE op_id = ${opId} AND pushed_at IS NULL AND dead_lettered_at IS NULL
    `);
  }

  private backoffOp(opId: string, currentRetryCount: number, nowIso: string): void {
    const next = nextAttemptAt(currentRetryCount, this.backoffBaseMs, this.backoffMaxMs, nowIso);
    this.db.run(sql`
      UPDATE oplog SET retry_count = retry_count + 1, next_attempt_at = ${next}
      WHERE op_id = ${opId} AND pushed_at IS NULL AND dead_lettered_at IS NULL
    `);
  }

  private deadLetter(opId: string, deadAtIso: string, code: string): void {
    // Guard matches markPushed/backoffOp: `dead_lettered_at IS NULL` (in
    // addition to `pushed_at IS NULL`) so a second pass over the same op
    // (e.g. a concurrent drain) can't re-stamp/re-bump an already
    // dead-lettered op.
    this.db.run(sql`
      UPDATE oplog SET dead_lettered_at = ${deadAtIso}, retry_count = retry_count + 1
      WHERE op_id = ${opId} AND pushed_at IS NULL AND dead_lettered_at IS NULL
    `);
    logger.warn('SyncEngine.push: op dead-lettered', { opId, code });
  }

  // ----- puller -------------------------------------------------------------

  private async drainPull(householdId: string): Promise<PullSummary> {
    const summary: PullSummary = {
      batches: 0,
      applied: 0,
      blocked: false,
      transportFailed: false,
    };

    // POISON BATCH: already flagged blocked for this household — a batch that
    // needs a code fix (schema drift) is never retried automatically, so
    // don't even contact the transport (§7.2).
    if (this.pullBlocked.has(householdId)) {
      summary.blocked = true;
      return summary;
    }

    // Transient backoff (mirrors the pusher's capped exponential backoff):
    // skip the network entirely until this household's next scheduled
    // attempt.
    const backoff = this.pullBackoff.get(householdId);
    if (backoff && Date.parse(this.clock()) < backoff.nextAttemptAtMs) {
      return summary;
    }

    let cursor = this.readCursor(householdId);

    for (;;) {
      let rows: ServerOplogRow[];
      try {
        rows = await this.withTimeout((signal) =>
          this.transport.pull(householdId, cursor, this.pullLimit, signal),
        );
      } catch (err) {
        // Transient transport failure (network / 5xx / timeout / abort): no
        // committed write is lost — ops stay server-side and re-pullable.
        // Back off THIS household's next pull attempt (capped exponential,
        // mirrors the pusher) and stop draining this cycle. Never throw out
        // of pull() (§7.2) — letting it propagate would repeatedly hammer a
        // flaky link every time the trigger loop calls pull() again.
        this.backoffTransientPull(householdId, err);
        summary.transportFailed = true;
        // A permission-SHAPED failure is the other place membership loss
        // could surface (see PERMISSION_ERROR_RE for why it currently cannot
        // on this server). The answer still comes from the authoritative
        // check, so an ordinary network failure — which never matches this
        // predicate — can never evict.
        if (isPermissionShapedError(err)) {
          await this.checkMembershipAndEvict(householdId);
        }
        break;
      }
      if (rows.length === 0) break;
      summary.batches += 1;

      let res: { cursor: number; applied: number };
      try {
        res = this.applyPulledBatch(householdId, rows);
      } catch (err) {
        // Local apply failed for THIS batch. Cursor-in-transaction (R6) means
        // it did NOT advance — the ops are still server-side and re-pullable,
        // so no data is lost. Unlike the transport catch above, this is an
        // actual applyOne throw — on a matured protocol that means
        // client/server schema drift, a code-fix situation, not a condition a
        // retry alone will resolve. Track it as a poison-batch candidate and
        // stop draining (§7.2).
        this.recordPullApplyFailure(householdId, cursor, rows, err);
        if (this.pullBlocked.has(householdId)) summary.blocked = true;
        break;
      }
      // Forward progress: any earlier backoff/poison-batch tracking for this
      // household is stale.
      this.pullBackoff.delete(householdId);
      this.pullApplyFailures.delete(householdId);
      summary.applied += res.applied;
      cursor = res.cursor;
      if (rows.length < this.pullLimit) break;
    }

    return summary;
  }

  /** Transient pull-transport failure: capped exponential backoff for this
   * household's NEXT pull attempt, mirroring the pusher's backoff exactly
   * (`min(backoffMaxMs, backoffBaseMs * 2^retryCount)`). */
  private backoffTransientPull(householdId: string, err: unknown): void {
    const prev = this.pullBackoff.get(householdId);
    const currentRetryCount = prev?.retryCount ?? 0;
    const nextIso = nextAttemptAt(
      currentRetryCount,
      this.backoffBaseMs,
      this.backoffMaxMs,
      this.clock(),
    );
    this.pullBackoff.set(householdId, {
      retryCount: currentRetryCount + 1,
      nextAttemptAtMs: Date.parse(nextIso),
    });
    logger.warn('SyncEngine.pull: transport failure, backed off', {
      householdId,
      retryCount: currentRetryCount + 1,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  /** Records a local-apply failure for the batch read from `cursor`. After
   * `maxPullApplyRetries` consecutive failures of the SAME batch, flags the
   * household "pull blocked" (poison batch) instead of retrying forever. */
  private recordPullApplyFailure(
    householdId: string,
    cursor: number,
    rows: ServerOplogRow[],
    err: unknown,
  ): void {
    const prev = this.pullApplyFailures.get(householdId);
    const attempts = prev && prev.cursor === cursor ? prev.attempts + 1 : 1;
    this.pullApplyFailures.set(householdId, { cursor, attempts });
    const opIds = rows.map((r) => r.op_id);

    if (attempts >= this.maxPullApplyRetries) {
      // POISON BATCH (§7.2): the SAME batch (same cursor position) has now
      // failed to apply `maxPullApplyRetries` times in a row. Stop retrying
      // automatically (never hammer forever) but never advance the cursor
      // either (never skip/lose the ops — R1 in spirit). Surface it for Task
      // 5's Sync Health UI via getPullHealth(). §7.4: op_ids + error, NEVER
      // the payload (financial data).
      this.pullBlocked.set(householdId, {
        opIds,
        error: err instanceof Error ? err.message : String(err),
        blockedAt: this.clock(),
      });
      logger.error(
        'SyncEngine.pull: batch blocked after repeated local-apply failures ' +
          '(poison batch — likely client/server schema drift; needs a code fix, not a retry)',
        err,
        { householdId, opIds, attempts },
      );
    } else {
      logger.warn('SyncEngine.pull: batch failed to apply, will retry', {
        householdId,
        opIds,
        attempts,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private readCursor(householdId: string): number {
    const row = this.db.get<{ s: number | null }>(
      sql`SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ${householdId}`,
    );
    return row && row.s != null ? Number(row.s) : 0;
  }

  /**
   * Applies one pulled batch and advances the cursor IN ONE TRANSACTION (R6).
   * Ops are already `seq`-ordered by the server (R8). Idempotent per op_id via
   * `oplog_applied` (R5). Any throw rolls back BOTH the applied rows AND the
   * cursor advance — the cursor never leads the data.
   *
   * CONVERGENCE (H4/M5): absolute-value ops (`insert`/`update`/`delete`) are
   * re-applied FROM THE OPLOG in server-`seq` order even for THIS device's own
   * ops. The server oplog `seq` is the single authoritative total order; every
   * replica replays the exact same op sequence and therefore converges to the
   * same final value (the highest-seq write wins). The previous "skip all own
   * ops" shortcut applied an own op only at local creation time and NEVER
   * re-interleaved it against concurrent remote ops in seq order, so a lower-seq
   * remote op could permanently overwrite this device's own higher-seq write
   * with no self-heal (the H4 divergence). Re-applying an own `insert`
   * (INSERT OR IGNORE) or `update` (idempotent value-set) is a safe no-op or a
   * same-value write; `oplog_applied` still makes a re-delivered op a no-op.
   *
   * `increment` is the ONE exception: it is commutative but NOT idempotent, and
   * an own increment was already folded into local state at creation time — so
   * re-applying an own increment would DOUBLE-COUNT the delta (money
   * corruption). Own increments therefore stay skipped; remote increments
   * commute into the same total regardless of arrival order.
   */
  private applyPulledBatch(
    householdId: string,
    rows: ServerOplogRow[],
  ): { cursor: number; applied: number } {
    const fallbackNow = this.clock();
    // Side effects the batch produced that the caller must act on AFTER the
    // transaction commits (never inside it).
    const effects: ApplyEffects = { queuedLocalOps: false };
    const result = this.db.transaction((tx) => {
      let maxSeq = 0;
      let applied = 0;
      for (const row of rows) {
        const seq = Number(row.seq);
        if (seq > maxSeq) maxSeq = seq;
        // Own increments only: already folded in locally + non-idempotent.
        if (row.op_type === 'increment' && this.isOwnIncrement(tx, row)) continue;
        const seen = tx.get(sql`SELECT 1 AS x FROM oplog_applied WHERE op_id = ${row.op_id}`);
        if (seen) continue; // R5: already applied -> no-op
        tx.run(sql`INSERT OR IGNORE INTO oplog_applied (op_id) VALUES (${row.op_id})`);
        if (this.applyOne(tx, row, fallbackNow, effects)) applied += 1;
      }
      // Cursor advance — SAME transaction as the applied ops. MAX() keeps it
      // monotonic so it can never regress on a re-pull.
      tx.run(sql`
        INSERT INTO sync_cursor (household_id, last_pulled_seq) VALUES (${householdId}, ${maxSeq})
        ON CONFLICT (household_id) DO UPDATE
          SET last_pulled_seq = MAX(sync_cursor.last_pulled_seq, excluded.last_pulled_seq)
      `);
      return { cursor: maxSeq, applied };
    });

    // A SYNC-5 demotion appended a local `update` op inside the committed
    // transaction above. Wake the after-write trigger so it is pushed on the
    // next round rather than waiting for an unrelated one — bounded, because
    // once the household has a single active EMF the rule stops matching.
    if (effects.queuedLocalOps) notifyOplogWrite(householdId);

    return result;
  }

  /**
   * True if this pulled `increment` op was AUTHORED BY THIS DEVICE and is
   * therefore already folded into local state — re-applying it would
   * double-count the delta (money corruption, SYNC-1).
   *
   * The ONLY evidence accepted is that the op's `op_id` is in THIS device's
   * local oplog — an op can only get there by being written here. `device_id`
   * is deliberately NOT consulted (SEC2-11): it is attacker-controlled wire
   * data, so a household member who stamps a partner's device id on their own
   * increment would make that partner's device skip a REAL remote increment
   * and silently lose the money. The op_id rule also covers the case the
   * device-id comparison used to exist for — ops written by SHIPPED builds
   * before `setSyncWriteDefaults` existed carry the `UNASSIGNED_DEVICE_ID`
   * placeholder rather than this install's real id, and they are in the local
   * oplog just the same.
   *
   * (Ops written from now on are additionally recorded in `oplog_applied` at
   * write time — see `runInUnitOfWork` — so the `seen` check below catches
   * them regardless of attribution. This stays as the ledger-independent
   * backstop and the migration path for already-pushed history.)
   */
  private isOwnIncrement(tx: PortableDb, row: ServerOplogRow): boolean {
    return tx.get(sql`SELECT 1 AS x FROM oplog WHERE op_id = ${row.op_id}`) != null;
  }

  /**
   * SYNC-5. An inbound ACTIVE `emergency_fund` envelope can collide with one
   * this device already has (two members each created one offline) — a
   * violation of the local partial unique index from migration 0013, NOT of
   * the row's primary key. `INSERT OR IGNORE` cannot tell those apart, so it
   * silently dropped the other member's envelope.
   *
   * Runs the shared deterministic rule instead (see emergencyFundConflict.ts)
   * and returns the payload to write, with `envelope_type` rewritten to
   * whatever that rule says this row must be stored as. Any demotion of the
   * LOCAL row happens inside the same transaction as this batch, with its own
   * `update` op so it replicates.
   *
   * Applied to `update` as well as `insert`: an update that flips a row TO
   * emergency_fund hits the same index and would otherwise throw and poison
   * the batch.
   */
  private resolveEmergencyFundType(
    tx: PortableDb,
    table: string,
    row: ServerOplogRow,
    fallbackNow: string,
    effects: ApplyEffects,
  ): Record<string, unknown> {
    const payload = row.payload ?? {};
    if (table !== 'envelopes') return payload;
    if (row.op_type !== 'insert' && row.op_type !== 'update') return payload;
    if (!isActiveEmergencyFund(payload)) return payload;

    const before = this.countLocalOps(tx);
    const storedType = resolveIncomingEmergencyFund(tx, {
      householdId: row.household_id,
      incomingId: row.row_id,
      incomingCreatedAt: typeof payload.created_at === 'string' ? payload.created_at : fallbackNow,
      ctx: {
        deviceId: this.deviceId,
        actorUserId: getSyncWriteDefaults().actorUserId,
        clock: this.clock,
      },
    });
    if (this.countLocalOps(tx) > before) effects.queuedLocalOps = true;
    return { ...payload, envelope_type: storedType };
  }

  /** Total rows in the local oplog — used only to detect that the
   * emergency-fund rule queued a demotion op for pushing. */
  private countLocalOps(tx: PortableDb): number {
    const row = tx.get<{ c: number }>(sql`SELECT COUNT(*) AS c FROM oplog`);
    return row ? Number(row.c) : 0;
  }

  /**
   * Applies one inbound op to the local entity table, and returns whether it
   * actually wrote anything (`false` = deliberately skipped, see below).
   *
   * FORWARD COMPATIBILITY (REG-1 / VAL2-0). The payload and `table_name` come
   * from whatever build the authoring household mate is on, which can be
   * NEWER than this one: a 1.1.130 device writing `envelope_contributions`
   * makes a 1.1.122 device build `INSERT INTO envelope_contributions ...`,
   * SQLite throws "no such table", the whole batch rolls back (R6), and after
   * `maxPullApplyRetries` the household is pull-blocked on this device
   * permanently — no partner data of ANY kind arrives again until the user
   * updates. The same happens for one unknown COLUMN on a known table.
   *
   * So an op this schema cannot represent is skipped rather than thrown:
   *  - unknown table  — nothing local to write, skip the whole op;
   *  - known table    — write the intersection of the payload keys with the
   *                     real local columns (same rule `discardDeadLettered`
   *                     already applies via `localColumns`).
   * The caller still records the op in `oplog_applied` and still advances the
   * cursor, so the household keeps syncing everything it CAN represent. The
   * skipped rows are not lost: they arrive for real once this client ships
   * the migration and the household is re-restored/re-pulled from 0.
   *
   * Each distinct unknown table/column is logged once per session — a newer
   * mate produces these on every single pull otherwise. Never the payload
   * itself (§7.4).
   */
  private applyOne(
    tx: PortableDb,
    row: ServerOplogRow,
    fallbackNow: string,
    effects: ApplyEffects,
  ): boolean {
    const table = assertIdent(row.table_name);
    const columns = this.localColumns(tx, table);
    if (columns.size === 0) {
      // `PRAGMA table_info` returns no rows for a table that does not exist.
      this.logSkipOnce(this.loggedUnknownTables, table, 'table', { table });
      return false;
    }
    const payload = this.resolveEmergencyFundType(tx, table, row, fallbackNow, effects);

    if (row.op_type === 'insert') {
      const keys = this.localPayloadKeys(table, payload, columns);
      const cols = ['id', 'household_id', ...keys];
      const colList = sql.raw(cols.join(', '));
      const values = sql.join(
        [
          sql`${row.row_id}`,
          sql`${row.household_id}`,
          ...keys.map((k) => sql`${coerceValue(payload[k])}`),
        ],
        sql.raw(', '),
      );
      // ON CONFLICT DO NOTHING mirrors the server's insert idempotency.
      tx.run(sql`INSERT OR IGNORE INTO ${sql.raw(table)} (${colList}) VALUES (${values})`);
    } else if (row.op_type === 'update') {
      const keys = this.localPayloadKeys(table, payload, columns);
      if (keys.length > 0) {
        const setClause = sql.join(
          keys.map((k) => sql`${sql.raw(k)} = ${coerceValue(payload[k])}`),
          sql.raw(', '),
        );
        tx.run(
          sql`UPDATE ${sql.raw(table)} SET ${setClause} WHERE id = ${row.row_id} AND household_id = ${row.household_id}`,
        );
      }
    } else if (row.op_type === 'delete') {
      // R4 + M5: stamp the ORIGIN's deleted_at so replicas converge on one
      // tombstone; never re-stamp to a local "now". This is now applied for
      // OWN delete ops too (own-skip is restricted to `increment` above), so a
      // concurrent double-delete converges by LAST-WRITER-BY-SEQ: both replicas
      // replay [op_lo, op_hi] in the same server-`seq` order and both end on the
      // higher-seq op's tombstone value — closing the M5 divergence where each
      // replica kept the OTHER device's timestamp because it skipped its own op.
      //
      // NOTE (deliberate, see .superpowers/sdd/fix-sync-report.md): a
      // `deleted_at IS NULL` guard is intentionally NOT added. The server's own
      // delete apply (private.apply_one_op, migration 0002) is an UNCONDITIONAL
      // `SET deleted_at = now()` with no guard — last-writer-by-seq. A client
      // IS NULL guard would (a) make the client's ordering rule DIVERGE from the
      // server's and (b) fail to converge a double-delete anyway, because each
      // device already stamped its OWN tombstone at local creation time, so the
      // guard would just freeze each replica on its own value. Unconditional
      // seq-ordered replay is what actually converges both replicas AND matches
      // the server. delete-wins stays terminal: nothing in the domain clears
      // deleted_at, and a re-create is INSERT OR IGNORE (a no-op on the
      // tombstoned row).
      if (!columns.has('deleted_at')) {
        this.logSkipOnce(this.loggedUnknownColumns, `${table}.deleted_at`, 'column', {
          table,
          column: 'deleted_at',
        });
        return false;
      }
      const deletedAt = typeof payload.deleted_at === 'string' ? payload.deleted_at : fallbackNow;
      tx.run(
        sql`UPDATE ${sql.raw(table)} SET deleted_at = ${deletedAt} WHERE id = ${row.row_id} AND household_id = ${row.household_id}`,
      );
    } else if (row.op_type === 'increment') {
      const field = assertIdent(String(payload.field));
      if (!columns.has(field)) {
        this.logSkipOnce(this.loggedUnknownColumns, `${table}.${field}`, 'column', {
          table,
          column: field,
        });
        return false;
      }
      const delta = Number(payload.delta);
      if (!Number.isFinite(delta)) {
        // Money-column guard: `field` here is always an integer-cents money
        // column. A malformed/non-numeric delta must never reach the
        // arithmetic expression below (that would write NULL/NaN into it) —
        // throw so the whole batch rolls back and fails safe instead of
        // committing corrupt money state. (Never log payload.delta itself —
        // §7.4 forbids logging op payloads.)
        throw new Error(`SyncEngine: increment op ${row.op_id} has a non-finite delta`);
      }
      const expr =
        payload.clamp === 'floor_zero'
          ? sql`MAX(0, ${sql.raw(field)} + ${delta})`
          : sql`${sql.raw(field)} + ${delta}`;
      tx.run(
        sql`UPDATE ${sql.raw(table)} SET ${sql.raw(field)} = ${expr} WHERE id = ${row.row_id} AND household_id = ${row.household_id}`,
      );
      // M6: debts.is_paid_off is a SERVER-derived column (a BEFORE UPDATE
      // trigger sets it to `outstanding_balance_cents <= 0` on every write —
      // see supabase/migrations/0001_baseline.sql §9g). The local SQLite schema
      // has no such trigger, so an increment that zeros the balance on a
      // NON-origin device would leave is_paid_off stale (0 at balance 0),
      // diverging from the server and mis-rendering the "PAID OFF" badge / Log
      // Payment affordance. Mirror the server trigger (and the origin device's
      // in-statement compute in LogDebtPaymentUseCase) locally so the flag
      // matches the balance this op just wrote.
      if (table === 'debts' && field === 'outstanding_balance_cents') {
        tx.run(
          sql`UPDATE debts SET is_paid_off = (outstanding_balance_cents <= 0) WHERE id = ${row.row_id} AND household_id = ${row.household_id}`,
        );
      }
    } else {
      throw new Error(`SyncEngine: unsupported pulled op_type "${row.op_type}"`);
    }
    return true;
  }

  /** The payload keys this local schema actually has a column for, in payload
   * order. Anything else is a column a newer build added (see `applyOne`) and
   * is dropped with a one-per-session breadcrumb rather than being named in an
   * INSERT/UPDATE that would throw and poison the batch. */
  private localPayloadKeys(
    table: string,
    payload: Record<string, unknown>,
    columns: ReadonlySet<string>,
  ): string[] {
    const keys: string[] = [];
    for (const key of Object.keys(payload).map(assertIdent)) {
      if (columns.has(key)) {
        keys.push(key);
      } else {
        this.logSkipOnce(this.loggedUnknownColumns, `${table}.${key}`, 'column', {
          table,
          column: key,
        });
      }
    }
    return keys;
  }

  /** One warning per distinct unknown table/column per session — a household
   * mate on a newer build produces the same skip on every pull otherwise. */
  private logSkipOnce(
    seen: Set<string>,
    key: string,
    kind: 'table' | 'column',
    meta: Record<string, string>,
  ): void {
    if (seen.has(key)) return;
    seen.add(key);
    logger.warn(
      `SyncEngine: pulled op names a ${kind} this app version does not have — skipped, sync continues`,
      meta,
    );
  }

  // ----- single-flight + timeout -------------------------------------------

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.inFlight.has(key)) {
      logger.info('SyncEngine: single-flight skip', { key });
      return undefined;
    }
    this.inFlight.add(key);
    try {
      return await fn();
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Production transport: drives the real `sync_push` / `sync_pull` RPCs.
// ---------------------------------------------------------------------------

export function createSupabaseSyncTransport(supabase: SupabaseClient): SyncTransport {
  return {
    async push(ops, signal): Promise<PushResult[]> {
      const { data, error } = await supabase.rpc('sync_push', { p_ops: ops }).abortSignal(signal);
      if (error) throw new Error(`sync_push failed: ${error.message}`);
      return (data ?? []) as PushResult[];
    },
    async pull(householdId, afterSeq, limit, signal): Promise<ServerOplogRow[]> {
      const { data, error } = await supabase
        .rpc('sync_pull', {
          p_household_id: householdId,
          p_after_seq: afterSeq,
          p_limit: limit,
        })
        .abortSignal(signal);
      if (error) throw new Error(`sync_pull failed: ${error.message}`);
      return (data ?? []) as ServerOplogRow[];
    },
    async rowState(householdId, table, rowId, signal): Promise<Record<string, unknown> | null> {
      const { data, error } = await supabase
        .rpc('sync_row_state', {
          p_household_id: householdId,
          p_table: table,
          p_row_id: rowId,
        })
        .abortSignal(signal);
      if (error) throw new Error(`sync_row_state failed: ${error.message}`);
      return (data ?? null) as Record<string, unknown> | null;
    },
    async membershipCheck(householdId, signal): Promise<boolean> {
      // Primary: `public.list_household_members` (0011) raises 42501 for a
      // caller who is not an ACTIVE member, and succeeds for one who is. It
      // is the cheapest call that gives an explicit, authoritative answer.
      const { error } = await supabase
        .rpc('list_household_members', { p_household_id: householdId })
        .abortSignal(signal);
      if (!error) return true;

      if (isNotAMemberError(error)) return false;

      if (isMissingFunctionError(error)) {
        // Fallback for a client running ahead of the deployed schema (0011
        // not applied yet): read the caller's OWN membership row directly.
        // RLS (`private.is_household_member`) makes this return zero rows for
        // a non-member, which is the same authoritative answer.
        const userId = (await supabase.auth.getSession()).data.session?.user.id;
        if (!userId) {
          throw new Error('membership_check failed: no signed-in user');
        }
        const { data: rows, error: selectError } = await supabase
          .from('household_members')
          .select('id')
          .eq('household_id', householdId)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .limit(1)
          .abortSignal(signal);
        if (selectError) {
          throw new Error(`membership_check fallback failed: ${selectError.message}`);
        }
        return (rows ?? []).length > 0;
      }

      // Anything else (network, 5xx, timeout, abort, an unrecognised shape)
      // is INCONCLUSIVE — throw so the engine does not evict. See
      // SyncTransport.membershipCheck's three-valued contract.
      throw new Error(`membership_check failed: ${error.message}`);
    },
  };
}

/** The PostgREST error fields this module inspects. Structural so neither the
 * engine nor its tests need to import `PostgrestError`. */
interface TransportErrorLike {
  code?: string;
  message?: string;
}

/** An explicit "you are not a member" from `list_household_members`: the RPC
 * raises `insufficient_privilege` (SQLSTATE 42501), which PostgREST surfaces
 * as `code: '42501'`. The message is checked too because some gateway
 * versions forward only the message. */
function isNotAMemberError(error: TransportErrorLike): boolean {
  if (error.code === '42501') return true;
  return (error.message ?? '').toLowerCase().includes('not a member of this household');
}

/** The RPC does not exist on this server — migration 0011 has not been
 * deployed yet. PostgREST reports an unknown function as `PGRST202`. */
function isMissingFunctionError(error: TransportErrorLike): boolean {
  if (error.code === 'PGRST202') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('could not find the function') || message.includes('schema cache');
}

/** Convenience: builds a `SyncEngine` wired to the supabase RPC transport. */
export function createSyncEngine(deps: {
  supabase: SupabaseClient;
  db: PortableDb;
  deviceId: string;
  clock?: () => string;
  options?: SyncEngineOptions;
}): SyncEngine {
  return new SyncEngine({
    db: deps.db,
    transport: createSupabaseSyncTransport(deps.supabase),
    deviceId: deps.deviceId,
    clock: deps.clock,
    options: deps.options,
  });
}

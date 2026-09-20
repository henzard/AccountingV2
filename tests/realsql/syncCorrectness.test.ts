// tests/realsql/syncCorrectness.test.ts
//
// Regression tier for the client sync-layer money bugs (SYNC-1/2/3/4/8).
// Everything here runs against a REAL migrated better-sqlite3 database and
// the REAL production write path — the use case with its DEFAULT deps, the
// real `createSyncedRepo`/`runInUnitOfWork`, the real `SyncEngine` — with only
// the network transport faked. No Postgres needed.

import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { makeFakeSupabase } from '../support/fakeRestoreDb';
import { sql } from 'drizzle-orm';
import { runInUnitOfWork, type PortableDb } from '../../src/data/uow/UnitOfWork';
import {
  assertRunMatchedRow,
  createSyncedRepo,
  isRowNotMatchedError,
  type SyncedRepoCtx,
} from '../../src/data/uow/createSyncedRepo';
import {
  SyncEngine,
  type PushResult,
  type ServerOplogRow,
  type SyncTransport,
  type WireOp,
} from '../../src/data/sync/SyncEngine';
import { RestoreService } from '../../src/data/sync/RestoreService';
import { LogDebtPaymentUseCase } from '../../src/domain/debtSnowball/LogDebtPaymentUseCase';
import type { DebtEntity } from '../../src/domain/debtSnowball/DebtEntity';
import type { AuditLogger } from '../../src/data/audit/AuditLogger';
import {
  setSyncWriteDefaults,
  clearSyncWriteDefaults,
  UNASSIGNED_DEVICE_ID,
} from '../../src/domain/shared/syncWrite';
import type * as schema from '../../src/data/local/schema';
import type { SupabaseClient } from '@supabase/supabase-js';

const NOW = '2026-01-01T00:00:00.000Z';
const HH = 'hh-1';
const DEVICE = 'device-A-real-uuid';

function seedHousehold(raw: Database.Database, id = HH): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test HH', 25, ?, ?)`,
    )
    .run(id, NOW, NOW);
}

function seedDebt(raw: Database.Database, balanceCents: number, id = 'd1'): void {
  raw
    .prepare(
      `INSERT INTO debts (id, household_id, creditor_name, debt_type,
                          outstanding_balance_cents, interest_rate_percent,
                          minimum_payment_cents, total_paid_cents, created_at, updated_at)
       VALUES (?, ?, 'Visa', 'credit_card', ?, 19.9, 5000, 0, ?, ?)`,
    )
    .run(id, HH, balanceCents, NOW, NOW);
}

function readDebt(raw: Database.Database, id = 'd1'): { balance: number; paid: number } {
  const row = raw
    .prepare('SELECT outstanding_balance_cents AS b, total_paid_cents AS p FROM debts WHERE id = ?')
    .get(id) as { b: number; p: number };
  return { balance: row.b, paid: row.p };
}

function debtEntity(balanceCents: number): DebtEntity {
  return {
    id: 'd1',
    householdId: HH,
    creditorName: 'Visa',
    debtType: 'credit_card',
    outstandingBalanceCents: balanceCents,
    initialBalanceCents: balanceCents,
    interestRatePercent: 19.9,
    minimumPaymentCents: 5000,
    sortOrder: 0,
    isPaidOff: false,
    totalPaidCents: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** AuditLogger writes local-only rows this suite does not assert on. */
const noopAudit = { log: async (): Promise<void> => {} } as unknown as AuditLogger;

/**
 * A transport backed by a tiny in-memory "server oplog": pushed ops are
 * assigned an increasing `seq` and handed straight back by `pull`, exactly
 * like the real `sync_push`/`sync_pull` pair. This is what makes the
 * double-count reproducible offline — the bug IS "push then pull my own ops".
 */
class LoopbackTransport implements SyncTransport {
  readonly serverOplog: ServerOplogRow[] = [];
  readonly pushed: WireOp[] = [];
  rowStateResult: Record<string, unknown> | null = null;

  async push(ops: WireOp[]): Promise<PushResult[]> {
    this.pushed.push(...ops);
    for (const op of ops) {
      this.serverOplog.push({
        seq: this.serverOplog.length + 1,
        op_id: op.op_id,
        household_id: op.household_id,
        table_name: op.table,
        row_id: op.row_id,
        op_type: op.op_type,
        payload: op.payload,
        device_id: op.device_id,
      });
    }
    return ops.map((o) => ({ op_id: o.op_id, status: 'applied' as const, code: null }));
  }

  async pull(householdId: string, afterSeq: number, limit: number): Promise<ServerOplogRow[]> {
    return this.serverOplog
      .filter((r) => r.household_id === householdId && Number(r.seq) > afterSeq)
      .slice(0, limit);
  }

  // Arrow property, not a prototype method: `SyncEngine.discardDeadLettered`
  // pulls `transport.rowState` off and calls it unbound (the production
  // transport is an object literal that never touches `this`).
  rowState = async (): Promise<Record<string, unknown> | null> => this.rowStateResult;
}

function engineFor(
  raw: Database.Database,
  transport: SyncTransport,
  deviceId = DEVICE,
  batchSize = 50,
): SyncEngine {
  return new SyncEngine({
    db: drizzle(raw) as unknown as PortableDb,
    transport,
    deviceId,
    clock: () => NOW,
    options: { batchSize, backoffBaseMs: 1000, backoffMaxMs: 60000, maxRejectRetries: 5 },
  });
}

afterEach(() => {
  clearSyncWriteDefaults();
});

// ---------------------------------------------------------------------------
// SYNC-1 — the production composition must not double-count a payment
// ---------------------------------------------------------------------------

describe('SYNC-1: own increments survive a push→pull round unchanged', () => {
  it('LogDebtPaymentUseCase with DEFAULT deps + an engine on the real device id leaves the balance alone', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);
    const db = drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>;

    // Exactly what App.tsx does on the local boot gate.
    setSyncWriteDefaults({ deviceId: DEVICE, actorUserId: 'user-1' });

    // DEFAULT deps — no test-only device id injected anywhere.
    const result = await new LogDebtPaymentUseCase(db, noopAudit, {
      householdId: HH,
      debtId: 'd1',
      paymentAmountCents: 50_000,
      currentDebt: debtEntity(100_000),
    }).execute();
    expect(result.success).toBe(true);
    expect(readDebt(raw)).toEqual({ balance: 50_000, paid: 50_000 });

    // The ops must be attributed to the SAME device the engine runs as —
    // that equality is the whole own-skip mechanism.
    const ops = raw.prepare('SELECT device_id, op_type FROM oplog').all() as {
      device_id: string;
      op_type: string;
    }[];
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.device_id === DEVICE)).toBe(true);

    const transport = new LoopbackTransport();
    await engineFor(raw, transport).sync(HH);

    // Before the fix the puller re-applied both increments here: R500 paid
    // twice, balance 0 instead of R500 outstanding.
    expect(readDebt(raw)).toEqual({ balance: 50_000, paid: 50_000 });
    raw.close();
  });

  it('a repeat pull of the same round is still a no-op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);
    setSyncWriteDefaults({ deviceId: DEVICE, actorUserId: 'user-1' });

    await new LogDebtPaymentUseCase(
      drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>,
      noopAudit,
      {
        householdId: HH,
        debtId: 'd1',
        paymentAmountCents: 50_000,
        currentDebt: debtEntity(100_000),
      },
    ).execute();

    const transport = new LoopbackTransport();
    const engine = engineFor(raw, transport);
    await engine.sync(HH);
    // Rewind the cursor so the same ops are delivered a second time.
    raw.prepare('UPDATE sync_cursor SET last_pulled_seq = 0').run();
    await engine.sync(HH);

    expect(readDebt(raw)).toEqual({ balance: 50_000, paid: 50_000 });
    raw.close();
  });

  it('an increment pushed by a SHIPPED build (placeholder device id) is still recognised as own', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });

    // An op written before setSyncWriteDefaults existed: the engine below
    // runs as DEVICE, so a plain device-id comparison would call this remote.
    const legacyCtx: SyncedRepoCtx = {
      deviceId: UNASSIGNED_DEVICE_ID,
      actorUserId: 'user-1',
      clock: () => NOW,
      genId: () => 'op-legacy',
    };
    repo.increment('d1', HH, 'outstanding_balance_cents', -50_000, 'floor_zero', legacyCtx);
    expect(readDebt(raw).balance).toBe(50_000);

    // ...and the ledger row the new UnitOfWork writes is not there for it.
    raw.prepare('DELETE FROM oplog_applied WHERE op_id = ?').run('op-legacy');

    const transport = new LoopbackTransport();
    await engineFor(raw, transport).sync(HH);

    expect(readDebt(raw).balance).toBe(50_000);
    raw.close();
  });

  it("a genuinely REMOTE increment IS applied (the own-skip doesn't swallow other devices)", async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);

    const transport = new LoopbackTransport();
    transport.serverOplog.push({
      seq: 1,
      op_id: 'op-remote',
      household_id: HH,
      table_name: 'debts',
      row_id: 'd1',
      op_type: 'increment',
      payload: { field: 'outstanding_balance_cents', delta: -25_000, clamp: 'floor_zero' },
      device_id: 'device-B',
    });

    await engineFor(raw, transport).sync(HH);

    expect(readDebt(raw).balance).toBe(75_000);
    raw.close();
  });

  it('runInUnitOfWork records an increment op in oplog_applied, in the write transaction', () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });

    repo.increment('d1', HH, 'total_paid_cents', 300, 'none', {
      deviceId: DEVICE,
      actorUserId: null,
      clock: () => NOW,
      genId: () => 'op-inc',
    });

    expect(raw.prepare('SELECT op_id FROM oplog_applied').all()).toEqual([{ op_id: 'op-inc' }]);
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// SYNC-2 — restore must leave the puller a cursor, not a replay from seq 0
// ---------------------------------------------------------------------------

describe('SYNC-2: restore then pull does not replay history onto the snapshot', () => {
  it('a restored balance is unchanged by a pull whose oplog still holds the historical increments', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>;
    setSyncWriteDefaults({ deviceId: DEVICE, actorUserId: 'user-1' });

    // Server truth: a debt that started at R1000 and has had R500 paid off,
    // so the snapshot row reads R500 and the oplog holds those two ops.
    const { supabase } = makeFakeSupabase({
      households: {
        [HH]: { id: HH, name: 'Test HH', payday_day: 25, created_at: NOW, updated_at: NOW },
      },
      tables: {
        debts: [
          {
            id: 'd1',
            household_id: HH,
            creditor_name: 'Visa',
            debt_type: 'credit_card',
            outstanding_balance_cents: 50_000,
            interest_rate_percent: 19.9,
            minimum_payment_cents: 5000,
            total_paid_cents: 50_000,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
      maxSeq: 2,
    });

    await new RestoreService(db, supabase as SupabaseClient).restoreHousehold(HH, 'owner', 'u1');
    expect(readDebt(raw)).toEqual({ balance: 50_000, paid: 50_000 });

    const cursor = raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(HH) as { s: number } | undefined;
    expect(cursor?.s).toBe(2);

    // The historical ops are still on the server; a restored device must not
    // replay them on top of the already-final snapshot.
    const transport = new LoopbackTransport();
    transport.serverOplog.push(
      {
        seq: 1,
        op_id: 'op-hist-1',
        household_id: HH,
        table_name: 'debts',
        row_id: 'd1',
        op_type: 'increment',
        payload: { field: 'outstanding_balance_cents', delta: -50_000, clamp: 'floor_zero' },
        device_id: 'device-B',
      },
      {
        seq: 2,
        op_id: 'op-hist-2',
        household_id: HH,
        table_name: 'debts',
        row_id: 'd1',
        op_type: 'increment',
        payload: { field: 'total_paid_cents', delta: 50_000, clamp: 'none' },
        device_id: 'device-B',
      },
    );

    await engineFor(raw, transport).sync(HH);

    expect(readDebt(raw)).toEqual({ balance: 50_000, paid: 50_000 });
    raw.close();
  });

  it('a restore skips a row whose local op has not been pushed yet', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);
    const db = drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>;
    setSyncWriteDefaults({ deviceId: DEVICE, actorUserId: 'user-1' });

    // A local payment that has NOT reached the server yet.
    await new LogDebtPaymentUseCase(db, noopAudit, {
      householdId: HH,
      debtId: 'd1',
      paymentAmountCents: 40_000,
      currentDebt: debtEntity(100_000),
    }).execute();
    expect(readDebt(raw).balance).toBe(60_000);

    const { supabase } = makeFakeSupabase({
      households: {
        [HH]: { id: HH, name: 'Test HH', payday_day: 25, created_at: NOW, updated_at: NOW },
      },
      tables: {
        debts: [
          {
            id: 'd1',
            household_id: HH,
            creditor_name: 'Visa',
            debt_type: 'credit_card',
            outstanding_balance_cents: 100_000,
            interest_rate_percent: 19.9,
            minimum_payment_cents: 5000,
            total_paid_cents: 0,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
      maxSeq: 0,
    });

    await new RestoreService(db, supabase as SupabaseClient).restoreHousehold(HH, 'owner', 'u1');

    // The stale server row must NOT have clobbered the unpushed local payment.
    expect(readDebt(raw).balance).toBe(60_000);
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// SYNC-4 — causal order per household
// ---------------------------------------------------------------------------

describe('SYNC-4: an op is never pushed ahead of an earlier op still backing off', () => {
  it('op2 is not sent while op1 of the same household is inside its backoff window', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });
    const ctx = (genId: string): SyncedRepoCtx => ({
      deviceId: DEVICE,
      actorUserId: 'user-1',
      clock: () => NOW,
      genId: () => genId,
    });

    repo.insert(
      {
        id: 'd1',
        household_id: HH,
        creditor_name: 'Visa',
        debt_type: 'credit_card',
        outstanding_balance_cents: 100_000,
        interest_rate_percent: 19.9,
        minimum_payment_cents: 5000,
        total_paid_cents: 0,
        created_at: NOW,
        updated_at: NOW,
      },
      ctx('op1-insert'),
    );
    repo.update('d1', HH, { creditor_name: 'Visa Gold' }, ctx('op2-update'));

    // batchSize 1 forces the insert and the update into separate batches; the
    // server transiently refuses the insert.
    const seen: string[][] = [];
    const transport: SyncTransport = {
      push: async (ops) => {
        seen.push(ops.map((o) => o.op_id));
        return ops.map((o) => ({
          op_id: o.op_id,
          status: 'rejected' as const,
          code: 'row_missing',
        }));
      },
      pull: async () => [],
    };

    const summary = await engineFor(raw, transport, DEVICE, 1).push();

    // ONLY op1 was ever sent. Before the head-of-line rule, op2 was picked up
    // in the same drain and dead-lettered against a row the server had never
    // seen.
    expect(seen).toEqual([['op1-insert']]);
    expect(summary).toMatchObject({ deadLettered: 0, backedOff: 1 });

    const op2 = raw
      .prepare('SELECT pushed_at, dead_lettered_at FROM oplog WHERE op_id = ?')
      .get('op2-update') as { pushed_at: string | null; dead_lettered_at: string | null };
    expect(op2).toEqual({ pushed_at: null, dead_lettered_at: null });
    raw.close();
  });

  it('row_missing is transient — the op is retried, never dead-lettered at the retry cap', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });
    repo.insert(
      {
        id: 'd1',
        household_id: HH,
        creditor_name: 'Visa',
        debt_type: 'credit_card',
        outstanding_balance_cents: 100_000,
        interest_rate_percent: 19.9,
        minimum_payment_cents: 5000,
        total_paid_cents: 0,
        created_at: NOW,
        updated_at: NOW,
      },
      { deviceId: DEVICE, actorUserId: null, clock: () => NOW, genId: () => 'op-ins' },
    );
    // Already at the cap a raw/unknown reject code would dead-letter on.
    raw.prepare('UPDATE oplog SET retry_count = 99 WHERE op_id = ?').run('op-ins');

    const transport: SyncTransport = {
      push: async (ops) =>
        ops.map((o) => ({ op_id: o.op_id, status: 'rejected' as const, code: 'row_missing' })),
      pull: async () => [],
    };
    const summary = await engineFor(raw, transport).push();

    expect(summary).toMatchObject({ deadLettered: 0, backedOff: 1 });
    const row = raw.prepare('SELECT dead_lettered_at FROM oplog WHERE op_id = ?').get('op-ins') as {
      dead_lettered_at: string | null;
    };
    expect(row.dead_lettered_at).toBeNull();
    raw.close();
  });

  it('a households insert is never split from its owner household_members insert', async () => {
    const raw = openMigratedDb();
    // Oplog rows written directly: this test is about the PUSHER's batching,
    // and a `households` op legitimately has no entity row of its own to
    // write through `createSyncedRepo` (its payload IS the household).
    const appendOp = (opId: string, table: string, householdId: string): void => {
      raw
        .prepare(
          `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload,
                              actor_user_id, device_id, client_created_at, pushed_at)
           VALUES (?, ?, ?, ?, 'insert', '{}', 'user-1', ?, ?, NULL)`,
        )
        .run(opId, householdId, table, `${table}-row`, DEVICE, NOW);
    };
    // One unrelated op first, so with batchSize 2 the bootstrap pair would
    // straddle the boundary unless the pusher pulls it back.
    appendOp('op-unrelated', 'debts', 'hh-other');
    appendOp('op-hh', 'households', HH);
    appendOp('op-member', 'household_members', HH);

    const batches: string[][] = [];
    const transport: SyncTransport = {
      push: async (ops) => {
        batches.push(ops.map((o) => o.op_id));
        return ops.map((o) => ({ op_id: o.op_id, status: 'applied' as const, code: null }));
      },
      pull: async () => [],
    };
    await engineFor(raw, transport, DEVICE, 2).push();

    expect(batches).toEqual([['op-unrelated'], ['op-hh', 'op-member']]);
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// SYNC-8 — discard must survive a server row with local-only/dropped columns
// ---------------------------------------------------------------------------

describe('SYNC-8: discarding a dead-lettered envelopes op', () => {
  it('succeeds when the server row carries a column the local schema dropped', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, {
      tableName: 'envelopes',
    });
    repo.insert(
      {
        id: 'e1',
        household_id: HH,
        name: 'Groceries',
        allocated_cents: 10_000,
        envelope_type: 'spending',
        period_start: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
      { deviceId: DEVICE, actorUserId: null, clock: () => NOW, genId: () => 'op-env' },
    );
    raw.prepare('UPDATE oplog SET dead_lettered_at = ? WHERE op_id = ?').run(NOW, 'op-env');

    const transport = new LoopbackTransport();
    // `spent_cents` is SERVER-derived; there is no such local column to write.
    transport.rowStateResult = {
      id: 'e1',
      household_id: HH,
      name: 'Groceries (server)',
      allocated_cents: 12_000,
      spent_cents: 3_400,
      envelope_type: 'spending',
      period_start: NOW,
      created_at: NOW,
      updated_at: NOW,
    };

    await expect(engineFor(raw, transport).discardDeadLettered('op-env')).resolves.toBeUndefined();

    const row = raw
      .prepare('SELECT name, allocated_cents AS a FROM envelopes WHERE id = ?')
      .get('e1') as {
      name: string;
      a: number;
    };
    expect(row).toEqual({ name: 'Groceries (server)', a: 12_000 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oplog WHERE op_id = ?').get('op-env')).toEqual({
      n: 0,
    });
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// SYNC-3 — a repeat soft delete must surface not-found, not a second tombstone
// ---------------------------------------------------------------------------

describe('SYNC-3: softDelete is not idempotently re-stamping tombstones', () => {
  it('a second softDelete of the same row matches zero rows and throws not-matched', () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, {
      tableName: 'envelopes',
    });
    const ctx = (genId: string, at: string): SyncedRepoCtx => ({
      deviceId: DEVICE,
      actorUserId: null,
      clock: () => at,
      genId: () => genId,
    });

    repo.insert(
      {
        id: 'e1',
        household_id: HH,
        name: 'Groceries',
        allocated_cents: 10_000,
        envelope_type: 'spending',
        period_start: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
      ctx('op-ins', NOW),
    );
    repo.softDelete('e1', HH, ctx('op-del-1', NOW));

    let thrown: unknown;
    try {
      repo.softDelete('e1', HH, ctx('op-del-2', '2026-02-02T00:00:00.000Z'));
    } catch (err) {
      thrown = err;
    }
    expect(isRowNotMatchedError(thrown)).toBe(true);

    // The original tombstone stands, and no second delete op was appended.
    const row = raw.prepare('SELECT deleted_at FROM envelopes WHERE id = ?').get('e1') as {
      deleted_at: string;
    };
    expect(row.deleted_at).toBe(NOW);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM oplog WHERE op_type = 'delete'").get()).toEqual({
      n: 1,
    });
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// assertRunMatchedRow — the zero-rows guard for multi-column writes that
// cannot go through createSyncedRepo (see LogDebtPaymentUseCase).
// ---------------------------------------------------------------------------

describe('assertRunMatchedRow', () => {
  it('throws the standard not-matched error when a hand-written UPDATE hits no row', () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const db = drizzle(raw) as unknown as PortableDb;

    let thrown: unknown;
    try {
      runInUnitOfWork(db, (uow) => {
        const result = uow.db.run(
          sql`UPDATE debts SET total_paid_cents = total_paid_cents + 1 WHERE id = ${'missing'} AND household_id = ${HH}`,
        );
        assertRunMatchedRow('debts', 'missing', HH, result);
        uow.appendOp({
          opId: 'op-should-not-exist',
          householdId: HH,
          tableName: 'debts',
          rowId: 'missing',
          opType: 'increment',
          payload: { field: 'total_paid_cents', delta: 1, clamp: 'none' },
          actorUserId: null,
          deviceId: DEVICE,
          clientCreatedAt: NOW,
        });
      });
    } catch (err) {
      thrown = err;
    }

    expect(isRowNotMatchedError(thrown)).toBe(true);
    // The whole unit of work rolled back, so no op was committed for a row
    // that does not exist.
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oplog').get()).toEqual({ n: 0 });
    raw.close();
  });

  it('is a no-op when the UPDATE matched a row', () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedDebt(raw, 100_000);
    const db = drizzle(raw) as unknown as PortableDb;

    expect(() =>
      runInUnitOfWork(db, (uow) => {
        const result = uow.db.run(
          sql`UPDATE debts SET total_paid_cents = total_paid_cents + 1 WHERE id = ${'d1'} AND household_id = ${HH}`,
        );
        assertRunMatchedRow('debts', 'd1', HH, result);
      }),
    ).not.toThrow();
    expect(readDebt(raw).paid).toBe(1);
    raw.close();
  });
});

// ---------------------------------------------------------------------------
// SYNC-5 — two offline-created Emergency Funds must both survive
// ---------------------------------------------------------------------------

describe('SYNC-5: a second emergency_fund envelope is demoted, never dropped', () => {
  const OLDER = '2026-01-01T00:00:00.000Z';
  const NEWER = '2026-03-01T00:00:00.000Z';

  function seedEnvelope(
    raw: Database.Database,
    id: string,
    createdAt: string,
    type = 'emergency_fund',
  ): void {
    raw
      .prepare(
        `INSERT INTO envelopes (id, household_id, name, allocated_cents, envelope_type,
                                period_start, created_at, updated_at)
         VALUES (?, ?, 'Emergency Fund', 0, ?, ?, ?, ?)`,
      )
      .run(id, HH, type, createdAt, createdAt, createdAt);
  }

  function readEnvelopeTypes(raw: Database.Database): Record<string, string> {
    const rows = raw.prepare('SELECT id, envelope_type FROM envelopes ORDER BY id').all() as {
      id: string;
      envelope_type: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.id, r.envelope_type]));
  }

  function emfInsertOp(id: string, createdAt: string, seq: number): ServerOplogRow {
    return {
      seq,
      op_id: `op-${id}`,
      household_id: HH,
      table_name: 'envelopes',
      row_id: id,
      op_type: 'insert',
      payload: {
        name: 'Emergency Fund',
        allocated_cents: 0,
        envelope_type: 'emergency_fund',
        period_start: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
      },
      device_id: 'device-B',
    };
  }

  it('pulling an OLDER emergency_fund keeps both rows and demotes the local one', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-A', NEWER); // this device created its EMF later

    const transport = new LoopbackTransport();
    transport.serverOplog.push(emfInsertOp('env-B', OLDER, 1));

    await engineFor(raw, transport).sync(HH);

    // Before the fix, INSERT OR IGNORE swallowed the partial-unique-index
    // violation and env-B simply vanished.
    expect(readEnvelopeTypes(raw)).toEqual({ 'env-A': 'savings', 'env-B': 'emergency_fund' });

    // The demotion is queued as a replicating update op, exactly once.
    const ops = raw.prepare("SELECT row_id, payload FROM oplog WHERE op_type = 'update'").all() as {
      row_id: string;
      payload: string;
    }[];
    expect(ops).toHaveLength(1);
    expect(ops[0].row_id).toBe('env-A');
    expect(JSON.parse(ops[0].payload)).toMatchObject({ envelope_type: 'savings' });
    raw.close();
  });

  it('pulling a NEWER emergency_fund stores it as savings and leaves the local row alone', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-A', OLDER); // this device created its EMF first

    const transport = new LoopbackTransport();
    transport.serverOplog.push(emfInsertOp('env-B', NEWER, 1));

    await engineFor(raw, transport).sync(HH);

    expect(readEnvelopeTypes(raw)).toEqual({ 'env-A': 'emergency_fund', 'env-B': 'savings' });
    // The origin device demotes its own copy; this one emits nothing.
    expect(raw.prepare("SELECT COUNT(*) AS n FROM oplog WHERE op_type = 'update'").get()).toEqual({
      n: 0,
    });
    raw.close();
  });

  it('identical created_at is broken deterministically by id', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-z', OLDER);

    const transport = new LoopbackTransport();
    transport.serverOplog.push(emfInsertOp('env-a', OLDER, 1));

    await engineFor(raw, transport).sync(HH);

    // Lower id wins, so both devices reach the same answer without talking.
    expect(readEnvelopeTypes(raw)).toEqual({ 'env-a': 'emergency_fund', 'env-z': 'savings' });
    raw.close();
  });

  it('does not loop: a re-delivered op changes nothing and queues no new op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-A', NEWER);

    const transport = new LoopbackTransport();
    transport.serverOplog.push(emfInsertOp('env-B', OLDER, 1));
    const engine = engineFor(raw, transport);
    await engine.sync(HH);
    raw.prepare('UPDATE sync_cursor SET last_pulled_seq = 0').run();
    raw.prepare('DELETE FROM oplog_applied').run();
    await engine.sync(HH);

    expect(readEnvelopeTypes(raw)).toEqual({ 'env-A': 'savings', 'env-B': 'emergency_fund' });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM oplog WHERE op_type = 'update'").get()).toEqual({
      n: 1,
    });
    raw.close();
  });

  it('an unrelated envelope insert is untouched by the rule', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-A', OLDER);

    const transport = new LoopbackTransport();
    const op = emfInsertOp('env-groceries', NEWER, 1);
    op.payload = { ...op.payload, envelope_type: 'spending', name: 'Groceries' };
    transport.serverOplog.push(op);

    await engineFor(raw, transport).sync(HH);

    expect(readEnvelopeTypes(raw)).toEqual({
      'env-A': 'emergency_fund',
      'env-groceries': 'spending',
    });
    raw.close();
  });

  it('restore stores a colliding emergency_fund as savings instead of aborting the household', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-A', OLDER); // local EMF, older
    const db = drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>;
    setSyncWriteDefaults({ deviceId: DEVICE, actorUserId: 'user-1' });

    const { supabase } = makeFakeSupabase({
      households: {
        [HH]: { id: HH, name: 'Test HH', payday_day: 25, created_at: NOW, updated_at: NOW },
      },
      tables: {
        envelopes: [
          {
            id: 'env-B',
            household_id: HH,
            name: 'Emergency Fund',
            allocated_cents: 0,
            envelope_type: 'emergency_fund',
            is_archived: false,
            deleted_at: null,
            period_start: NEWER,
            created_at: NEWER,
            updated_at: NEWER,
          },
        ],
      },
      maxSeq: 3,
    });

    await expect(
      new RestoreService(db, supabase as SupabaseClient).restoreHousehold(HH, 'owner', 'u1'),
    ).resolves.not.toBeNull();

    // Before the fix the partial-unique-index violation threw out of the
    // upsert and the ENTIRE household restore aborted.
    expect(readEnvelopeTypes(raw)).toEqual({ 'env-A': 'emergency_fund', 'env-B': 'savings' });
    raw.close();
  });

  it('restore demotes the local row when the restored emergency_fund is older', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    seedEnvelope(raw, 'env-A', NEWER); // local EMF, newer
    const db = drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>;
    setSyncWriteDefaults({ deviceId: DEVICE, actorUserId: 'user-1' });

    const { supabase } = makeFakeSupabase({
      households: {
        [HH]: { id: HH, name: 'Test HH', payday_day: 25, created_at: NOW, updated_at: NOW },
      },
      tables: {
        envelopes: [
          {
            id: 'env-B',
            household_id: HH,
            name: 'Emergency Fund',
            allocated_cents: 0,
            envelope_type: 'emergency_fund',
            is_archived: false,
            deleted_at: null,
            period_start: OLDER,
            created_at: OLDER,
            updated_at: OLDER,
          },
        ],
      },
      maxSeq: 3,
    });

    await new RestoreService(db, supabase as SupabaseClient).restoreHousehold(HH, 'owner', 'u1');

    expect(readEnvelopeTypes(raw)).toEqual({ 'env-A': 'savings', 'env-B': 'emergency_fund' });
    const ops = raw.prepare("SELECT row_id FROM oplog WHERE op_type = 'update'").all() as {
      row_id: string;
    }[];
    expect(ops).toEqual([{ row_id: 'env-A' }]);
    raw.close();
  });
});

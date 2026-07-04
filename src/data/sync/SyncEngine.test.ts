// src/data/sync/SyncEngine.test.ts
//
// App-tier unit tests for the production SyncEngine. Runs a REAL migrated
// better-sqlite3 DB (the local oplog + sync_cursor + entity tables) against a
// FAKE transport so every pusher-classification branch, the puller
// cursor-in-same-transaction guarantee, idempotent apply, single-flight, and
// the 30s timeout path are exercised deterministically without a live server.
// The two-device convergence GATE (real sync_push/sync_pull) lives in
// tests/realsql/twoDevice/syncEngineConvergence.test.ts.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from '../../../tests/realsql/harness/openMigratedDb';
import type { PortableDb } from '../uow/UnitOfWork';
import {
  SyncEngine,
  type SyncTransport,
  type WireOp,
  type PushResult,
  type ServerOplogRow,
} from './SyncEngine';

const NOW = '2026-01-01T00:00:00.000Z';
const HH = 'hh-1';

function seedHousehold(raw: Database.Database, id = HH): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test HH', 25, ?, ?)`,
    )
    .run(id, NOW, NOW);
}

/** Inserts one local oplog row (unpushed). Returns the op_id. */
function insertOplog(
  raw: Database.Database,
  overrides: Partial<{
    op_id: string;
    household_id: string;
    table_name: string;
    row_id: string;
    op_type: string;
    payload: Record<string, unknown>;
    device_id: string;
    retry_count: number;
    next_attempt_at: string | null;
  }> = {},
): string {
  const o = {
    op_id: overrides.op_id ?? `op-${Math.random().toString(36).slice(2)}`,
    household_id: overrides.household_id ?? HH,
    table_name: overrides.table_name ?? 'debts',
    row_id: overrides.row_id ?? 'd1',
    op_type: overrides.op_type ?? 'increment',
    payload: overrides.payload ?? { field: 'total_paid_cents', delta: 100, clamp: 'none' },
    device_id: overrides.device_id ?? 'devA',
    retry_count: overrides.retry_count ?? 0,
    next_attempt_at: overrides.next_attempt_at ?? null,
  };
  raw
    .prepare(
      `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload,
         actor_user_id, device_id, client_created_at, retry_count, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, 'user-1', ?, ?, ?, ?)`,
    )
    .run(
      o.op_id,
      o.household_id,
      o.table_name,
      o.row_id,
      o.op_type,
      JSON.stringify(o.payload),
      o.device_id,
      NOW,
      o.retry_count,
      o.next_attempt_at,
    );
  return o.op_id;
}

interface OplogState {
  pushed_at: string | null;
  dead_lettered_at: string | null;
  retry_count: number;
  next_attempt_at: string | null;
}
function oplogState(raw: Database.Database, opId: string): OplogState {
  return raw
    .prepare(
      'SELECT pushed_at, dead_lettered_at, retry_count, next_attempt_at FROM oplog WHERE op_id = ?',
    )
    .get(opId) as OplogState;
}

function debtRowPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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

/** Programmable fake transport. */
class FakeTransport implements SyncTransport {
  pushed: WireOp[][] = [];
  pushImpl: (ops: WireOp[], signal: AbortSignal) => Promise<PushResult[]> = async (ops) =>
    ops.map((o) => ({ op_id: o.op_id, status: 'applied', code: null }));
  pullBatches: ServerOplogRow[][] = [];
  pullImpl?: (
    hh: string,
    after: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<ServerOplogRow[]>;

  async push(ops: WireOp[], signal: AbortSignal): Promise<PushResult[]> {
    this.pushed.push(ops);
    return this.pushImpl(ops, signal);
  }
  async pull(
    hh: string,
    after: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ServerOplogRow[]> {
    if (this.pullImpl) return this.pullImpl(hh, after, limit, signal);
    return this.pullBatches.shift() ?? [];
  }
}

function makeEngine(
  raw: Database.Database,
  transport: SyncTransport,
  opts: {
    deviceId?: string;
    clock?: () => string;
    options?: ConstructorParameters<typeof SyncEngine>[0]['options'];
  } = {},
): SyncEngine {
  const db = drizzle(raw) as unknown as PortableDb;
  return new SyncEngine({
    db,
    transport,
    deviceId: opts.deviceId ?? 'devA',
    clock: opts.clock ?? ((): string => NOW),
    options: { backoffBaseMs: 1000, backoffMaxMs: 60000, maxRejectRetries: 3, ...opts.options },
  });
}

describe('SyncEngine.push — classification branches', () => {
  it('applied -> sets pushed_at (R2), leaves dead_lettered_at null', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw);
    const t = new FakeTransport();
    const engine = makeEngine(raw, t);

    const summary = await engine.push();

    expect(summary).toMatchObject({ applied: 1, deadLettered: 0, backedOff: 0 });
    const st = oplogState(raw, opId);
    expect(st.pushed_at).toBe(NOW);
    expect(st.dead_lettered_at).toBeNull();
    // The wire op stripped id/household_id from payload.
    expect(t.pushed[0][0].payload).not.toHaveProperty('household_id');
    raw.close();
  });

  it('applied with code=duplicate (lost-ack re-push) still marks pushed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw);
    const t = new FakeTransport();
    t.pushImpl = async (ops) =>
      ops.map((o) => ({ op_id: o.op_id, status: 'applied', code: 'duplicate' }));
    const engine = makeEngine(raw, t);

    const summary = await engine.push();
    expect(summary?.applied).toBe(1);
    expect(oplogState(raw, opId).pushed_at).toBe(NOW);
    raw.close();
  });

  it('permanent reject (forbidden_column) -> dead-letters, never pushed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw);
    const t = new FakeTransport();
    t.pushImpl = async (ops) =>
      ops.map((o) => ({ op_id: o.op_id, status: 'rejected', code: 'forbidden_column' }));
    const engine = makeEngine(raw, t);

    const summary = await engine.push();
    expect(summary).toMatchObject({ applied: 0, deadLettered: 1, backedOff: 0 });
    const st = oplogState(raw, opId);
    expect(st.dead_lettered_at).toBe(NOW);
    expect(st.pushed_at).toBeNull();
    expect(st.retry_count).toBe(1);
    raw.close();
  });

  it.each(['unsupported', 'wrong_household', 'not_member'])(
    'permanent reject code %s dead-letters',
    async (code) => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      const opId = insertOplog(raw);
      const t = new FakeTransport();
      t.pushImpl = async (ops) => ops.map((o) => ({ op_id: o.op_id, status: 'rejected', code }));
      const engine = makeEngine(raw, t);
      await engine.push();
      expect(oplogState(raw, opId).dead_lettered_at).toBe(NOW);
      raw.close();
    },
  );

  it('unexpected reject code -> transient backoff (capped exp), not dead-lettered', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw, { retry_count: 0 });
    const t = new FakeTransport();
    t.pushImpl = async (ops) =>
      ops.map((o) => ({ op_id: o.op_id, status: 'rejected', code: '23502' }));
    const engine = makeEngine(raw, t);

    const summary = await engine.push();
    expect(summary).toMatchObject({ applied: 0, deadLettered: 0, backedOff: 1 });
    const st = oplogState(raw, opId);
    expect(st.dead_lettered_at).toBeNull();
    expect(st.retry_count).toBe(1);
    // base 1000 * 2^0 = 1000ms after NOW.
    expect(st.next_attempt_at).toBe(new Date(Date.parse(NOW) + 1000).toISOString());
    raw.close();
  });

  it('unexpected reject code at the retry cap -> dead-lettered (journaled, R1)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    // maxRejectRetries=3, so retry_count 2 -> 2+1>=3 -> dead-letter.
    const opId = insertOplog(raw, { retry_count: 2 });
    const t = new FakeTransport();
    t.pushImpl = async (ops) =>
      ops.map((o) => ({ op_id: o.op_id, status: 'rejected', code: '23502' }));
    const engine = makeEngine(raw, t);
    const summary = await engine.push();
    expect(summary?.deadLettered).toBe(1);
    expect(oplogState(raw, opId).dead_lettered_at).toBe(NOW);
    raw.close();
  });

  it('op missing from the response -> transient backoff (never marked pushed)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw);
    const t = new FakeTransport();
    t.pushImpl = async () => []; // server omitted the op
    const engine = makeEngine(raw, t);
    const summary = await engine.push();
    expect(summary?.backedOff).toBe(1);
    const st = oplogState(raw, opId);
    expect(st.pushed_at).toBeNull();
    expect(st.retry_count).toBe(1);
    raw.close();
  });

  it('transport failure -> whole batch backed off, no discard, drain stops', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw);
    const t = new FakeTransport();
    t.pushImpl = async () => {
      throw new Error('ECONNRESET');
    };
    const engine = makeEngine(raw, t);
    const summary = await engine.push();
    expect(summary).toMatchObject({ applied: 0, deadLettered: 0, backedOff: 1 });
    const st = oplogState(raw, opId);
    expect(st.pushed_at).toBeNull();
    expect(st.dead_lettered_at).toBeNull();
    expect(st.retry_count).toBe(1);
    raw.close();
  });

  it('30s timeout aborts the RPC -> transient backoff', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw);
    const t = new FakeTransport();
    // Hang until aborted by the engine's timeout.
    t.pushImpl = (_ops, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const engine = makeEngine(raw, t, { options: { timeoutMs: 20 } });
    const summary = await engine.push();
    expect(summary?.backedOff).toBe(1);
    expect(oplogState(raw, opId).retry_count).toBe(1);
    raw.close();
  });

  it('drains multiple batches until no eligible op remains', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    for (let i = 0; i < 5; i += 1) insertOplog(raw, { op_id: `op-${i}` });
    const t = new FakeTransport();
    const engine = makeEngine(raw, t, { options: { batchSize: 2 } });
    const summary = await engine.push();
    expect(summary).toMatchObject({ applied: 5 });
    expect(summary?.batches).toBe(3); // 2 + 2 + 1
    raw.close();
  });

  it('does not re-fetch backed-off ops (excluded by next_attempt_at)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    insertOplog(raw, {
      op_id: 'op-future',
      next_attempt_at: new Date(Date.parse(NOW) + 60000).toISOString(),
    });
    const t = new FakeTransport();
    const engine = makeEngine(raw, t);
    const summary = await engine.push();
    expect(summary?.batches).toBe(0);
    expect(t.pushed).toHaveLength(0);
    raw.close();
  });
});

describe('SyncEngine.pull — cursor + apply', () => {
  function serverRow(o: Partial<ServerOplogRow> & { seq: number; op_id: string }): ServerOplogRow {
    return {
      household_id: HH,
      table_name: 'debts',
      row_id: 'd1',
      op_type: 'insert',
      payload: {},
      device_id: 'peer',
      ...o,
    };
  }

  it('applies a batch and advances the cursor in the same transaction', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    t.pullBatches = [
      [serverRow({ seq: 5, op_id: 'p1', op_type: 'insert', payload: debtRowPayload() })],
      [],
    ];
    const engine = makeEngine(raw, t, { deviceId: 'devA' });

    const summary = await engine.pull(HH);
    expect(summary).toMatchObject({ applied: 1 });
    const debt = raw.prepare('SELECT total_paid_cents FROM debts WHERE id = ?').get('d1') as
      | { total_paid_cents: number }
      | undefined;
    expect(debt?.total_paid_cents).toBe(0);
    const cursor = raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(HH) as { s: number };
    expect(cursor.s).toBe(5);
    raw.close();
  });

  it('rolls back BOTH the batch and the cursor when an op fails mid-batch (does not throw)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    // op1 valid; op2 targets a non-existent column -> SQL throws -> whole tx rolls back.
    // Same payload every call (mimics the server: the cursor never advances,
    // so re-pulling returns the SAME batch), letting us drive repeated
    // apply-failure attempts deterministically.
    t.pullImpl = async () => [
      serverRow({ seq: 5, op_id: 'p1', op_type: 'insert', payload: debtRowPayload() }),
      serverRow({
        seq: 6,
        op_id: 'p2',
        row_id: 'd2',
        op_type: 'insert',
        payload: debtRowPayload({ bogus_col: 1 }),
      }),
    ];
    const engine = makeEngine(raw, t);

    // §7.2: a local-apply failure must NOT throw out of pull() (a poison
    // batch would otherwise stall the household's puller forever with an
    // uncaught rejection on every future pull).
    const summary = await engine.pull(HH);
    expect(summary?.applied).toBe(0);
    // Atomicity: op1's insert AND the cursor advance were both reverted.
    const d1 = raw.prepare('SELECT id FROM debts WHERE id = ?').get('d1');
    expect(d1).toBeUndefined();
    const cursor = raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(HH) as { s: number } | undefined;
    expect(cursor).toBeUndefined(); // cursor never advanced past the unapplied batch
    raw.close();
  });

  it('a transient transport failure backs off and does not throw out of pull() (mock fails once then succeeds)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    let calls = 0;
    t.pullImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNRESET');
      if (calls === 2)
        return [serverRow({ seq: 5, op_id: 'p1', op_type: 'insert', payload: debtRowPayload() })];
      return [];
    };
    let clockMs = 0;
    const engine = makeEngine(raw, t, {
      clock: () => new Date(Date.parse(NOW) + clockMs).toISOString(),
      options: { backoffBaseMs: 1000, backoffMaxMs: 60000 },
    });

    // First call: transport throws -> backed off, no throw out of pull().
    const first = await engine.pull(HH);
    expect(first).toMatchObject({ batches: 0, applied: 0, blocked: false });
    expect(raw.prepare('SELECT id FROM debts WHERE id = ?').get('d1')).toBeUndefined();

    // Immediately retrying is a no-op: still within the backoff window, so
    // the transport isn't even called again.
    const stillBackedOff = await engine.pull(HH);
    expect(stillBackedOff).toMatchObject({ batches: 0, applied: 0 });
    expect(calls).toBe(1);

    // Advance the clock past the backoff window (base 1000ms * 2^0) and
    // retry -> converges (the network recovered).
    clockMs += 2000;
    const second = await engine.pull(HH);
    expect(second).toMatchObject({ applied: 1, blocked: false });
    expect(raw.prepare('SELECT id FROM debts WHERE id = ?').get('d1')).toBeDefined();
    raw.close();
  });

  it('a poison batch (applyOne fails repeatedly) stops after N attempts, sets the blocked flag, and never advances the cursor — ops stay re-pullable', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    // Same op_id/cursor position every call — a batch that can never apply.
    t.pullImpl = async () => [
      serverRow({
        seq: 5,
        op_id: 'poison-1',
        op_type: 'insert',
        payload: debtRowPayload({ bogus_col: 1 }),
      }),
    ];
    const engine = makeEngine(raw, t, { options: { maxPullApplyRetries: 3 } });

    expect(engine.getPullHealth(HH)).toEqual({ blocked: false });

    await engine.pull(HH); // attempt 1
    expect(engine.getPullHealth(HH).blocked).toBe(false);
    await engine.pull(HH); // attempt 2
    expect(engine.getPullHealth(HH).blocked).toBe(false);
    const third = await engine.pull(HH); // attempt 3 -> hits maxPullApplyRetries -> blocked
    expect(third?.blocked).toBe(true);

    const health = engine.getPullHealth(HH);
    expect(health.blocked).toBe(true);
    expect(health.opIds).toEqual(['poison-1']);
    expect(health.error).toBeTruthy();

    // No data loss: the op was never applied locally, but it's still
    // server-side (re-pullable) — the cursor never advanced past it.
    const cursor = raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(HH);
    expect(cursor).toBeUndefined();

    // Once blocked, a further pull() call doesn't even hit the transport again.
    let callsAfterBlock = 0;
    t.pullImpl = async () => {
      callsAfterBlock += 1;
      return [];
    };
    const fourth = await engine.pull(HH);
    expect(fourth?.blocked).toBe(true);
    expect(callsAfterBlock).toBe(0);
    raw.close();
  });

  it('skips own-device ops but still advances the cursor past them', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    t.pullBatches = [
      [
        serverRow({
          seq: 9,
          op_id: 'mine',
          device_id: 'devA',
          op_type: 'insert',
          payload: debtRowPayload(),
        }),
      ],
      [],
    ];
    const engine = makeEngine(raw, t, { deviceId: 'devA' });
    const summary = await engine.pull(HH);
    expect(summary).toMatchObject({ applied: 0 });
    expect(raw.prepare('SELECT id FROM debts WHERE id = ?').get('d1')).toBeUndefined();
    const cursor = raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(HH) as { s: number };
    expect(cursor.s).toBe(9);
    raw.close();
  });

  it('is idempotent: a re-delivered increment applies exactly once (R5)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    const engine = makeEngine(raw, t, { deviceId: 'devA' });

    // 1) seed the row + apply an increment (delta 300).
    t.pullBatches = [
      [
        serverRow({ seq: 1, op_id: 'ins', op_type: 'insert', payload: debtRowPayload() }),
        serverRow({
          seq: 2,
          op_id: 'inc',
          op_type: 'increment',
          payload: { field: 'total_paid_cents', delta: 300, clamp: 'none' },
        }),
      ],
      [],
    ];
    await engine.pull(HH);
    expect(
      (
        raw.prepare('SELECT total_paid_cents AS v FROM debts WHERE id = ?').get('d1') as {
          v: number;
        }
      ).v,
    ).toBe(300);

    // 2) rewind the cursor (simulate a re-pull) and re-deliver the SAME increment.
    raw.prepare('UPDATE sync_cursor SET last_pulled_seq = 1 WHERE household_id = ?').run(HH);
    t.pullBatches = [
      [
        serverRow({
          seq: 2,
          op_id: 'inc',
          op_type: 'increment',
          payload: { field: 'total_paid_cents', delta: 300, clamp: 'none' },
        }),
      ],
      [],
    ];
    await engine.pull(HH);
    // Dedup via oplog_applied -> value NOT doubled.
    expect(
      (
        raw.prepare('SELECT total_paid_cents AS v FROM debts WHERE id = ?').get('d1') as {
          v: number;
        }
      ).v,
    ).toBe(300);
    raw.close();
  });

  it('applies update, delete (origin tombstone) and floor_zero increment', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    const engine = makeEngine(raw, t, { deviceId: 'devA' });
    t.pullBatches = [
      [
        serverRow({
          seq: 1,
          op_id: 'i',
          op_type: 'insert',
          payload: debtRowPayload({ total_paid_cents: 50 }),
        }),
        serverRow({ seq: 2, op_id: 'u', op_type: 'update', payload: { creditor_name: 'Renamed' } }),
        serverRow({
          seq: 3,
          op_id: 'dec',
          op_type: 'increment',
          payload: { field: 'total_paid_cents', delta: -100, clamp: 'floor_zero' },
        }),
        serverRow({
          seq: 4,
          op_id: 'del',
          op_type: 'delete',
          payload: { deleted_at: '2026-02-02T00:00:00.000Z' },
        }),
      ],
      [],
    ];
    await engine.pull(HH);
    const row = raw
      .prepare('SELECT creditor_name, total_paid_cents, deleted_at FROM debts WHERE id = ?')
      .get('d1') as { creditor_name: string; total_paid_cents: number; deleted_at: string | null };
    expect(row.creditor_name).toBe('Renamed');
    expect(row.total_paid_cents).toBe(0); // floor_zero clamped 50-100 -> 0
    expect(row.deleted_at).toBe('2026-02-02T00:00:00.000Z'); // origin value, not "now"
    raw.close();
  });

  it('increment with a non-finite delta throws and rolls back (never writes NULL/NaN into a money column)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    const engine = makeEngine(raw, t, { deviceId: 'devA' });
    t.pullBatches = [
      [
        serverRow({
          seq: 1,
          op_id: 'i',
          op_type: 'insert',
          payload: debtRowPayload({ total_paid_cents: 50 }),
        }),
        serverRow({
          seq: 2,
          op_id: 'bad-delta',
          op_type: 'increment',
          // Malformed payload: delta is not numeric -> Number(...) is NaN.
          payload: { field: 'total_paid_cents', delta: 'not-a-number', clamp: 'none' },
        }),
      ],
      [],
    ];

    // The batch fails to apply (poison-batch candidate) rather than throwing
    // out of pull() (§7.2) -- but critically the row's money column must be
    // untouched (rolled back), not written with NULL/NaN.
    const summary = await engine.pull(HH);
    expect(summary?.applied).toBe(0);
    const row = raw.prepare('SELECT id, total_paid_cents FROM debts WHERE id = ?').get('d1');
    // Rolled back: the insert from op 'i' (same transaction as the bad
    // increment) never committed either -- proves atomicity, not just that
    // the bad column stayed NULL.
    expect(row).toBeUndefined();
    raw.close();
  });

  it('paginates until a short page', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    const engine = makeEngine(raw, t, { deviceId: 'devA', options: { pullLimit: 1 } });
    t.pullBatches = [
      [serverRow({ seq: 1, op_id: 'a', op_type: 'insert', payload: debtRowPayload() })],
      [
        serverRow({
          seq: 2,
          op_id: 'b',
          row_id: 'd2',
          op_type: 'insert',
          payload: debtRowPayload(),
        }),
      ],
      [], // short page ends the loop
    ];
    const summary = await engine.pull(HH);
    // Two full pages of 1 (each == limit, so the loop continues), then an empty
    // page ends it — only the two non-empty pages are counted.
    expect(summary?.batches).toBe(2);
    expect(summary?.applied).toBe(2);
    raw.close();
  });
});

describe('SyncEngine.sync + single-flight', () => {
  it('sync() pushes then pulls', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const opId = insertOplog(raw, {
      op_type: 'insert',
      payload: debtRowPayload({ ...{} }),
      row_id: 'd9',
    });
    const t = new FakeTransport();
    const order: string[] = [];
    t.pushImpl = async (ops) => {
      order.push('push');
      return ops.map((o) => ({ op_id: o.op_id, status: 'applied', code: null }));
    };
    t.pullImpl = async () => {
      order.push('pull');
      return [];
    };
    const engine = makeEngine(raw, t);
    await engine.sync(HH);
    expect(order).toEqual(['push', 'pull']);
    expect(oplogState(raw, opId).pushed_at).toBe(NOW);
    raw.close();
  });

  it('single-flight: a concurrent push is skipped (returns undefined)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    insertOplog(raw);
    const t = new FakeTransport();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t.pushImpl = async (ops) => {
      await gate;
      return ops.map((o) => ({ op_id: o.op_id, status: 'applied', code: null }));
    };
    const engine = makeEngine(raw, t);

    const first = engine.push();
    const second = await engine.push(); // in-flight -> skipped
    expect(second).toBeUndefined();
    release();
    const firstSummary = await first;
    expect(firstSummary?.applied).toBe(1);
    raw.close();
  });
});

describe('SyncEngine.getPendingPushCount', () => {
  it('is 0 with no oplog rows', () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    const engine = makeEngine(raw, t);
    expect(engine.getPendingPushCount()).toBe(0);
    raw.close();
  });

  it('counts unpushed, non-dead-lettered ops across households (push is household-agnostic)', () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    seedHousehold(raw, 'hh-2');
    insertOplog(raw, { household_id: 'hh-1' });
    insertOplog(raw, { household_id: 'hh-2' });
    const t = new FakeTransport();
    const engine = makeEngine(raw, t);
    expect(engine.getPendingPushCount()).toBe(2);
    raw.close();
  });

  it('excludes pushed and dead-lettered ops, and drops to 0 after a full drain', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    insertOplog(raw); // will push successfully
    const rejectedOpId = insertOplog(raw, { row_id: 'd2' });
    const t = new FakeTransport();
    t.pushImpl = async (ops) =>
      ops.map((o) => ({
        op_id: o.op_id,
        status: o.op_id === rejectedOpId ? 'rejected' : 'applied',
        code: o.op_id === rejectedOpId ? 'forbidden_column' : null,
      }));
    const engine = makeEngine(raw, t);

    expect(engine.getPendingPushCount()).toBe(2);
    await engine.push();
    // One applied (pushed_at set) + one permanently rejected (dead-lettered) -> both excluded.
    expect(engine.getPendingPushCount()).toBe(0);
    raw.close();
  });

  it('reflects a backed-off (transient) op as still pending', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    insertOplog(raw);
    const t = new FakeTransport();
    t.pushImpl = async (ops) =>
      ops.map((o) => ({ op_id: o.op_id, status: 'rejected', code: '23502' }));
    const engine = makeEngine(raw, t);

    await engine.push();
    expect(engine.getPendingPushCount()).toBe(1);
    raw.close();
  });
});

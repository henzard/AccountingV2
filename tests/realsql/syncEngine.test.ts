// tests/realsql/syncEngine.test.ts
//
// Offline realsql-tier tests for the production SyncEngine: the REAL local
// write path (createSyncedRepo -> oplog) feeding the pusher, plus the puller's
// cursor-in-same-transaction guarantee — all against a real migrated
// better-sqlite3 DB with a FAKE transport (no server needed). The live-server
// convergence GATE is tests/realsql/twoDevice/syncEngineConvergence.test.ts.

import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { createSyncedRepo, type SyncedRepoCtx } from '../../src/data/uow/createSyncedRepo';
import type { PortableDb } from '../../src/data/uow/UnitOfWork';
import {
  SyncEngine,
  type SyncTransport,
  type PushResult,
  type ServerOplogRow,
  type WireOp,
} from '../../src/data/sync/SyncEngine';

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

function ctx(genId: string): SyncedRepoCtx {
  return { deviceId: 'devA', actorUserId: 'user-1', clock: () => NOW, genId: () => genId };
}

function debtRow(id: string): Record<string, unknown> {
  return {
    id,
    household_id: HH,
    creditor_name: 'Visa',
    debt_type: 'credit_card',
    outstanding_balance_cents: 100000,
    interest_rate_percent: 19.9,
    minimum_payment_cents: 5000,
    total_paid_cents: 0,
    created_at: NOW,
    updated_at: NOW,
  };
}

class FakeTransport implements SyncTransport {
  push: (ops: WireOp[], signal: AbortSignal) => Promise<PushResult[]> = async (ops) =>
    ops.map((o) => ({ op_id: o.op_id, status: 'applied', code: null }));
  pull: (
    hh: string,
    after: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<ServerOplogRow[]> = async () => [];
}

function engineFor(raw: Database.Database, transport: SyncTransport): SyncEngine {
  return new SyncEngine({
    db: drizzle(raw) as unknown as PortableDb,
    transport,
    deviceId: 'devA',
    clock: () => NOW,
    options: { backoffBaseMs: 1000, backoffMaxMs: 60000, maxRejectRetries: 5 },
  });
}

describe('SyncEngine pusher over the real createSyncedRepo write path', () => {
  it('applied -> the appended oplog op is marked pushed (R2)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });
    repo.insert(debtRow('d1'), ctx('op-ins'));
    repo.increment('d1', HH, 'total_paid_cents', 300, 'none', ctx('op-inc'));

    const t = new FakeTransport();
    const seen: WireOp[] = [];
    t.push = async (ops) => {
      seen.push(...ops);
      return ops.map((o) => ({ op_id: o.op_id, status: 'applied', code: null }));
    };
    const summary = await engineFor(raw, t).push();

    expect(summary).toMatchObject({ applied: 2, deadLettered: 0, backedOff: 0 });
    const unpushed = raw
      .prepare('SELECT COUNT(*) AS n FROM oplog WHERE pushed_at IS NULL')
      .get() as {
      n: number;
    };
    expect(unpushed.n).toBe(0);
    // Ops pushed oldest-first (insert before increment); payload stripped of id/household_id.
    expect(seen.map((o) => o.op_id)).toEqual(['op-ins', 'op-inc']);
    expect(seen[0].payload).not.toHaveProperty('id');
    raw.close();
  });

  it('permanent reject -> dead-lettered, never pushed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });
    repo.insert(debtRow('d1'), ctx('op-ins'));

    const t = new FakeTransport();
    t.push = async (ops) =>
      ops.map((o) => ({ op_id: o.op_id, status: 'rejected', code: 'wrong_household' }));
    const summary = await engineFor(raw, t).push();

    expect(summary).toMatchObject({ deadLettered: 1 });
    const row = raw
      .prepare('SELECT pushed_at, dead_lettered_at FROM oplog WHERE op_id = ?')
      .get('op-ins') as {
      pushed_at: string | null;
      dead_lettered_at: string | null;
    };
    expect(row.pushed_at).toBeNull();
    expect(row.dead_lettered_at).toBe(NOW);
    raw.close();
  });

  it('transient transport failure -> backoff, op stays unpushed (no discard)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const repo = createSyncedRepo(drizzle(raw) as unknown as PortableDb, { tableName: 'debts' });
    repo.insert(debtRow('d1'), ctx('op-ins'));

    const t = new FakeTransport();
    t.push = async () => {
      throw new Error('network down');
    };
    const summary = await engineFor(raw, t).push();

    expect(summary).toMatchObject({ backedOff: 1 });
    const row = raw
      .prepare(
        'SELECT pushed_at, dead_lettered_at, retry_count, next_attempt_at FROM oplog WHERE op_id = ?',
      )
      .get('op-ins') as {
      pushed_at: string | null;
      dead_lettered_at: string | null;
      retry_count: number;
      next_attempt_at: string | null;
    };
    expect(row.pushed_at).toBeNull();
    expect(row.dead_lettered_at).toBeNull();
    expect(row.retry_count).toBe(1);
    expect(row.next_attempt_at).toBe(new Date(Date.parse(NOW) + 1000).toISOString());
    raw.close();
  });
});

describe('SyncEngine puller cursor-in-same-transaction guarantee', () => {
  function row(seq: number, opId: string, extra: Partial<ServerOplogRow> = {}): ServerOplogRow {
    return {
      seq,
      op_id: opId,
      household_id: HH,
      table_name: 'debts',
      row_id: 'd1',
      op_type: 'insert',
      payload: {},
      device_id: 'peer',
      ...extra,
    };
  }

  it('advances the cursor ONLY together with the applied batch', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    const batches: ServerOplogRow[][] = [
      [
        row(7, 'p1', {
          op_type: 'insert',
          payload: {
            creditor_name: 'Visa',
            debt_type: 'credit_card',
            outstanding_balance_cents: 100000,
            interest_rate_percent: 19.9,
            minimum_payment_cents: 5000,
            total_paid_cents: 0,
            created_at: NOW,
            updated_at: NOW,
          },
        }),
      ],
      [],
    ];
    t.pull = async () => batches.shift() ?? [];
    await engineFor(raw, t).pull(HH);

    const cur = raw
      .prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?')
      .get(HH) as {
      s: number;
    };
    expect(cur.s).toBe(7);
    expect(raw.prepare('SELECT id FROM debts WHERE id = ?').get('d1')).toBeTruthy();
    raw.close();
  });

  it('rolls back the cursor advance when apply throws mid-batch (atomic), without throwing out of pull() (§7.2)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw);
    const t = new FakeTransport();
    // Same batch every call (mimics the server: the cursor never advances,
    // so a re-pull returns the SAME rows) -- this is the poison-batch shape.
    t.pull = async () => [
      row(7, 'p1', {
        op_type: 'insert',
        payload: {
          creditor_name: 'Visa',
          debt_type: 'credit_card',
          outstanding_balance_cents: 100000,
          interest_rate_percent: 19.9,
          minimum_payment_cents: 5000,
          total_paid_cents: 0,
          created_at: NOW,
          updated_at: NOW,
        },
      }),
      row(8, 'p2', { row_id: 'd2', op_type: 'insert', payload: { not_a_column: 1 } }),
    ];

    // A local-apply failure must not throw out of pull() (§7.2) -- it would
    // otherwise stall the household's puller with an uncaught rejection on
    // every future pull.
    const summary = await engineFor(raw, t).pull(HH);
    expect(summary?.applied).toBe(0);
    // Neither the first insert nor the cursor advance survived.
    expect(raw.prepare('SELECT id FROM debts WHERE id = ?').get('d1')).toBeUndefined();
    expect(
      raw.prepare('SELECT last_pulled_seq AS s FROM sync_cursor WHERE household_id = ?').get(HH),
    ).toBeUndefined();
    raw.close();
  });
});

// tests/realsql/twoDevice/syncEngineConvergence.test.ts
//
// THE PRODUCTION GATE. Proves the REAL src/data/sync/SyncEngine (pusher +
// puller) — NOT the harness's reference push/pull — converges two devices
// against the REAL server RPCs (public.sync_push / public.sync_pull) under the
// same scenarios as convergence.test.ts (Task 2). Each engine drives one
// device's local oplog + entity tables through a Postgres-backed SyncTransport
// that calls the same RPCs the harness uses. If this is green, the shipped
// engine satisfies the convergence properties, not just the reference logic.
//
// Reset: each test/run is wrapped in a Postgres transaction/savepoint that is
// rolled back; auth.uid() is driven via the request.jwt.claims GUC.

import { Client } from 'pg';
import fc from 'fast-check';
import {
  TwoDeviceHarness,
  Device,
  seedHousehold,
  setSessionUser,
  debtRow,
  TEST_USER_UUID,
} from './harness';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { PortableDb } from '../../../src/data/uow/UnitOfWork';
import {
  SyncEngine,
  type SyncTransport,
  type WireOp,
  type PushResult,
  type ServerOplogRow,
} from '../../../src/data/sync/SyncEngine';

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

const HH = 'hh-conv-engine';

let client: Client;

beforeAll(async () => {
  client = new Client({ ...PG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `SyncEngine convergence gate could not reach local Postgres at ${PG.host}:${PG.port} ` +
        `(${(e as Error).message}). Start the local Supabase stack (\`supabase start\`).`,
    );
  }
  await setSessionUser(client);
});

afterAll(async () => {
  if (client) await client.end();
});

beforeEach(async () => {
  await client.query('BEGIN');
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

/** A Postgres-backed transport hitting the SAME RPCs the harness uses. */
function pgTransport(c: Client): SyncTransport {
  return {
    async push(ops: WireOp[]): Promise<PushResult[]> {
      const res = await c.query<{ r: PushResult[] }>('SELECT public.sync_push($1::jsonb) AS r', [
        JSON.stringify(ops),
      ]);
      return res.rows[0].r;
    },
    async pull(householdId, afterSeq, limit): Promise<ServerOplogRow[]> {
      const res = await c.query<ServerOplogRow>('SELECT * FROM public.sync_pull($1, $2, $3)', [
        householdId,
        afterSeq,
        limit,
      ]);
      return res.rows;
    },
  };
}

function engineFor(dev: Device): SyncEngine {
  return new SyncEngine({
    db: drizzle(dev.raw) as unknown as PortableDb,
    transport: pgTransport(client),
    deviceId: dev.id,
    // Real wall-clock is fine here; convergence never depends on the pushed_at value.
  });
}

async function twoEngines(): Promise<{
  h: TwoDeviceHarness;
  a: Device;
  b: Device;
  ea: SyncEngine;
  eb: SyncEngine;
}> {
  await seedHousehold(client, HH);
  const h = new TwoDeviceHarness(client);
  const a = h.addDevice('devA', TEST_USER_UUID);
  const b = h.addDevice('devB', TEST_USER_UUID);
  return { h, a, b, ea: engineFor(a), eb: engineFor(b) };
}

async function settle(ea: SyncEngine, eb: SyncEngine): Promise<void> {
  await ea.push();
  await eb.push();
  await ea.pull(HH);
  await eb.pull(HH);
}

function spent(dev: Device, id: string): number {
  const row = dev.raw.prepare('SELECT total_paid_cents AS s FROM debts WHERE id = ?').get(id) as
    | { s: number }
    | undefined;
  return row ? Number(row.s) : NaN;
}

describe('SyncEngine two-device convergence (real server RPCs)', () => {
  it('two engines create different debts -> both converge to both', async () => {
    const { h, a, b, ea, eb } = await twoEngines();
    try {
      a.write({
        kind: 'insert',
        table: 'debts',
        row: debtRow('debt-A', HH, { creditor_name: 'Rent' }),
      });
      b.write({
        kind: 'insert',
        table: 'debts',
        row: debtRow('debt-B', HH, { creditor_name: 'Fuel' }),
      });

      await settle(ea, eb);

      const snapA = h.snapshot(a, 'debts', HH);
      const snapB = h.snapshot(b, 'debts', HH);
      expect(Object.keys(snapA).sort()).toEqual(['debt-A', 'debt-B']);
      expect(snapA).toEqual(snapB);
      expect(snapA['debt-A'].creditor_name).toBe('Rent');
      expect(snapA['debt-B'].creditor_name).toBe('Fuel');
    } finally {
      h.closeAll();
    }
  });

  it('concurrent increments sum with no lost update', async () => {
    const { h, a, b, ea, eb } = await twoEngines();
    try {
      a.write({ kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      await ea.push();
      await eb.pull(HH);
      expect(spent(a, 'debt-1')).toBe(0);
      expect(spent(b, 'debt-1')).toBe(0);

      a.write({
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 300,
        clamp: 'none',
      });
      b.write({
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 700,
        clamp: 'none',
      });

      await settle(ea, eb);

      expect(spent(a, 'debt-1')).toBe(1000);
      expect(spent(b, 'debt-1')).toBe(1000);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  it('a delete propagates (soft) to the other device', async () => {
    const { h, a, b, ea, eb } = await twoEngines();
    try {
      a.write({ kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      await ea.push();
      await eb.pull(HH);

      a.write({ kind: 'delete', table: 'debts', id: 'debt-1', householdId: HH });
      await settle(ea, eb);

      const rowB = b.raw.prepare('SELECT deleted_at FROM debts WHERE id = ?').get('debt-1') as
        | { deleted_at: string | null }
        | undefined;
      expect(rowB?.deleted_at).not.toBeNull();
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
      expect(h.snapshot(b, 'debts', HH)['debt-1'].deleted_at).toBe('<deleted>');
    } finally {
      h.closeAll();
    }
  });

  it('duplicate push (lost ack) is idempotent — increment applied once', async () => {
    const { h, a, b, ea, eb } = await twoEngines();
    try {
      a.write({ kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      a.write({
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 300,
        clamp: 'none',
      });
      await ea.push();

      // Lost ack: the engine never learned the push succeeded, so re-drains + re-pushes.
      a.raw.exec('UPDATE oplog SET pushed_at = NULL');
      await ea.push();

      await eb.pull(HH);
      expect(spent(b, 'debt-1')).toBe(300);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  it('offline write then push after the other advanced -> no lost write', async () => {
    const { h, a, b, ea, eb } = await twoEngines();
    try {
      a.write({ kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      await ea.push();
      await eb.pull(HH);

      b.write({
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 500,
        clamp: 'none',
      });
      a.write({
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 200,
        clamp: 'none',
      });
      await ea.push();

      await settle(ea, eb);

      expect(spent(a, 'debt-1')).toBe(700);
      expect(spent(b, 'debt-1')).toBe(700);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  it('sync() (push then drain-pull) converges both directions in one call each', async () => {
    const { h, a, b, ea, eb } = await twoEngines();
    try {
      a.write({ kind: 'insert', table: 'debts', row: debtRow('debt-A', HH) });
      b.write({ kind: 'insert', table: 'debts', row: debtRow('debt-B', HH) });

      // Two full sync rounds settle both devices.
      await ea.sync(HH);
      await eb.sync(HH);
      await ea.sync(HH);

      expect(Object.keys(h.snapshot(a, 'debts', HH)).sort()).toEqual(['debt-A', 'debt-B']);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  it('random interleavings converge and conserve the increment total', async () => {
    type Cmd =
      | { t: 'inc'; dev: 'A' | 'B'; delta: number }
      | { t: 'push'; dev: 'A' | 'B' }
      | { t: 'pull'; dev: 'A' | 'B' };

    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.record({
        t: fc.constant('inc' as const),
        dev: fc.constantFrom('A', 'B'),
        delta: fc.integer({ min: 1, max: 500 }),
      }),
      fc.record({ t: fc.constant('push' as const), dev: fc.constantFrom('A', 'B') }),
      fc.record({ t: fc.constant('pull' as const), dev: fc.constantFrom('A', 'B') }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 12 }), async (cmds) => {
        await client.query('SAVEPOINT run');
        const h = new TwoDeviceHarness(client);
        try {
          await seedHousehold(client, HH);
          const a = h.addDevice('devA', TEST_USER_UUID);
          const b = h.addDevice('devB', TEST_USER_UUID);
          const ea = engineFor(a);
          const eb = engineFor(b);
          const engines = { A: ea, B: eb };
          const devs = { A: a, B: b };

          a.write({ kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
          await ea.push();
          await eb.pull(HH);

          let total = 0;
          for (const c of cmds) {
            if (c.t === 'inc') {
              devs[c.dev].write({
                kind: 'increment',
                table: 'debts',
                id: 'debt-1',
                householdId: HH,
                field: 'total_paid_cents',
                delta: c.delta,
                clamp: 'none',
              });
              total += c.delta;
            } else if (c.t === 'push') {
              await engines[c.dev].push();
            } else {
              await engines[c.dev].pull(HH);
            }
          }

          await settle(ea, eb);
          await settle(ea, eb);

          expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
          expect(spent(a, 'debt-1')).toBe(total);
          expect(spent(b, 'debt-1')).toBe(total);
        } finally {
          h.closeAll();
          await client.query('ROLLBACK TO SAVEPOINT run');
          await client.query('RELEASE SAVEPOINT run');
        }
      }),
      { numRuns: 25 },
    );
  });
});

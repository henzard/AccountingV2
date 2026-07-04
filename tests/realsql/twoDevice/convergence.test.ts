// tests/realsql/twoDevice/convergence.test.ts
//
// THE GATE (spec test tier 3). Proves two devices running the REAL oplog
// push/pull protocol against the REAL server RPCs (public.sync_push /
// public.sync_pull from supabase/migrations/0001_baseline.sql) CONVERGE with
// no lost writes under arbitrary interleavings. No SyncEngine->UI wiring may
// proceed until this file is green.
//
// Server state reset: each test (and each fast-check run) runs inside a
// Postgres transaction / savepoint that is rolled back, so no test mutates the
// shared local Supabase database permanently. auth.uid() is driven via the
// `request.jwt.claims` GUC so the sync_push membership check passes.

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

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

const HH = 'hh-conv';

let client: Client;

beforeAll(async () => {
  client = new Client({ ...PG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Two-device convergence harness could not reach local Postgres at ${PG.host}:${PG.port} ` +
        `(${(e as Error).message}). Start the local Supabase stack (\`supabase start\`) — this ` +
        `tier drives the REAL sync_push/sync_pull RPCs and cannot run without it.`,
    );
  }
  await setSessionUser(client);
});

afterAll(async () => {
  if (client) await client.end();
});

// Per-test transaction: everything the RPCs write is rolled back afterwards.
beforeEach(async () => {
  await client.query('BEGIN');
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

/** Sets up a household on the server + two devices sharing one user. */
async function twoDevices(): Promise<{ h: TwoDeviceHarness; a: Device; b: Device }> {
  await seedHousehold(client, HH);
  const h = new TwoDeviceHarness(client);
  const a = h.addDevice('devA', TEST_USER_UUID);
  const b = h.addDevice('devB', TEST_USER_UUID);
  return { h, a, b };
}

/** A full flush round: both push, then both pull. */
async function settle(h: TwoDeviceHarness, a: Device, b: Device): Promise<void> {
  await h.push(a);
  await h.push(b);
  await h.pull(a, HH);
  await h.pull(b, HH);
}

function spent(dev: Device, id: string): number {
  const row = dev.raw.prepare('SELECT total_paid_cents AS s FROM debts WHERE id = ?').get(id) as
    | { s: number }
    | undefined;
  return row ? Number(row.s) : NaN;
}

describe('two-device convergence (real server RPCs)', () => {
  it('two devices create different debts -> both converge to both', async () => {
    const { h, a, b } = await twoDevices();
    try {
      h.deviceWrite(a, {
        kind: 'insert',
        table: 'debts',
        row: debtRow('debt-A', HH, { creditor_name: 'Rent' }),
      });
      h.deviceWrite(b, {
        kind: 'insert',
        table: 'debts',
        row: debtRow('debt-B', HH, { creditor_name: 'Fuel' }),
      });

      await settle(h, a, b);

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

  it('concurrent increments both apply -> summed value, no lost update', async () => {
    const { h, a, b } = await twoDevices();
    try {
      // Both devices start with the same envelope at spent=0.
      h.deviceWrite(a, { kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      await h.push(a);
      await h.pull(b, HH);
      expect(spent(a, 'debt-1')).toBe(0);
      expect(spent(b, 'debt-1')).toBe(0);

      // Concurrent offline spends.
      h.deviceWrite(a, {
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 300,
        clamp: 'none',
      });
      h.deviceWrite(b, {
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 700,
        clamp: 'none',
      });

      await settle(h, a, b);

      // THE sync-safety proof: the server summed both deltas; neither was lost.
      expect(spent(a, 'debt-1')).toBe(1000);
      expect(spent(b, 'debt-1')).toBe(1000);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  it('a delete on device A propagates (soft) to device B', async () => {
    const { h, a, b } = await twoDevices();
    try {
      h.deviceWrite(a, { kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      await h.push(a);
      await h.pull(b, HH);

      h.deviceWrite(a, { kind: 'delete', table: 'debts', id: 'debt-1', householdId: HH });
      await settle(h, a, b);

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

  it('duplicate push (same op twice) is an idempotent no-op on the server', async () => {
    const { h, a, b } = await twoDevices();
    try {
      h.deviceWrite(a, { kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      h.deviceWrite(a, {
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 300,
        clamp: 'none',
      });
      await h.push(a);

      // Simulate a lost ack: the client never learned the push succeeded, so it
      // re-drains and re-pushes the SAME ops. The server must dedupe by op_id.
      a.raw.exec('UPDATE oplog SET pushed_at = NULL');
      const results = await h.push(a);
      expect(results.every((r) => r.status === 'applied' && r.code === 'duplicate')).toBe(true);

      // Pull B: the increment must have been applied exactly once server-side.
      await h.pull(b, HH);
      expect(spent(b, 'debt-1')).toBe(300);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  it('offline write then push after the other advanced -> no lost write', async () => {
    const { h, a, b } = await twoDevices();
    try {
      h.deviceWrite(a, { kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
      await h.push(a);
      await h.pull(b, HH);

      // B writes offline (no push/pull yet).
      h.deviceWrite(b, {
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 500,
        clamp: 'none',
      });

      // A advances independently and syncs to the server.
      h.deviceWrite(a, {
        kind: 'increment',
        table: 'debts',
        id: 'debt-1',
        householdId: HH,
        field: 'total_paid_cents',
        delta: 200,
        clamp: 'none',
      });
      await h.push(a);

      // B comes back online: its offline write must still replicate.
      await settle(h, a, b);

      expect(spent(a, 'debt-1')).toBe(700);
      expect(spent(b, 'debt-1')).toBe(700);
      expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
    } finally {
      h.closeAll();
    }
  });

  // --------------------------------------------------------------------------
  // Property-based interleaving fuzzer (R7 §1 convergence + conservation).
  // --------------------------------------------------------------------------

  it('random interleavings converge and conserve the increment total', async () => {
    type Cmd =
      | { t: 'inc'; dev: 'A' | 'B'; delta: number }
      | { t: 'del'; dev: 'A' | 'B' }
      | { t: 'push'; dev: 'A' | 'B' }
      | { t: 'pull'; dev: 'A' | 'B' };

    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.record({
        t: fc.constant('inc' as const),
        dev: fc.constantFrom('A', 'B'),
        delta: fc.integer({ min: 1, max: 500 }),
      }),
      fc.record({ t: fc.constant('del' as const), dev: fc.constantFrom('A', 'B') }),
      fc.record({ t: fc.constant('push' as const), dev: fc.constantFrom('A', 'B') }),
      fc.record({ t: fc.constant('pull' as const), dev: fc.constantFrom('A', 'B') }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 14 }), async (cmds) => {
        await client.query('SAVEPOINT run');
        const h = new TwoDeviceHarness(client);
        try {
          await seedHousehold(client, HH);
          const a = h.addDevice('devA', TEST_USER_UUID);
          const b = h.addDevice('devB', TEST_USER_UUID);
          const byName = { A: a, B: b };

          // Both devices start with the shared envelope at spent=0.
          h.deviceWrite(a, { kind: 'insert', table: 'debts', row: debtRow('debt-1', HH) });
          await h.push(a);
          await h.pull(b, HH);

          let totalDelta = 0;
          for (const c of cmds) {
            const dev = byName[c.dev];
            if (c.t === 'inc') {
              h.deviceWrite(dev, {
                kind: 'increment',
                table: 'debts',
                id: 'debt-1',
                householdId: HH,
                field: 'total_paid_cents',
                delta: c.delta,
                clamp: 'none',
              });
              totalDelta += c.delta;
            } else if (c.t === 'del') {
              const alive = dev.raw
                .prepare('SELECT deleted_at FROM debts WHERE id = ?')
                .get('debt-1') as { deleted_at: string | null } | undefined;
              if (alive && alive.deleted_at == null) {
                h.deviceWrite(dev, {
                  kind: 'delete',
                  table: 'debts',
                  id: 'debt-1',
                  householdId: HH,
                });
              }
            } else if (c.t === 'push') {
              await h.push(dev);
            } else {
              await h.pull(dev, HH);
            }
          }

          // Settle: flush everything both ways (two rounds is ample).
          await settle(h, a, b);
          await settle(h, a, b);

          // Convergence + conservation (no lost increment).
          expect(h.snapshot(a, 'debts', HH)).toEqual(h.snapshot(b, 'debts', HH));
          expect(spent(a, 'debt-1')).toBe(totalDelta);
          expect(spent(b, 'debt-1')).toBe(totalDelta);
        } finally {
          h.closeAll();
          await client.query('ROLLBACK TO SAVEPOINT run');
          await client.query('RELEASE SAVEPOINT run');
        }
      }),
      { numRuns: 40 },
    );
  });
});

// tests/realsql/twoDevice/debtPaymentServerDerived.test.ts
//
// THE SERVER-ROW GATE for debts.total_paid_cents
// (supabase/migrations/0018_debt_total_paid_server_derived.sql).
//
// Every other file in this tier asserts convergence by comparing the two
// devices' LOCAL SQLite tables. That is the right assertion for convergence,
// but it cannot see this bug at all: a debt payment is pushed as TWO
// INDEPENDENT `increment` ops (balance -X clamp floor_zero, total_paid +X
// clamp none — see src/domain/debtSnowball/LogDebtPaymentUseCase.ts), and when
// two devices each pay X against a debt that only owes X the balance clamps at
// 0 while total_paid_cents climbs to 2X. Both devices still AGREE locally
// (each folds in its own increment and then the other's), so a local-only
// assertion stays green while the SERVER row — the row every client
// ultimately converges onto via SyncEngine.reconcileIncrementedRows — holds
// money that was never paid.
//
// So this file asserts the SERVER row DIRECTLY, read back through the same pg
// client the harness uses (the pattern householdBootstrap.test.ts uses:
// `client.query('SELECT ... FROM public.debts ...')`). Each "device" is its own
// sync_push batch carrying its own device_id, which is exactly what reaches the
// server from two real phones; the per-household advisory lock sync_push takes
// means a genuine concurrent race reduces to one of the orderings below.
//
// Setup/teardown mirrors the sibling files exactly: one pg client for the file,
// a per-test BEGIN/ROLLBACK so nothing is left behind, and auth.uid() driven by
// the request.jwt.claims GUC via setSessionUser(). Needs the local Supabase
// stack; CI's `db` job provides it.

import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { seedHousehold, setSessionUser } from './harness';

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

interface PushResult {
  op_id: string;
  status: 'applied' | 'rejected';
  code: string | null;
}

/** The server's view of the debt row, with bigint cast to int so pg returns a number. */
interface ServerDebt {
  outstanding_balance_cents: number;
  total_paid_cents: number;
  is_paid_off: boolean;
}

let client: Client;

beforeAll(async () => {
  client = new Client({ ...PG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Debt-payment server-row gate could not reach local Postgres at ${PG.host}:${PG.port} ` +
        `(${(e as Error).message}). Start the local Supabase stack (\`supabase start\`) — this ` +
        `tier drives the REAL sync_push RPC and cannot run without it.`,
    );
  }
});

afterAll(async () => {
  if (client) await client.end();
});

// Per-test transaction: everything sync_push writes is rolled back afterwards.
beforeEach(async () => {
  await client.query('BEGIN');
});
afterEach(async () => {
  await client.query('ROLLBACK');
});

const NOW = '2026-01-01T00:00:00.000Z';
let seq = 0;
function clientCreatedAt(): string {
  seq += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + seq).toISOString();
}

async function push(ops: Record<string, unknown>[]): Promise<PushResult[]> {
  const res = await client.query<{ r: PushResult[] }>('SELECT public.sync_push($1::jsonb) AS r', [
    JSON.stringify(ops),
  ]);
  return res.rows[0].r;
}

/**
 * The `insert` op CreateDebtUseCase emits, shaped like the client's toWireOp
 * output (payload carries NO id/household_id — those ride as top-level
 * row_id/household_id).
 */
function debtInsertOp(
  householdId: string,
  debtId: string,
  balanceCents: number,
  deviceId: string,
): Record<string, unknown> {
  return {
    v: '1',
    op_id: randomUUID(),
    household_id: householdId,
    table: 'debts',
    row_id: debtId,
    op_type: 'insert',
    payload: {
      creditor_name: 'Visa',
      debt_type: 'credit_card',
      outstanding_balance_cents: balanceCents,
      interest_rate_percent: 19.9,
      minimum_payment_cents: 1000,
      initial_balance_cents: balanceCents,
      total_paid_cents: 0,
      created_at: NOW,
      updated_at: NOW,
    },
    device_id: deviceId,
    client_created_at: clientCreatedAt(),
  };
}

/**
 * The TWO ops one real payment produces, in the order LogDebtPaymentUseCase
 * appends them: balance down (clamped at zero) and total paid up (unclamped).
 */
function paymentOps(
  householdId: string,
  debtId: string,
  amountCents: number,
  deviceId: string,
): Record<string, unknown>[] {
  return [
    {
      v: '1',
      op_id: randomUUID(),
      household_id: householdId,
      table: 'debts',
      row_id: debtId,
      op_type: 'increment',
      payload: {
        field: 'outstanding_balance_cents',
        delta: -amountCents,
        clamp: 'floor_zero',
      },
      device_id: deviceId,
      client_created_at: clientCreatedAt(),
    },
    {
      v: '1',
      op_id: randomUUID(),
      household_id: householdId,
      table: 'debts',
      row_id: debtId,
      op_type: 'increment',
      payload: {
        field: 'total_paid_cents',
        delta: amountCents,
        clamp: 'none',
      },
      device_id: deviceId,
      client_created_at: clientCreatedAt(),
    },
  ];
}

/** Reads the debt as it actually stands ON THE SERVER. */
async function serverDebt(debtId: string): Promise<ServerDebt> {
  const res = await client.query<ServerDebt>(
    `SELECT outstanding_balance_cents,
            total_paid_cents::int AS total_paid_cents,
            is_paid_off
     FROM public.debts WHERE id = $1`,
    [debtId],
  );
  expect(res.rowCount).toBe(1);
  return res.rows[0];
}

/** Seeds a household + an owner + a debt owing `balanceCents`, all through real RPCs. */
async function seedDebt(balanceCents: number): Promise<{ householdId: string; debtId: string }> {
  const owner = randomUUID();
  const householdId = randomUUID();
  const debtId = randomUUID();
  await setSessionUser(client, owner);
  await seedHousehold(client, householdId, owner);

  const created = await push([debtInsertOp(householdId, debtId, balanceCents, 'devA')]);
  expect(created.map((r) => r.status)).toEqual(['applied']);
  const row = await serverDebt(debtId);
  expect(row.outstanding_balance_cents).toBe(balanceCents);
  expect(row.total_paid_cents).toBe(0);

  return { householdId, debtId };
}

/** Every op applied, with a null code — the answer EVERY build in the field expects. */
function expectAllApplied(results: PushResult[], count: number): void {
  expect(results).toHaveLength(count);
  expect(results.every((r) => r.status === 'applied')).toBe(true);
  expect(results.every((r) => r.code === null)).toBe(true);
}

describe('debts.total_paid_cents is server-derived (real sync_push, server row asserted)', () => {
  it('a single payment moves the balance down and total_paid up by the same amount', async () => {
    const { householdId, debtId } = await seedDebt(50_000);

    expectAllApplied(await push(paymentOps(householdId, debtId, 30_000, 'devA')), 2);

    const row = await serverDebt(debtId);
    expect(row.outstanding_balance_cents).toBe(20_000);
    expect(row.total_paid_cents).toBe(30_000);
    expect(row.is_paid_off).toBe(false);
  });

  it('an overpayment credits ONLY what was owed, not the whole payment', async () => {
    const { householdId, debtId } = await seedDebt(10_000);

    // 25000 paid against a debt owing 10000.
    expectAllApplied(await push(paymentOps(householdId, debtId, 25_000, 'devA')), 2);

    const row = await serverDebt(debtId);
    expect(row.outstanding_balance_cents).toBe(0);
    // Before 0018 this was 25000 — 15000 of money that was never paid.
    expect(row.total_paid_cents).toBe(10_000);
    expect(row.is_paid_off).toBe(true);
  });

  it('two devices each paying X against a debt owing X credit X once, not 2X (pair after pair)', async () => {
    const { householdId, debtId } = await seedDebt(40_000);

    // Device A's whole payment, then device B's whole payment.
    expectAllApplied(await push(paymentOps(householdId, debtId, 40_000, 'devA')), 2);
    expectAllApplied(await push(paymentOps(householdId, debtId, 40_000, 'devB')), 2);

    const row = await serverDebt(debtId);
    expect(row.outstanding_balance_cents).toBe(0);
    // THE PROOF: before 0018 the balance clamped at 0 but this reached 80000.
    expect(row.total_paid_cents).toBe(40_000);
    expect(row.is_paid_off).toBe(true);
  });

  it('...and with the two devices’ pairs INTERLEAVED, same result', async () => {
    const { householdId, debtId } = await seedDebt(40_000);

    const [aBalance, aTotalPaid] = paymentOps(householdId, debtId, 40_000, 'devA');
    const [bBalance, bTotalPaid] = paymentOps(householdId, debtId, 40_000, 'devB');

    // A balance, B balance, A total_paid, B total_paid — the other ordering a
    // real race can produce once sync_push's per-household lock serializes the
    // two writers.
    expectAllApplied(await push([aBalance, bBalance, aTotalPaid, bTotalPaid]), 4);

    const row = await serverDebt(debtId);
    expect(row.outstanding_balance_cents).toBe(0);
    expect(row.total_paid_cents).toBe(40_000);
    expect(row.is_paid_off).toBe(true);
  });

  it('a lone total_paid_cents increment leaves the server row untouched but is still applied', async () => {
    const { householdId, debtId } = await seedDebt(10_000);

    // No balance op with it — the op an older build could still emit on its
    // own (e.g. a dead-letter retry of just this half of a payment). It must
    // NOT be rejected: no build in the field knows a new reject code, and a
    // rejection would dead-letter it and surface "couldn't be saved to the
    // cloud" for an op the server deliberately ignores.
    const [, totalPaidOnly] = paymentOps(householdId, debtId, 5_000, 'devA');
    expectAllApplied(await push([totalPaidOnly]), 1);

    const row = await serverDebt(debtId);
    expect(row.outstanding_balance_cents).toBe(10_000);
    expect(row.total_paid_cents).toBe(0);

    // And it is still in the oplog, so other devices still pull it.
    const oplog = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.oplog WHERE op_id = $1`,
      [(totalPaidOnly as { op_id: string }).op_id],
    );
    expect(oplog.rows[0].n).toBe(1);
  });
});

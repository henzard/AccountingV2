// tests/realsql/twoDevice/syncRowState.test.ts
//
// M4 regression (audit 2026-07-05): public.sync_row_state threw
//   SQLSTATE 42703  column "household_id" does not exist
// for the 'households' table because public.households has NO household_id
// column (a household IS its own scope). 'households' is in the function's
// table allowlist, so the DLQ "discard" path (SyncEngine.discardDeadLettered ->
// transport.rowState) could never reconcile a dead-lettered households op — it
// was permanently stuck. Migration 0004 special-cases 'households' (scope on the
// row's own id = p_household_id), mirroring apply_one_op's fix from 0002.
//
// This drives the REAL public.sync_row_state RPC against the live local
// Supabase Postgres. Requires migration 0004 applied (fresh `supabase db reset`
// in CI, or applied to the running 54322 stack locally).

import { Client } from 'pg';
import { seedHousehold, setSessionUser } from './harness';

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

const HH = 'hh-rowstate';

let client: Client;

beforeAll(async () => {
  client = new Client({ ...PG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `sync_row_state gate could not reach local Postgres at ${PG.host}:${PG.port} ` +
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

describe('public.sync_row_state — households scope (M4)', () => {
  it('returns the households row instead of raising 42703', async () => {
    await seedHousehold(client, HH);

    // Pre-0004 this raised `column "household_id" does not exist`.
    const res = await client.query<{ s: Record<string, unknown> | null }>(
      "SELECT public.sync_row_state($1, 'households', $1) AS s",
      [HH],
    );
    const row = res.rows[0].s;
    expect(row).not.toBeNull();
    expect(row?.id).toBe(HH);
    // Confirms it read the real household row (seedHousehold sets payday_day = 1).
    expect(row?.payday_day).toBe(1);
  });

  it('scopes households on the membership scope (returns the caller household row)', async () => {
    await seedHousehold(client, HH);

    // For a well-formed households op row_id === household_id; the function
    // scopes on p_household_id (the membership-verified scope) so it never
    // returns a row outside the caller's household.
    const res = await client.query<{ s: Record<string, unknown> | null }>(
      "SELECT public.sync_row_state($1, 'households', 'some-other-id') AS s",
      [HH],
    );
    expect(res.rows[0].s?.id).toBe(HH);
  });

  it('still scopes non-households tables on id + household_id', async () => {
    await seedHousehold(client, HH);
    // A row that does not exist returns null (not an error).
    const res = await client.query<{ s: Record<string, unknown> | null }>(
      "SELECT public.sync_row_state($1, 'debts', 'no-such-debt') AS s",
      [HH],
    );
    expect(res.rows[0].s).toBeNull();
  });
});

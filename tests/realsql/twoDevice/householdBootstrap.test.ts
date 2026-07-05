// tests/realsql/twoDevice/householdBootstrap.test.ts
//
// THE MISSING END-TO-END TEST. Proves a brand-new user can create their FIRST
// household on a real remote purely through the REAL public.sync_push RPC —
// the exact path SyncEngine uses — with NO pre-seeding. Every other tier's
// setup calls seedHousehold(), which inserts the household + owner membership
// DIRECTLY, bypassing sync_push and hiding the bootstrap deadlock this file
// exists to catch (fixed in supabase/migrations/0002_fix_household_bootstrap.sql).
//
// This test constructs the ACTUAL ops CreateHouseholdUseCase produces (a
// `households` insert op + an owner `household_members` insert op, in that
// order, with id/household_id stripped from the payload exactly like the
// client's toWireOp), pushes them through sync_push, and asserts:
//   1. BOTH ops return status 'applied' (NOT rejected / not_member).
//   2. The household + owner membership rows exist on the server.
//   3. The deferred oplog FK is satisfiable (SET CONSTRAINTS ALL IMMEDIATE).
//   4. private.is_household_member is now true for the owner.
//   5. public.create_invitation SUCCEEDS for the owner and returns a code.
// Plus the anti-hijack negative: a DIFFERENT user self-inserting as owner of
// that now-existing household is rejected 'not_member'.

import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { setSessionUser } from './harness';

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

let client: Client;

beforeAll(async () => {
  client = new Client({ ...PG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Household-bootstrap harness could not reach local Postgres at ${PG.host}:${PG.port} ` +
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

/**
 * The two ops CreateHouseholdUseCase emits for a new household, shaped exactly
 * like the client's toWireOp output (payload has NO id/household_id — those ride
 * as top-level row_id/household_id). Household insert FIRST, owner membership
 * SECOND — the input order the server bootstrap + deferred FK rely on.
 */
function createHouseholdOps(
  householdId: string,
  ownerUserId: string,
  deviceId = 'devBoot',
): Record<string, unknown>[] {
  return [
    {
      v: '1',
      op_id: randomUUID(),
      household_id: householdId,
      table: 'households',
      row_id: householdId,
      op_type: 'insert',
      payload: {
        name: 'Bootstrap Household',
        payday_day: 25,
        user_level: 1,
        created_at: NOW,
        updated_at: NOW,
      },
      device_id: deviceId,
      actor_user_id: ownerUserId,
      client_created_at: clientCreatedAt(),
    },
    {
      v: '1',
      op_id: randomUUID(),
      household_id: householdId,
      table: 'household_members',
      row_id: randomUUID(),
      op_type: 'insert',
      payload: {
        user_id: ownerUserId,
        role: 'owner',
        joined_at: NOW,
        updated_at: NOW,
      },
      device_id: deviceId,
      actor_user_id: ownerUserId,
      client_created_at: clientCreatedAt(),
    },
  ];
}

async function push(ops: Record<string, unknown>[]): Promise<PushResult[]> {
  const res = await client.query<{ r: PushResult[] }>('SELECT public.sync_push($1::jsonb) AS r', [
    JSON.stringify(ops),
  ]);
  return res.rows[0].r;
}

describe('household bootstrap through real sync_push (no seedHousehold)', () => {
  it('a brand-new owner creates their first household + membership end-to-end', async () => {
    const owner = randomUUID();
    const householdId = randomUUID();
    await setSessionUser(client, owner);

    const ops = createHouseholdOps(householdId, owner);
    const results = await push(ops);

    // 1. BOTH ops applied — not rejected / not_member.
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(results.every((r) => r.code === null)).toBe(true);

    // 2. Household + owner membership rows exist on the server.
    const hh = await client.query('SELECT name, payday_day FROM public.households WHERE id = $1', [
      householdId,
    ]);
    expect(hh.rowCount).toBe(1);
    expect(hh.rows[0].name).toBe('Bootstrap Household');

    const members = await client.query(
      `SELECT user_id, role FROM public.household_members
       WHERE household_id = $1 AND deleted_at IS NULL`,
      [householdId],
    );
    expect(members.rowCount).toBe(1);
    expect(members.rows[0].user_id).toBe(owner);
    expect(members.rows[0].role).toBe('owner');

    // Both ops recorded in the server oplog.
    const oplog = await client.query(
      `SELECT table_name FROM public.oplog WHERE household_id = $1 ORDER BY seq`,
      [householdId],
    );
    expect(oplog.rows.map((r) => r.table_name)).toEqual(['households', 'household_members']);

    // 3. BUG 2 proof: the deferred oplog->households FK is satisfiable. If the
    // household-insert op's oplog row lacked its household, forcing the check
    // now would raise foreign_key_violation.
    await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeTruthy();

    // 4. Membership is now real for the owner.
    const isMember = await client.query<{ r: boolean }>(
      'SELECT private.is_household_member($1) AS r',
      [householdId],
    );
    expect(isMember.rows[0].r).toBe(true);

    // 5. The owner can now mint an invitation (no "only an owner" error).
    const inv = await client.query<{ r: { code?: string } }>(
      'SELECT public.create_invitation($1) AS r',
      [householdId],
    );
    expect(typeof inv.rows[0].r.code).toBe('string');
    expect((inv.rows[0].r.code as string).length).toBe(6);
  });

  it('rejects a DIFFERENT user self-inserting as owner of an existing household (no hijack)', async () => {
    const owner = randomUUID();
    const attacker = randomUUID();
    const householdId = randomUUID();

    // Owner bootstraps the household for real.
    await setSessionUser(client, owner);
    const bootstrap = await push(createHouseholdOps(householdId, owner));
    expect(bootstrap.map((r) => r.status)).toEqual(['applied', 'applied']);

    // Attacker (different auth.uid()) tries to insert THEMSELVES as owner of
    // the now-member-having household. The "no existing members" guard blocks
    // the bootstrap path and they are not a member -> rejected not_member.
    await setSessionUser(client, attacker);
    const hijackOp = [
      {
        v: '1',
        op_id: randomUUID(),
        household_id: householdId,
        table: 'household_members',
        row_id: randomUUID(),
        op_type: 'insert',
        payload: { user_id: attacker, role: 'owner', joined_at: NOW, updated_at: NOW },
        device_id: 'devAttacker',
        actor_user_id: attacker,
        client_created_at: clientCreatedAt(),
      },
    ];
    const results = await push(hijackOp);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('rejected');
    expect(results[0].code).toBe('not_member');

    // No attacker membership row was created; the owner remains sole member.
    const members = await client.query(
      `SELECT user_id, role FROM public.household_members
       WHERE household_id = $1 AND deleted_at IS NULL`,
      [householdId],
    );
    expect(members.rowCount).toBe(1);
    expect(members.rows[0].user_id).toBe(owner);
  });

  it('rejects an owner-membership op whose user_id is NOT the caller (cannot make someone else owner)', async () => {
    const caller = randomUUID();
    const victim = randomUUID();
    const householdId = randomUUID();
    await setSessionUser(client, caller);

    // households insert + a membership op that names a DIFFERENT user as owner.
    const ops = createHouseholdOps(householdId, victim); // ownerUserId = victim, not caller
    const results = await push(ops);

    // Bootstrap authorization requires the owner membership's user_id =
    // auth.uid(); it does not, so the household is unauthorized for the caller
    // and BOTH ops are rejected not_member (no household is created).
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(results.every((r) => r.code === 'not_member')).toBe(true);

    const hh = await client.query('SELECT 1 FROM public.households WHERE id = $1', [householdId]);
    expect(hh.rowCount).toBe(0);
  });
});

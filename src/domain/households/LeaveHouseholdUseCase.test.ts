import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

const mockRequestSyncNow = jest.fn<Promise<void>, [string]>();
jest.mock('../../data/sync/syncRuntime', () => ({
  requestSyncNow: (householdId: string): Promise<void> => mockRequestSyncNow(householdId),
}));

// `createSyncedRepo` mints oplog op ids with expo-crypto's randomUUID; the
// real package needs the native Expo bridge. Counter-based ids are unique
// (the oplog primary key) and predictable.
let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `op-${++mockUuidCounter}` }));

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from '../../../tests/realsql/harness/openMigratedDb';
import { LeaveHouseholdUseCase } from './LeaveHouseholdUseCase';
import { PurgeLocalHouseholdDataUseCase } from './PurgeLocalHouseholdDataUseCase';

interface MemberRow {
  id: string;
  householdId: string;
  userId: string;
  role: string;
  /** Present only for the resume case — an already-soft-deleted own row. */
  deletedAt?: string | null;
}

/** The oplog counts `inspectLeaveHouseholdPreflight` reads. A list is
 * consumed one entry per call (the sequence asks twice — before the write and
 * after the push — plus once more for the dead-letter count it reports); the
 * last entry is reused once the list runs down. */
interface OplogCounts {
  unsynced: number;
  dead: number;
}

/** Minimal stand-in for what the use case asks of the database: every
 * `household_members` row for the household, the oplog counts, and the
 * purge's own reads/transaction (which find nothing here — the real purge is
 * proven against real SQLite further down). */
function makeDb(
  rows: MemberRow[],
  counts: OplogCounts | OplogCounts[] = { unsynced: 0, dead: 0 },
): ExpoSQLiteDatabase<typeof schema> {
  const queue = Array.isArray(counts) ? [...counts] : [counts];
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
    get: () => {
      const next = queue.length > 1 ? (queue.shift() as OplogCounts) : queue[0];
      return { unsynced: next.unsynced, dead_lettered: next.dead };
    },
    all: () => [],
    transaction: (fn: (tx: { run: () => void }) => void) => fn({ run: () => undefined }),
  } as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function makeRepo(): jest.Mocked<SyncedRepo> {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

const OWNER: MemberRow = { id: 'hm-owner', householdId: 'hh-1', userId: 'u-owner', role: 'owner' };
const CO_OWNER: MemberRow = {
  id: 'hm-owner-2',
  householdId: 'hh-1',
  userId: 'u-owner-2',
  role: 'owner',
};
const MEMBER: MemberRow = {
  id: 'hm-member',
  householdId: 'hh-1',
  userId: 'u-member',
  role: 'member',
};

describe('LeaveHouseholdUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestSyncNow.mockResolvedValue(undefined);
  });

  it('soft-deletes the caller’s own membership row through the synced repo', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The outcome now also reports what the purge cleared. Against this fake
    // db the purge finds no household-scoped tables, so only the `households`
    // delete runs — the real table list is asserted in the real-SQLite block.
    expect(result.data).toEqual({
      householdId: 'hh-1',
      purgedTables: ['households'],
      deadLetteredDiscarded: 0,
    });
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
    expect(repo.softDelete.mock.calls[0][0]).toBe('hm-member');
    expect(repo.softDelete.mock.calls[0][1]).toBe('hh-1');
    expect(mockRequestSyncNow).toHaveBeenCalledWith('hh-1');
  });

  it('lets an owner leave when another active owner remains', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, CO_OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-owner' },
      { repo },
    ).execute();

    expect(result.success).toBe(true);
    expect(repo.softDelete).toHaveBeenCalledWith('hm-owner', 'hh-1', expect.anything());
  });

  it('refuses BEFORE writing when the caller is the only owner and members remain', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-owner' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('LAST_OWNER');
    expect(result.error.message).toMatch(/become an owner before you can leave/);
    // The real guarantee is apply_one_op's `last_owner` rejection, but that
    // surfaces only as a dead letter long after the fact — nothing may be
    // written here.
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(mockRequestSyncNow).not.toHaveBeenCalled();
  });

  it('refuses a sole owner with no other members, matching the server rule', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER]),
      { householdId: 'hh-1', userId: 'u-owner' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('LAST_OWNER');
    expect(result.error.message).toMatch(/nobody to hand it over to/);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('fails with NOT_A_MEMBER when the caller has no active membership row', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER]),
      { householdId: 'hh-1', userId: 'u-stranger' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('NOT_A_MEMBER');
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('fails with LEAVE_FAILED when the synced write throws', async () => {
    const repo = makeRepo();
    repo.softDelete.mockImplementation(() => {
      throw new Error('no row matched');
    });

    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({ code: 'LEAVE_FAILED', message: 'no row matched' });
    // The sync-first round has already run by then (nothing destructive has
    // happened yet, and it is what proves the oplog is drained); what must
    // NOT happen after a failed write is the second, push-the-leave-op round.
    expect(mockRequestSyncNow).toHaveBeenCalledTimes(1);
  });

  it('syncs before touching anything, and refuses when local ops are still unpushed', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER], { unsynced: 3, dead: 0 }),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(mockRequestSyncNow).toHaveBeenCalledWith('hh-1');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('UNSYNCED_CHANGES');
    expect(result.error.message).toBe(
      "Some changes haven't synced yet. Connect to the internet and try again.",
    );
    // Nothing written, nothing destroyed — the phone is exactly as it was.
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('does not let dead letters block leaving — they are discarded, not waited for', async () => {
    const repo = makeRepo();
    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER], { unsynced: 0, dead: 4 }),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo },
    ).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Reported so the caller can say how many were dropped — the server
    // permanently rejected them, so waiting would be waiting forever.
    expect(result.data.deadLetteredDiscarded).toBe(4);
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
  });

  it('refuses to purge while the leave op itself is still only local', async () => {
    const repo = makeRepo();
    mockRequestSyncNow.mockRejectedValue(new Error('offline'));
    const purge = jest.fn();

    const result = await new LeaveHouseholdUseCase(
      // Drained before the write; the leave op itself still unpushed after.
      makeDb(
        [OWNER, MEMBER],
        [
          { unsynced: 0, dead: 0 },
          { unsynced: 1, dead: 0 },
        ],
      ),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo, purge },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('LEAVE_NOT_SYNCED');
    // Purging here would delete the oplog row carrying the departure, and the
    // server would never learn the user left.
    expect(purge).not.toHaveBeenCalled();
    expect(repo.softDelete).toHaveBeenCalledTimes(1);
  });

  it('resumes idempotently: a retry after a failed push re-pushes and purges without writing again', async () => {
    const repo = makeRepo();
    const purge = jest.fn().mockResolvedValue({
      success: true,
      data: { householdId: 'hh-1', purgedTables: ['households'], slipImageDirsDeleted: 0 },
    });

    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, { ...MEMBER, deletedAt: '2026-09-21T00:00:00.000Z' }]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo, purge },
    ).execute();

    expect(result.success).toBe(true);
    // A second softDelete would throw (the row is already tombstoned) AND
    // append a duplicate delete op — the retry must skip straight to the push.
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(mockRequestSyncNow).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith('hh-1');
  });

  it('does not purge when the purge itself fails', async () => {
    const repo = makeRepo();
    const purge = jest.fn().mockResolvedValue({
      success: false,
      error: { code: 'PURGE_FAILED', message: 'database is locked' },
    });

    const result = await new LeaveHouseholdUseCase(
      makeDb([OWNER, MEMBER]),
      { householdId: 'hh-1', userId: 'u-member' },
      { repo, purge },
    ).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('PURGE_FAILED');
  });
});

// ---------------------------------------------------------------------------
// The whole sequence against a REAL migrated better-sqlite3 database. The fake
// db above can prove the decisions; only real SQLite can prove that the
// household's rows are actually gone, that the OTHER household on the same
// phone survived row for row, and that the membership op reached the server
// BEFORE the oplog row carrying it was deleted.
// ---------------------------------------------------------------------------

const NOW = '2026-01-01T00:00:00.000Z';

function seed(raw: Database.Database, hh: string, suffix: string, userId: string): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
       VALUES (?, ?, 25, 1, ?, ?)`,
    )
    .run(hh, `HH ${suffix}`, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)`,
    )
    .run(`hm-${suffix}-owner`, hh, 'u-owner', NOW, NOW);
  raw
    .prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at, updated_at)
       VALUES (?, ?, ?, 'member', ?, ?)`,
    )
    .run(`hm-${suffix}`, hh, userId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO envelopes (id, household_id, name, allocated_cents, envelope_type, period_start, created_at, updated_at)
       VALUES (?, ?, 'Groceries', 50000, 'spending', '2026-01-01', ?, ?)`,
    )
    .run(`env-${suffix}`, hh, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO transactions (id, household_id, envelope_id, amount_cents, transaction_date, created_at, updated_at)
       VALUES (?, ?, ?, 2500, '2026-01-02', ?, ?)`,
    )
    .run(`tx-${suffix}`, hh, `env-${suffix}`, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO debts (id, household_id, creditor_name, debt_type, outstanding_balance_cents,
                          interest_rate_percent, minimum_payment_cents, created_at, updated_at)
       VALUES (?, ?, 'Bank', 'loan', 100000, 12.5, 5000, ?, ?)`,
    )
    .run(`debt-${suffix}`, hh, NOW, NOW);
  raw.prepare(`INSERT INTO sync_cursor (household_id, last_pulled_seq) VALUES (?, 7)`).run(hh);
}

/** One un-pushed op, as an offline write would leave behind. */
function seedUnpushedOp(raw: Database.Database, hh: string, opId: string): void {
  raw
    .prepare(
      `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at, pushed_at)
       VALUES (?, ?, 'transactions', 'tx-a', 'insert', '{}', 'devA', ?, NULL)`,
    )
    .run(opId, hh, NOW);
}

function countRows(raw: Database.Database, table: string, hh: string): number {
  return (
    raw.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE household_id = ?`).get(hh) as {
      c: number;
    }
  ).c;
}

describe('LeaveHouseholdUseCase — the full sequence (real migrated SQLite)', () => {
  let raw: Database.Database;
  let db: ReturnType<typeof drizzle>;
  let events: string[];

  /** A stand-in for a sync round that reaches the server: it marks this
   * household's eligible ops pushed, and records what it found waiting. */
  function installWorkingSync(): void {
    mockRequestSyncNow.mockImplementation(async (hh: string) => {
      const pending = raw
        .prepare(
          `SELECT table_name FROM oplog WHERE household_id = ? AND pushed_at IS NULL AND dead_lettered_at IS NULL ORDER BY table_name`,
        )
        .all(hh) as { table_name: string }[];
      events.push(`sync[${pending.map((p) => p.table_name).join(',')}]`);
      raw
        .prepare(
          `UPDATE oplog SET pushed_at = ? WHERE household_id = ? AND pushed_at IS NULL AND dead_lettered_at IS NULL`,
        )
        .run(NOW, hh);
    });
  }

  /** The real purge, wrapped so the test can see WHEN it ran and what the
   * oplog looked like at that exact moment. */
  function recordingPurge(): (id: string) => Promise<ReturnType<never>> {
    return (async (id: string) => {
      const unpushed = (
        raw
          .prepare(
            `SELECT COUNT(*) AS c FROM oplog WHERE household_id = ? AND pushed_at IS NULL AND dead_lettered_at IS NULL`,
          )
          .get(id) as { c: number }
      ).c;
      events.push(`purge[unpushed=${unpushed}]`);
      return new PurgeLocalHouseholdDataUseCase(db as never, { householdId: id }).execute();
    }) as never;
  }

  beforeEach(() => {
    mockUuidCounter = 0;
    events = [];
    raw = openMigratedDb();
    db = drizzle(raw);
    seed(raw, 'hh-1', 'a', 'u-member');
    seed(raw, 'hh-2', 'b', 'u-member');
    installWorkingSync();
  });

  afterEach(() => {
    raw.close();
  });

  it('refuses, non-destructively, while an op for this household is unpushed', async () => {
    // An op the fake sync cannot clear — the round reports success but the
    // op is still there, which is exactly what an offline phone looks like.
    seedUnpushedOp(raw, 'hh-1', 'op-stuck');
    mockRequestSyncNow.mockResolvedValue(undefined);

    const result = await new LeaveHouseholdUseCase(db as never, {
      householdId: 'hh-1',
      userId: 'u-member',
    }).execute();

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('UNSYNCED_CHANGES');
    // Nothing changed: still a member, still every row.
    expect(
      raw.prepare(`SELECT deleted_at FROM household_members WHERE id = 'hm-a'`).get() as {
        deleted_at: string | null;
      },
    ).toEqual({ deleted_at: null });
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(countRows(raw, 'envelopes', 'hh-1')).toBe(1);
    expect(countRows(raw, 'sync_cursor', 'hh-1')).toBe(1);
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM oplog`).get()).toEqual({ c: 1 });
  });

  it('pushes the membership op BEFORE purging, then empties every table for that household', async () => {
    const result = await new LeaveHouseholdUseCase(
      db as never,
      { householdId: 'hh-1', userId: 'u-member' },
      { purge: recordingPurge() },
    ).execute();

    expect(result.success).toBe(true);
    // The order the product depends on: drain, write+push the departure,
    // and only then destroy the oplog row that carried it.
    expect(events).toEqual(['sync[]', 'sync[household_members]', 'purge[unpushed=0]']);

    for (const table of [
      'household_members',
      'envelopes',
      'transactions',
      'debts',
      'oplog',
      'sync_cursor',
    ]) {
      expect({ table, rows: countRows(raw, table, 'hh-1') }).toEqual({ table, rows: 0 });
    }
    expect(raw.prepare(`SELECT id FROM households`).all()).toEqual([{ id: 'hh-2' }]);
  });

  it('leaves the other household on the same phone untouched, row for row', async () => {
    const before = raw
      .prepare(
        `SELECT 'tx' AS t, id AS k FROM transactions WHERE household_id = 'hh-2'
         UNION ALL SELECT 'env', id FROM envelopes WHERE household_id = 'hh-2'
         UNION ALL SELECT 'debt', id FROM debts WHERE household_id = 'hh-2'
         UNION ALL SELECT 'hm', id FROM household_members WHERE household_id = 'hh-2'
         UNION ALL SELECT 'cursor', household_id FROM sync_cursor WHERE household_id = 'hh-2'
         ORDER BY t, k`,
      )
      .all();

    await new LeaveHouseholdUseCase(db as never, {
      householdId: 'hh-1',
      userId: 'u-member',
    }).execute();

    const after = raw
      .prepare(
        `SELECT 'tx' AS t, id AS k FROM transactions WHERE household_id = 'hh-2'
         UNION ALL SELECT 'env', id FROM envelopes WHERE household_id = 'hh-2'
         UNION ALL SELECT 'debt', id FROM debts WHERE household_id = 'hh-2'
         UNION ALL SELECT 'hm', id FROM household_members WHERE household_id = 'hh-2'
         UNION ALL SELECT 'cursor', household_id FROM sync_cursor WHERE household_id = 'hh-2'
         ORDER BY t, k`,
      )
      .all();

    expect(after).toEqual(before);
    expect(after.length).toBeGreaterThan(0);
  });

  it('purges through the default wiring too (no injected purge)', async () => {
    const result = await new LeaveHouseholdUseCase(db as never, {
      householdId: 'hh-1',
      userId: 'u-member',
    }).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.purgedTables).toContain('transactions');
    expect(result.data.purgedTables).toContain('oplog');
    expect(result.data.purgedTables[result.data.purgedTables.length - 1]).toBe('households');
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(0);
  });

  it('a failed push leaves a member-in-limbo that a retry completes', async () => {
    // Round 1: the push never reaches the server, so the leave op stays local.
    mockRequestSyncNow.mockRejectedValue(new Error('offline'));
    const first = await new LeaveHouseholdUseCase(db as never, {
      householdId: 'hh-1',
      userId: 'u-member',
    }).execute();

    expect(first.success).toBe(false);
    if (first.success) return;
    expect(first.error.code).toBe('LEAVE_NOT_SYNCED');
    // Membership retired locally, but NOTHING destroyed and the op is queued.
    expect(
      raw.prepare(`SELECT deleted_at FROM household_members WHERE id = 'hm-a'`).get(),
    ).not.toEqual({ deleted_at: null });
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(
      raw
        .prepare(
          `SELECT COUNT(*) AS c FROM oplog WHERE household_id = 'hh-1' AND table_name = 'household_members' AND pushed_at IS NULL`,
        )
        .get(),
    ).toEqual({ c: 1 });

    // Round 2: back online. The retry must NOT write a second delete op.
    events = [];
    installWorkingSync();
    const second = await new LeaveHouseholdUseCase(db as never, {
      householdId: 'hh-1',
      userId: 'u-member',
    }).execute();

    expect(second.success).toBe(true);
    expect(events).toEqual(['sync[household_members]']);
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(0);
    expect(raw.prepare(`SELECT id FROM households`).all()).toEqual([{ id: 'hh-2' }]);
    expect(countRows(raw, 'transactions', 'hh-2')).toBe(1);
  });

  it('discards dead letters rather than blocking on them forever', async () => {
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at, pushed_at, dead_lettered_at)
         VALUES ('op-dead', 'hh-1', 'transactions', 'tx-a', 'insert', '{}', 'devA', ?, NULL, ?)`,
      )
      .run(NOW, NOW);

    const result = await new LeaveHouseholdUseCase(db as never, {
      householdId: 'hh-1',
      userId: 'u-member',
    }).execute();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.deadLetteredDiscarded).toBe(1);
    expect(raw.prepare(`SELECT COUNT(*) AS c FROM oplog`).get()).toEqual({ c: 0 });
  });
});

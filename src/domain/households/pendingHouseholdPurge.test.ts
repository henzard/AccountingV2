/**
 * The interrupted-leave markers and the boot resume that pays them off.
 *
 * The decisions are made against a REAL migrated better-sqlite3 database (the
 * same tier `LeaveHouseholdUseCase.test.ts` uses for its sequence): the whole
 * point of the resume is which rows are still on the phone afterwards, and
 * only real SQLite can prove that.
 */

/** In-memory AsyncStorage — the markers have to survive a "process kill",
 * which here is simply building a fresh resume call over the same store. */
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => Promise.resolve(mockStore.get(key) ?? null),
  setItem: (key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  },
  getAllKeys: () => Promise.resolve([...mockStore.keys()]),
}));

// Indirected through functions because `jest.mock` is hoisted above the
// `const` below — the factory runs before `mockLogger` is initialised, but
// the wrappers only read it when a log actually happens.
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLogger.info(...args),
    warn: (...args: unknown[]) => mockLogger.warn(...args),
    error: (...args: unknown[]) => mockLogger.error(...args),
  },
}));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from '../../../tests/realsql/harness/openMigratedDb';
import type { PortableDb } from '../../data/uow/UnitOfWork';
import { PurgeLocalHouseholdDataUseCase } from './PurgeLocalHouseholdDataUseCase';
import {
  PENDING_PURGE_STALE_MS,
  clearPendingHouseholdPurge,
  ensurePendingHouseholdPurge,
  listPendingHouseholdPurges,
  readPendingHouseholdPurge,
  resetPendingPurgeStaleReports,
  resumePendingHouseholdPurge,
} from './pendingHouseholdPurge';

const NOW = '2026-01-01T00:00:00.000Z';
const USER = 'u-member';
const OTHER_USER = 'u-other';
const key = (userId: string, householdId: string): string =>
  `@pending_household_purge:${userId}:${householdId}`;
/** The single-household key an older build wrote. */
const legacyKey = (userId: string): string => `@pending_household_purge:${userId}`;
const KEY_1 = key(USER, 'hh-1');
const KEY_2 = key(USER, 'hh-2');

/** One household with its owner, the leaving member, and enough financial
 * rows that a purge (or a wrongly-skipped one) is visible. */
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
       VALUES (?, ?, 'u-owner', 'owner', ?, ?)`,
    )
    .run(`hm-${suffix}-owner`, hh, NOW, NOW);
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
}

/** The state a kill leaves behind: the member's own row tombstoned. */
function tombstoneMember(raw: Database.Database, memberRowId: string): void {
  raw
    .prepare(`UPDATE household_members SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .run(NOW, NOW, memberRowId);
}

function insertOp(
  raw: Database.Database,
  hh: string,
  opId: string,
  columns: { pushedAt?: string | null; deadLetteredAt?: string | null } = {},
): void {
  raw
    .prepare(
      `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id,
                          client_created_at, pushed_at, dead_lettered_at)
       VALUES (?, ?, 'household_members', 'hm-a', 'delete', '{}', 'devA', ?, ?, ?)`,
    )
    .run(opId, hh, NOW, columns.pushedAt ?? null, columns.deadLetteredAt ?? null);
}

function countRows(raw: Database.Database, table: string, hh: string): number {
  return (
    raw.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE household_id = ?`).get(hh) as {
      c: number;
    }
  ).c;
}

function householdExists(raw: Database.Database, hh: string): boolean {
  return (
    (raw.prepare(`SELECT COUNT(*) AS c FROM households WHERE id = ?`).get(hh) as { c: number }).c >
    0
  );
}

describe('pendingHouseholdPurge — the markers', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('reads back nothing when no leave is pending', async () => {
    await expect(readPendingHouseholdPurge(USER, 'hh-1')).resolves.toBeNull();
    await expect(listPendingHouseholdPurges(USER)).resolves.toEqual([]);
  });

  it('records the household, the user and when it was requested, under a per-household key', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);

    expect(JSON.parse(mockStore.get(KEY_1) as string)).toEqual({
      householdId: 'hh-1',
      userId: USER,
      requestedAt: NOW,
    });
    await expect(readPendingHouseholdPurge(USER, 'hh-1')).resolves.toEqual({
      householdId: 'hh-1',
      userId: USER,
      requestedAt: NOW,
    });
  });

  it('keeps a second household’s pending purge instead of overwriting it', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    await ensurePendingHouseholdPurge(USER, 'hh-2', '2026-02-02T00:00:00.000Z');

    // Both debts survive — the limbo case that a single per-user key lost.
    await expect(listPendingHouseholdPurges(USER)).resolves.toEqual([
      { householdId: 'hh-1', userId: USER, requestedAt: NOW },
      { householdId: 'hh-2', userId: USER, requestedAt: '2026-02-02T00:00:00.000Z' },
    ]);
  });

  it('keeps the original requestedAt when a retry re-asserts the same household', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    await ensurePendingHouseholdPurge(USER, 'hh-1', '2026-03-03T00:00:00.000Z');

    await expect(readPendingHouseholdPurge(USER, 'hh-1')).resolves.toMatchObject({
      requestedAt: NOW,
    });
  });

  it('clears only the household it was asked to clear', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    await ensurePendingHouseholdPurge(USER, 'hh-2', NOW);

    await clearPendingHouseholdPurge(USER, 'hh-1');

    expect(mockStore.get(KEY_1)).toBeUndefined();
    expect(mockStore.get(KEY_2)).toBeDefined();
  });

  it('clearing also drops a legacy key that names the same household', async () => {
    // Reachable when the migration's rewrite failed but the purge then went
    // ahead from the legacy marker this boot already held.
    mockStore.set(
      legacyKey(USER),
      JSON.stringify({ householdId: 'hh-1', userId: USER, requestedAt: NOW }),
    );

    await clearPendingHouseholdPurge(USER, 'hh-1');

    expect(mockStore.get(legacyKey(USER))).toBeUndefined();
  });

  it('never reads, and never clears, another user’s markers', async () => {
    await ensurePendingHouseholdPurge(OTHER_USER, 'hh-1', NOW);

    await expect(readPendingHouseholdPurge(USER, 'hh-1')).resolves.toBeNull();
    await expect(listPendingHouseholdPurges(USER)).resolves.toEqual([]);
    await clearPendingHouseholdPurge(USER, 'hh-1');
    await expect(readPendingHouseholdPurge(OTHER_USER, 'hh-1')).resolves.toMatchObject({
      householdId: 'hh-1',
    });
  });

  it('does not mistake a user id that merely PREFIXES this one', async () => {
    // `u` and `u-member` would collide under an un-terminated prefix match.
    await ensurePendingHouseholdPurge('u', 'hh-9', NOW);
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);

    await expect(listPendingHouseholdPurges('u')).resolves.toEqual([
      { householdId: 'hh-9', userId: 'u', requestedAt: NOW },
    ]);
  });

  it('migrates an older build’s single-household marker, then drops the legacy key', async () => {
    mockStore.set(
      legacyKey(USER),
      JSON.stringify({ householdId: 'hh-1', userId: USER, requestedAt: NOW }),
    );

    await expect(listPendingHouseholdPurges(USER)).resolves.toEqual([
      { householdId: 'hh-1', userId: USER, requestedAt: NOW },
    ]);
    // Rewritten under the new key BEFORE the legacy one was removed — the
    // pending purge cannot be lost by the upgrade.
    expect(JSON.parse(mockStore.get(KEY_1) as string)).toMatchObject({ householdId: 'hh-1' });
    expect(mockStore.get(legacyKey(USER))).toBeUndefined();
  });

  it('keeps the legacy marker when it cannot be rewritten', async () => {
    mockStore.set(
      legacyKey(USER),
      JSON.stringify({ householdId: 'hh-1', userId: USER, requestedAt: NOW }),
    );
    const storage = jest.requireMock('@react-native-async-storage/async-storage') as {
      setItem: (key: string, value: string) => Promise<void>;
    };
    const realSetItem = storage.setItem;
    storage.setItem = () => Promise.reject(new Error('Storage full'));

    try {
      await expect(listPendingHouseholdPurges(USER)).resolves.toEqual([
        { householdId: 'hh-1', userId: USER, requestedAt: NOW },
      ]);
    } finally {
      storage.setItem = realSetItem;
    }
    // Nothing was lost: the legacy key is still there for the next boot.
    expect(mockStore.get(legacyKey(USER))).toBeDefined();
  });

  it('treats an unparseable or foreign value as no marker at all', async () => {
    mockStore.set(KEY_1, 'not json');
    await expect(readPendingHouseholdPurge(USER, 'hh-1')).resolves.toBeNull();

    mockStore.set(
      KEY_1,
      JSON.stringify({ householdId: 'hh-1', userId: OTHER_USER, requestedAt: NOW }),
    );
    await expect(readPendingHouseholdPurge(USER, 'hh-1')).resolves.toBeNull();

    // A value naming a household other than its own key is corrupt: purging
    // the wrong household is the one mistake this module may never make.
    mockStore.set(KEY_1, JSON.stringify({ householdId: 'hh-9', userId: USER, requestedAt: NOW }));
    await expect(listPendingHouseholdPurges(USER)).resolves.toEqual([]);
  });

  it('does not fail the leave when storage is unavailable', async () => {
    const storage = jest.requireMock('@react-native-async-storage/async-storage') as {
      setItem: (key: string, value: string) => Promise<void>;
    };
    const realSetItem = storage.setItem;
    storage.setItem = () => Promise.reject(new Error('Storage full'));

    try {
      await expect(ensurePendingHouseholdPurge(USER, 'hh-1', NOW)).resolves.toBeUndefined();
    } finally {
      storage.setItem = realSetItem;
    }
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe('pendingHouseholdPurge — resume at boot (real migrated SQLite)', () => {
  let raw: Database.Database;
  let db: PortableDb;

  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    resetPendingPurgeStaleReports();
    raw = openMigratedDb();
    db = drizzle(raw) as unknown as PortableDb;
    seed(raw, 'hh-1', 'a', USER);
    seed(raw, 'hh-2', 'b', USER);
  });

  afterEach(() => {
    raw.close();
  });

  it('finishes a leave killed between the pushed leave op and the purge', async () => {
    // Exactly the kill window: marker written, membership tombstoned, the
    // leave op pushed — and every financial row still on the phone.
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');
    insertOp(raw, 'hh-1', 'op-leave', { pushedAt: NOW });
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'purged' },
    ]);

    expect(countRows(raw, 'transactions', 'hh-1')).toBe(0);
    expect(countRows(raw, 'envelopes', 'hh-1')).toBe(0);
    expect(countRows(raw, 'debts', 'hh-1')).toBe(0);
    expect(countRows(raw, 'household_members', 'hh-1')).toBe(0);
    expect(householdExists(raw, 'hh-1')).toBe(false);
    // The marker is spent.
    expect(mockStore.get(KEY_1)).toBeUndefined();
  });

  it('touches no other household on the phone', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');

    await resumePendingHouseholdPurge({ db, userId: USER });

    expect(countRows(raw, 'transactions', 'hh-2')).toBe(1);
    expect(countRows(raw, 'envelopes', 'hh-2')).toBe(1);
    expect(countRows(raw, 'debts', 'hh-2')).toBe(1);
    expect(countRows(raw, 'household_members', 'hh-2')).toBe(2);
    expect(householdExists(raw, 'hh-2')).toBe(true);
  });

  it('resolves two pending households INDEPENDENTLY — one purged, one still waiting', async () => {
    // hh-1 is ready; hh-2 still has an un-pushed op. Neither may affect the
    // other's outcome.
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    await ensurePendingHouseholdPurge(USER, 'hh-2', '2026-02-02T00:00:00.000Z');
    tombstoneMember(raw, 'hm-a');
    tombstoneMember(raw, 'hm-b');
    insertOp(raw, 'hh-2', 'op-stuck', { pushedAt: null });

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'purged' },
      { householdId: 'hh-2', action: 'waiting-for-sync' },
    ]);

    expect(householdExists(raw, 'hh-1')).toBe(false);
    expect(countRows(raw, 'transactions', 'hh-2')).toBe(1);
    expect(householdExists(raw, 'hh-2')).toBe(true);
    // Only the finished one's marker is spent.
    expect(mockStore.get(KEY_1)).toBeUndefined();
    expect(mockStore.get(KEY_2)).toBeDefined();
  });

  it('one household throwing does not strand the other', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    await ensurePendingHouseholdPurge(USER, 'hh-2', '2026-02-02T00:00:00.000Z');
    tombstoneMember(raw, 'hm-a');
    tombstoneMember(raw, 'hm-b');

    const results = await resumePendingHouseholdPurge({
      db,
      userId: USER,
      purge: (id) => {
        if (id === 'hh-1') throw new Error('database disk image is malformed');
        return new PurgeLocalHouseholdDataUseCase(db, { householdId: id }).execute();
      },
    });

    expect(results).toEqual([
      { householdId: 'hh-1', action: 'failed' },
      { householdId: 'hh-2', action: 'purged' },
    ]);
    expect(householdExists(raw, 'hh-1')).toBe(true);
    expect(mockStore.get(KEY_1)).toBeDefined();
    expect(householdExists(raw, 'hh-2')).toBe(false);
    expect(mockStore.get(KEY_2)).toBeUndefined();
  });

  it('does NOT purge while ops for that household are still un-pushed, and keeps the marker', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');
    insertOp(raw, 'hh-1', 'op-leave', { pushedAt: null });

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'waiting-for-sync' },
    ]);

    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(householdExists(raw, 'hh-1')).toBe(true);
    expect(mockStore.get(KEY_1)).toBeDefined();

    // Once a sync round has drained them — the pusher is NOT household-scoped
    // (`SyncEngine.fetchPushable` has no household predicate), so an ordinary
    // round reaches these even though the household is no longer active — the
    // next boot finishes the job.
    raw.prepare(`UPDATE oplog SET pushed_at = ? WHERE pushed_at IS NULL`).run(NOW);
    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'purged' },
    ]);
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(0);
  });

  it('does not let dead letters hold the purge up forever', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');
    insertOp(raw, 'hh-1', 'op-dead', { pushedAt: null, deadLetteredAt: NOW });

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'purged' },
    ]);
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(0);
  });

  it('clears the marker and deletes nothing when the membership is still active', async () => {
    // The process died BEFORE the soft delete committed: the leave never
    // happened, and the user still sees the household.
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'membership-active' },
    ]);

    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(householdExists(raw, 'hh-1')).toBe(true);
    expect(mockStore.get(KEY_1)).toBeUndefined();
  });

  it('keeps every row for an OWNER-REMOVAL: a tombstone with no marker is not a leave', async () => {
    // Identical local state to the kill window, minus the intent.
    tombstoneMember(raw, 'hm-a');
    insertOp(raw, 'hh-1', 'op-removed', { pushedAt: NOW });

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([]);

    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(countRows(raw, 'envelopes', 'hh-1')).toBe(1);
    expect(countRows(raw, 'debts', 'hh-1')).toBe(1);
    expect(countRows(raw, 'household_members', 'hh-1')).toBe(2);
    expect(householdExists(raw, 'hh-1')).toBe(true);
  });

  it('ignores markers belonging to someone else who shares this phone', async () => {
    await ensurePendingHouseholdPurge(OTHER_USER, 'hh-1', NOW);
    await ensurePendingHouseholdPurge(OTHER_USER, 'hh-2', NOW);
    tombstoneMember(raw, 'hm-a');

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([]);

    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(householdExists(raw, 'hh-1')).toBe(true);
    // And their markers are still waiting for them.
    expect(mockStore.get(key(OTHER_USER, 'hh-1'))).toBeDefined();
    expect(mockStore.get(key(OTHER_USER, 'hh-2'))).toBeDefined();
  });

  it('finishes a leave recorded by an older build under the legacy key', async () => {
    mockStore.set(
      legacyKey(USER),
      JSON.stringify({ householdId: 'hh-1', userId: USER, requestedAt: NOW }),
    );
    tombstoneMember(raw, 'hm-a');

    await expect(resumePendingHouseholdPurge({ db, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'purged' },
    ]);

    expect(householdExists(raw, 'hh-1')).toBe(false);
    expect(mockStore.get(legacyKey(USER))).toBeUndefined();
    expect(mockStore.get(KEY_1)).toBeUndefined();
  });

  it('keeps the marker when the purge itself fails', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');

    await expect(
      resumePendingHouseholdPurge({
        db,
        userId: USER,
        purge: () =>
          Promise.resolve({
            success: false as const,
            error: { code: 'PURGE_FAILED', message: 'database is locked' },
          }),
      }),
    ).resolves.toEqual([{ householdId: 'hh-1', action: 'purge-failed' }]);

    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
    expect(mockStore.get(KEY_1)).toBeDefined();
  });

  it('never rejects into boot when something throws internally', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    const exploding = {
      get: () => {
        throw new Error('database disk image is malformed');
      },
    } as unknown as PortableDb;

    await expect(resumePendingHouseholdPurge({ db: exploding, userId: USER })).resolves.toEqual([
      { householdId: 'hh-1', action: 'failed' },
    ]);
    // Nothing was destroyed and the marker survives for the next boot.
    expect(mockStore.get(KEY_1)).toBeDefined();
  });

  it('reports a marker stuck on un-pushed ops for 30 days — once — instead of purging', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');
    insertOp(raw, 'hh-1', 'op-stuck', { pushedAt: null });
    const nowMs = Date.parse(NOW) + PENDING_PURGE_STALE_MS + 1;

    await resumePendingHouseholdPurge({ db, userId: USER, nowMs });
    await resumePendingHouseholdPurge({ db, userId: USER, nowMs });

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(countRows(raw, 'transactions', 'hh-1')).toBe(1);
  });

  it('does not report a marker that is merely waiting', async () => {
    await ensurePendingHouseholdPurge(USER, 'hh-1', NOW);
    tombstoneMember(raw, 'hm-a');
    insertOp(raw, 'hh-1', 'op-stuck', { pushedAt: null });

    await resumePendingHouseholdPurge({ db, userId: USER, nowMs: Date.parse(NOW) + 1000 });

    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

/**
 * RestoreService — snapshot restore of a household from Supabase into local
 * SQLite.
 *
 * The doubles live in tests/support/fakeRestoreDb.ts because restore now
 * spans three collaborations that a one-method-deep object literal cannot
 * model: the server oplog cursor read, `.range()` paging, and the single
 * local transaction the snapshot + cursor commit in together.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { RestoreService } from './RestoreService';
import {
  makeFakeSupabase,
  makeFakeLocalDb,
  type FakeSupabaseConfig,
  type FakeLocalDbConfig,
} from '../../../tests/support/fakeRestoreDb';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../local/schema';
import type { SupabaseClient } from '@supabase/supabase-js';

const HH = 'hh-1';
const USER = 'user-1';

const HH_ROW = {
  id: HH,
  name: 'Test Household',
  payday_day: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** A seeder that records the steps it backfills instead of writing SQL. */
function fakeSeedRepo(): {
  insert: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  increment: jest.Mock;
} {
  return {
    insert: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    increment: jest.fn(),
  };
}

function build(
  supabaseConfig: FakeSupabaseConfig,
  dbConfig: FakeLocalDbConfig = {},
): {
  service: RestoreService;
  local: ReturnType<typeof makeFakeLocalDb>;
  remote: ReturnType<typeof makeFakeSupabase>;
} {
  const remote = makeFakeSupabase(supabaseConfig);
  const local = makeFakeLocalDb(dbConfig);
  const service = new RestoreService(
    local.db as ExpoSQLiteDatabase<typeof schema>,
    remote.supabase as SupabaseClient,
    { repo: fakeSeedRepo() as never },
  );
  return { service, local, remote };
}

function babyStepRow(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `bs-${n}`,
    household_id: HH,
    step_number: n,
    is_completed: false,
    completed_at: null,
    is_manual: false,
    celebrated_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('RestoreService.restore', () => {
  it('returns empty array when user has no household memberships in Supabase', async () => {
    const { service } = build({ memberships: [] });
    expect(await service.restore(USER)).toEqual([]);
  });

  it('throws when the Supabase membership fetch fails', async () => {
    const { service } = build({ errors: { household_members: 'network' } });
    await expect(service.restore(USER)).rejects.toThrow('network');
  });

  it('restores each membership and returns one summary per household', async () => {
    const { service } = build({
      memberships: [
        { household_id: HH, role: 'owner' },
        { household_id: 'hh-2', role: 'member' },
      ],
      households: {
        [HH]: { ...HH_ROW, name: 'Home', payday_day: 25 },
        'hh-2': { ...HH_ROW, id: 'hh-2', name: 'Business', payday_day: 1 },
      },
      maxSeq: 0,
    });

    expect(await service.restore(USER)).toEqual([
      { id: HH, name: 'Home', paydayDay: 25, role: 'owner' },
      { id: 'hh-2', name: 'Business', paydayDay: 1, role: 'member' },
    ]);
  });

  it('ignores a membership the user has left or been removed from', async () => {
    // Membership removal is a SOFT delete. Today RLS hides the retired row
    // from this query, so the filter is belt-and-braces -- but without it a
    // restore would resurrect a household `SyncEngine.evictHousehold` had
    // just torn off this device the moment that policy is relaxed.
    const { service, remote } = build({
      memberships: [
        { household_id: HH, role: 'owner', deleted_at: null },
        { household_id: 'hh-left', role: 'member', deleted_at: '2026-02-01T00:00:00Z' },
      ],
      households: {
        [HH]: HH_ROW,
        'hh-left': { ...HH_ROW, id: 'hh-left', name: 'Left' },
      },
      maxSeq: 0,
    });

    expect(await service.restore(USER)).toEqual([
      { id: HH, name: 'Test Household', paydayDay: 1, role: 'owner' },
    ]);
    expect(remote.recorder.isFilters).toContainEqual({
      table: 'household_members',
      column: 'deleted_at',
      value: null,
    });
  });

  it('skips a household the server does not return a row for', async () => {
    const { service } = build({
      memberships: [{ household_id: 'hh-missing', role: 'owner' }],
      households: {},
    });
    expect(await service.restore(USER)).toEqual([]);
  });
});

describe('RestoreService.restoreHousehold — sync cursor (SYNC-2)', () => {
  it('writes the server max oplog seq as the household cursor, inside the snapshot transaction', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      tables: { baby_steps: [babyStepRow(1)] },
      maxSeq: 412,
    });

    await service.restoreHousehold(HH, 'owner', USER);

    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 412 }]);
    expect(local.cursorWrittenInTransaction).toBe(true);
    expect(local.transactions).toBe(1);
  });

  it('writes cursor 0 for a household whose server oplog is empty', async () => {
    const { service, local } = build({ households: { [HH]: HH_ROW }, maxSeq: null });
    await service.restoreHousehold(HH, 'owner', USER);
    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 0 }]);
  });

  it('reads the cursor BEFORE fetching any entity table', async () => {
    const { service, remote } = build({ households: { [HH]: HH_ROW }, maxSeq: 9 });
    await service.restoreHousehold(HH, 'owner', USER);

    const tables = remote.recorder.queries.map((q) => q.table);
    expect(tables.indexOf('oplog')).toBeGreaterThanOrEqual(0);
    expect(tables.indexOf('oplog')).toBeLessThan(tables.indexOf('envelopes'));
  });

  it('does not restore (or re-write a cursor) when the household already has one', async () => {
    const { service, local, remote } = build(
      { households: { [HH]: HH_ROW }, tables: { baby_steps: [babyStepRow(1)] }, maxSeq: 5 },
      { householdsWithCursor: [HH] },
    );

    const summary = await service.restoreHousehold(HH, 'owner', USER);

    expect(summary).toEqual({ id: HH, name: 'Test Household', paydayDay: 1, role: 'owner' });
    expect(local.cursorWrites).toEqual([]);
    expect(local.transactions).toBe(0);
    expect(remote.recorder.queries.map((q) => q.table)).not.toContain('envelopes');
  });

  it('writes no cursor at all when a table fetch fails', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      maxSeq: 7,
      errors: { transactions: 'timeout' },
    });

    await expect(service.restoreHousehold(HH, 'owner', USER)).rejects.toThrow('timeout');
    expect(local.cursorWrites).toEqual([]);
    expect(local.transactions).toBe(0);
  });

  it('throws (never silently skips) when the cursor read itself fails', async () => {
    const { service } = build({ households: { [HH]: HH_ROW }, errors: { oplog: 'rls denied' } });
    await expect(service.restoreHousehold(HH, 'owner', USER)).rejects.toThrow('rls denied');
  });
});

describe('RestoreService.restoreHousehold — paging + error propagation (SYNC-9)', () => {
  it('pages every entity table with .range() until a short page', async () => {
    const { service, remote } = build({ households: { [HH]: HH_ROW }, maxSeq: 0 });
    await service.restoreHousehold(HH, 'owner', USER);

    const envelopeRanges = remote.recorder.ranges.filter((r) => r.table === 'envelopes');
    expect(envelopeRanges).toEqual([{ table: 'envelopes', from: 0, to: 999 }]);
  });

  it('fetches a second page when the first comes back full', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      id: `tx-${i}`,
      household_id: HH,
      created_at: '2026-01-01T00:00:00Z',
    }));
    const { service, remote, local } = build({
      households: { [HH]: HH_ROW },
      tables: { transactions: rows },
      maxSeq: 0,
    });

    await service.restoreHousehold(HH, 'owner', USER);

    expect(remote.recorder.ranges.filter((r) => r.table === 'transactions')).toEqual([
      { table: 'transactions', from: 0, to: 999 },
      { table: 'transactions', from: 1000, to: 1999 },
    ]);
    expect(local.written.filter((w) => w.table === 'transactions')).toHaveLength(1001);
  });

  it('throws instead of silently skipping a table whose fetch errors', async () => {
    const { service } = build({
      households: { [HH]: HH_ROW },
      maxSeq: 0,
      errors: { envelopes: 'connection reset' },
    });
    await expect(service.restoreHousehold(HH, 'owner', USER)).rejects.toThrow('connection reset');
  });

  it('throws when the households fetch errors', async () => {
    const { service } = build({ errors: { households: 'boom' } });
    await expect(service.restoreHousehold(HH, 'owner', USER)).rejects.toThrow('boom');
  });

  it('never fetches audit_events — the server table was dropped in migration 0001', async () => {
    const { service, remote } = build({ households: { [HH]: HH_ROW }, maxSeq: 0 });
    await service.restoreHousehold(HH, 'owner', USER);
    expect(remote.recorder.queries.map((q) => q.table)).not.toContain('audit_events');
  });

  it('restores envelope_contributions, after envelopes', async () => {
    const { service, remote } = build({ households: { [HH]: HH_ROW }, maxSeq: 0 });
    await service.restoreHousehold(HH, 'owner', USER);

    const tables = remote.recorder.queries.map((q) => q.table);
    expect(tables).toContain('envelope_contributions');
    expect(tables.indexOf('envelopes')).toBeLessThan(tables.indexOf('envelope_contributions'));
  });

  it('treats a missing envelope_contributions table as empty instead of failing the restore', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      maxSeq: 4,
      errors: {
        envelope_contributions: "Could not find the table 'public.envelope_contributions'",
      },
    });

    // An older server that has not run its migration yet must degrade to one
    // empty table, not block the whole restore.
    await expect(service.restoreHousehold(HH, 'owner', USER)).resolves.not.toBeNull();
    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 4 }]);
    expect(local.written.map((w) => w.table)).not.toContain('envelope_contributions');
  });

  it('still throws for a non-missing-table error on envelope_contributions', async () => {
    const { service } = build({
      households: { [HH]: HH_ROW },
      maxSeq: 0,
      errors: { envelope_contributions: 'permission denied for table' },
    });
    await expect(service.restoreHousehold(HH, 'owner', USER)).rejects.toThrow('permission denied');
  });

  it('restores slip_queue and user_consent (the latter keyed by user_id)', async () => {
    const { service, remote } = build({ households: { [HH]: HH_ROW }, maxSeq: 0 });
    await service.restoreHousehold(HH, 'owner', USER);

    const tables = remote.recorder.queries.map((q) => q.table);
    expect(tables).toContain('slip_queue');
    expect(remote.recorder.queries.find((q) => q.table === 'user_consent')?.column).toBe('user_id');
  });
});

describe('RestoreService.restoreHousehold — stable paging order (SYNC-9 residual)', () => {
  // Paging with `.range()` alone assumes the server returns rows in the SAME
  // order on every request. Postgres makes no such promise without an
  // ORDER BY, so a table that changes shape between two page reads (a
  // concurrent write, a different query plan) can shift a row across the
  // page boundary — skipping it forever, or handing it back twice. Ordering
  // by a unique column (the row's own id) closes that.
  it('orders every paged entity table fetch by a unique column before ranging over it', async () => {
    const { service, remote } = build({ households: { [HH]: HH_ROW }, maxSeq: 0 });
    await service.restoreHousehold(HH, 'owner', USER);

    const pagedTables = [
      'envelopes',
      'envelope_contributions',
      'transactions',
      'debts',
      'meter_readings',
      'baby_steps',
      'slip_queue',
      'household_members',
    ];
    for (const table of pagedTables) {
      const order = remote.recorder.orders.find((o) => o.table === table);
      expect(order).toEqual({ table, column: 'id', ascending: true });
    }
    // user_consent has no `id` column at all — its primary key is `user_id`.
    expect(remote.recorder.orders.find((o) => o.table === 'user_consent')).toEqual({
      table: 'user_consent',
      column: 'user_id',
      ascending: true,
    });
  });

  it('restores 2,500 transactions across a hard 1000-row-per-page server, each row exactly once, in any input order', async () => {
    // Deliberately NOT inserted in id order — a fetch that trusted `.range()`
    // alone (no ORDER BY) would depend on incidental array order lining up
    // with page boundaries; ordering by id makes the outcome independent of
    // how the rows are handed to the fake.
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      id: `tx-${String(i).padStart(4, '0')}`,
      household_id: HH,
      created_at: '2026-01-01T00:00:00Z',
    })).reverse();
    const { service, remote, local } = build({
      households: { [HH]: HH_ROW },
      tables: { transactions: rows },
      maxSeq: 0,
    });

    await service.restoreHousehold(HH, 'owner', USER);

    expect(remote.recorder.ranges.filter((r) => r.table === 'transactions')).toEqual([
      { table: 'transactions', from: 0, to: 999 },
      { table: 'transactions', from: 1000, to: 1999 },
      { table: 'transactions', from: 2000, to: 2999 },
    ]);
    const restoredIds = local.written
      .filter((w) => w.table === 'transactions')
      .map((w) => w.row.id as string);
    expect(restoredIds).toHaveLength(2500);
    expect(new Set(restoredIds).size).toBe(2500); // no row arrived twice
    for (const row of rows) {
      expect(restoredIds).toContain(row.id); // no row went missing
    }
  });

  it('a failure on page 2 of a large table leaves NO household marked complete — no cursor, no partial rows', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      id: `tx-${String(i).padStart(4, '0')}`,
      household_id: HH,
      created_at: '2026-01-01T00:00:00Z',
    }));
    const { service, remote, local } = build({
      households: { [HH]: HH_ROW },
      tables: { transactions: rows },
      maxSeq: 0,
      failOnPage: { transactions: { page: 2, message: 'connection reset on page 2' } },
    });

    await expect(service.restoreHousehold(HH, 'owner', USER)).rejects.toThrow(
      'connection reset on page 2',
    );

    // Page 1 (1000 rows) WAS fetched from the server before the failure, but
    // nothing may land locally: the whole snapshot fetch happens before the
    // local transaction opens, so a mid-fetch failure must leave zero writes
    // and zero cursor rows — never a household that looks restored.
    expect(remote.recorder.ranges.filter((r) => r.table === 'transactions')).toHaveLength(2);
    expect(local.written).toEqual([]);
    expect(local.cursorWrites).toEqual([]);
    expect(local.transactions).toBe(0);
  });

  it('is safe to re-run after a failed restore — the retry starts clean and completes', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `tx-${String(i).padStart(4, '0')}`,
      household_id: HH,
      created_at: '2026-01-01T00:00:00Z',
    }));

    const failingConfig: FakeSupabaseConfig = {
      households: { [HH]: HH_ROW },
      tables: { transactions: rows },
      maxSeq: 3,
      failOnPage: { transactions: { page: 2, message: 'timeout' } },
    };
    const failingRemote = makeFakeSupabase(failingConfig);
    const failingLocal = makeFakeLocalDb();
    const failingService = new RestoreService(
      failingLocal.db as ExpoSQLiteDatabase<typeof schema>,
      failingRemote.supabase as SupabaseClient,
      { repo: fakeSeedRepo() as never },
    );
    await expect(failingService.restoreHousehold(HH, 'owner', USER)).rejects.toThrow('timeout');
    expect(failingLocal.cursorWrites).toEqual([]);

    // Re-run against a healthy server (still no sync_cursor row locally, as
    // the failed attempt wrote none) must complete normally, from scratch.
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      tables: { transactions: rows },
      maxSeq: 3,
    });
    await service.restoreHousehold(HH, 'owner', USER);
    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 3 }]);
    expect(local.written.filter((w) => w.table === 'transactions')).toHaveLength(1500);
  });
});

describe('RestoreService.restoreHousehold — unpushed local writes (SYNC-9)', () => {
  it('skips a snapshot row that still has an unpushed local op', async () => {
    const { service, local } = build(
      {
        households: { [HH]: HH_ROW },
        tables: { baby_steps: [babyStepRow(1), babyStepRow(2)] },
        maxSeq: 3,
      },
      { unpushedRowIds: ['bs-2'] },
    );

    await service.restoreHousehold(HH, 'owner', USER);

    const restoredIds = local.written
      .filter((w) => w.table === 'baby_steps')
      .map((w) => w.row.id as string);
    expect(restoredIds).toEqual(['bs-1']);
  });

  it('restores a row whose only local op has already been pushed', async () => {
    const { service, local } = build(
      { households: { [HH]: HH_ROW }, tables: { baby_steps: [babyStepRow(1)] }, maxSeq: 3 },
      { unpushedRowIds: [] },
    );

    await service.restoreHousehold(HH, 'owner', USER);
    expect(local.written.filter((w) => w.table === 'baby_steps')).toHaveLength(1);
  });
});

describe('RestoreService.restoreHousehold — row shapes', () => {
  it('restores baby_steps rows converted to camelCase local columns', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      tables: { baby_steps: [babyStepRow(1, { celebrated_at: '2026-02-02T00:00:00Z' })] },
      maxSeq: 0,
    });

    await service.restoreHousehold(HH, 'owner', USER);

    const row = local.written.find((w) => w.table === 'baby_steps')?.row;
    expect(row).toMatchObject({ stepNumber: 1, celebratedAt: '2026-02-02T00:00:00Z' });
  });

  it('inserts household_members with onConflictDoNothing and no isSynced marker', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      tables: {
        household_members: [
          { id: 'mem-1', household_id: HH, user_id: USER, role: 'owner', created_at: 'x' },
        ],
      },
      maxSeq: 0,
    });

    await service.restoreHousehold(HH, 'owner', USER);

    const member = local.written.find((w) => w.table === 'household_members');
    expect(member?.conflict).toBe('nothing');
    expect(member?.row).not.toHaveProperty('isSynced');
  });

  it('upserts the household row itself', async () => {
    const { service, local } = build({ households: { [HH]: HH_ROW }, maxSeq: 0 });
    await service.restoreHousehold(HH, 'owner', USER);

    const hh = local.written.find((w) => w.table === 'households');
    expect(hh?.conflict).toBe('update');
    expect(hh?.row).toMatchObject({ id: HH, paydayDay: 1 });
  });

  it('upserts user_consent rows', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      tables: {
        user_consent: [
          {
            user_id: USER,
            slip_scan_consent_at: '2026-01-15T00:00:00Z',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-15T00:00:00Z',
          },
        ],
      },
      maxSeq: 0,
    });

    await service.restoreHousehold(HH, 'owner', USER);

    const consent = local.written.find((w) => w.table === 'user_consent');
    expect(consent?.row).toMatchObject({ userId: USER });
  });
});

describe('RestoreService.restoreHousehold — cursor stabilisation (SYNC-2 residual)', () => {
  it('adopts the newer seq when the oplog moved during the fetch and then settled', async () => {
    const { service, local, remote } = build({
      households: { [HH]: HH_ROW },
      // pre-fetch read = 5, post-fetch read = 9 (moved), confirming read = 9.
      maxSeqSequence: [5, 9, 9],
    });

    await service.restoreHousehold(HH, 'owner', USER);

    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 9 }]);
    expect(remote.recorder.maxSeqReads).toBe(3);
    // SEC2-3: the WHOLE snapshot is re-fetched, not just the increment-carrying
    // table — adopting the newer seq over a partially-refreshed snapshot skips
    // every op in between that touched one of the stale tables.
    expect(remote.recorder.ranges.filter((r) => r.table === 'debts')).toHaveLength(2);
    expect(remote.recorder.ranges.filter((r) => r.table === 'transactions')).toHaveLength(2);
    expect(remote.recorder.ranges.filter((r) => r.table === 'envelopes')).toHaveLength(2);
  });

  it('restores a transaction that landed after the first transactions fetch (SEC2-3)', async () => {
    // The op the old "re-fetch debts only" rule lost forever: it committed
    // after the transactions page was taken but before the second seq read,
    // so it was in neither the snapshot nor the (cursor, ...] pull range.
    const late = {
      id: 'tx-late',
      household_id: HH,
      envelope_id: 'env-1',
      amount_cents: 12_345,
      transaction_date: '2026-03-02',
      created_at: '2026-03-02T00:00:00Z',
    };
    const config: FakeSupabaseConfig = {
      households: { [HH]: HH_ROW },
      tables: { transactions: [] },
      maxSeqSequence: [5, 9, 9],
      onTableFetch: (table): void => {
        if (table !== 'transactions') return;
        // Commits once, right after the first transactions page is taken.
        config.tables = { transactions: [late] };
      },
    };
    const { service, local } = build(config);

    await service.restoreHousehold(HH, 'owner', USER);

    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 9 }]);
    const restored = local.written.filter((w) => w.table === 'transactions');
    expect(restored).toHaveLength(1);
    expect(restored[0].row).toMatchObject({ id: 'tx-late', amountCents: 12_345 });
  });

  it('uses the pre-fetch seq unchanged when nothing moved', async () => {
    const { service, local, remote } = build({
      households: { [HH]: HH_ROW },
      maxSeqSequence: [5, 5],
    });

    await service.restoreHousehold(HH, 'owner', USER);

    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 5 }]);
    expect(remote.recorder.maxSeqReads).toBe(2);
    expect(remote.recorder.ranges.filter((r) => r.table === 'debts')).toHaveLength(1);
  });

  it('falls back to the pre-fetch seq when the oplog never settles', async () => {
    const { service, local, remote } = build({
      households: { [HH]: HH_ROW },
      // Moves on every read — a household busy throughout the restore.
      maxSeqSequence: [5, 6, 7, 8, 9],
    });

    await service.restoreHousehold(HH, 'owner', USER);

    // Conservative: never miss an op, even at the cost of the residual
    // double-apply window this stabilisation exists to shrink.
    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 5 }]);
    // Bounded — 1 pre-fetch read + at most 3 attempts.
    expect(remote.recorder.maxSeqReads).toBe(4);
  });

  it('re-fetched debts rows are the ones actually restored', async () => {
    const { service, local } = build({
      households: { [HH]: HH_ROW },
      tables: {
        debts: [
          {
            id: 'd1',
            household_id: HH,
            creditor_name: 'Visa',
            outstanding_balance_cents: 50_000,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
      maxSeqSequence: [5, 9, 9],
    });

    await service.restoreHousehold(HH, 'owner', USER);

    const restored = local.written.filter((w) => w.table === 'debts');
    expect(restored).toHaveLength(1);
    expect(restored[0].row).toMatchObject({ outstandingBalanceCents: 50_000 });
  });
});

/**
 * RestoreService — restore-vs-local-edits ordering (was known gap RESTORE-001/2/3).
 *
 * These tests used to DOCUMENT the bug: restore ran on every app open and
 * upserted every remote column over the local row, so an edit made offline
 * was replaced by stale server data and then pushed back to the server as if
 * it were the user's change. They now PIN the fix, which has three parts:
 *
 *   1. restore only runs while the household has no `sync_cursor` row — after
 *      the first bootstrap the oplog puller owns local state, so there is no
 *      recurring app-open overwrite to lose an edit to at all;
 *   2. a row with an unpushed, non-dead-lettered local op is skipped, so even
 *      during that one bootstrap a queued local edit is never clobbered
 *      (and its op stays queued, so it still reaches the server);
 *   3. the snapshot and the pull cursor commit in ONE local transaction, so a
 *      restore can never leave a cursor pointing at data that did not land.
 *
 * `pending_sync` is gone (migration 0014) — the oplog outbox replaces it, and
 * "has an unpushed op" is now read straight from that outbox.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { RestoreService } from '../../data/sync/RestoreService';
import { KRUGER_ENVELOPES, HOUSEHOLDS, USERS } from '../../__test-utils__/scenarioSeed';
import {
  makeFakeSupabase,
  makeFakeLocalDb,
  type FakeSupabaseConfig,
  type FakeLocalDbConfig,
} from '../../../tests/support/fakeRestoreDb';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncedRepo } from '../../data/uow/createSyncedRepo';

const HH = HOUSEHOLDS.kruger.id;
const USER = USERS.henzard.id;
const DIRTY_ENVELOPE_ID = KRUGER_ENVELOPES[0].id;

const HH_ROW = {
  id: HH,
  name: 'Kruger',
  payday_day: 20,
  created_at: '2026-01-15T00:00:00.000Z',
  updated_at: '2026-01-15T00:00:00.000Z',
};

/** The server's copy of the envelope — stale, because the user's edit has not
 * been pushed yet. */
const REMOTE_STALE_ENVELOPE = {
  id: DIRTY_ENVELOPE_ID,
  household_id: HH,
  name: 'Groceries',
  allocated_cents: 800000,
  envelope_type: 'spending',
  is_savings_locked: false,
  is_archived: false,
  deleted_at: null,
  period_start: '2026-01-01',
  created_at: '2026-01-15T00:00:00.000Z',
  updated_at: '2026-01-15T00:00:00.000Z',
};

const noopSeedRepo: SyncedRepo = {
  insert: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  increment: jest.fn(),
};

function build(
  supabaseConfig: FakeSupabaseConfig = {},
  dbConfig: FakeLocalDbConfig = {},
): {
  service: RestoreService;
  local: ReturnType<typeof makeFakeLocalDb>;
  remote: ReturnType<typeof makeFakeSupabase>;
} {
  const remote = makeFakeSupabase({
    memberships: [{ household_id: HH, role: 'owner' }],
    households: { [HH]: HH_ROW },
    maxSeq: 0,
    ...supabaseConfig,
  });
  const local = makeFakeLocalDb(dbConfig);
  const service = new RestoreService(
    local.db as ExpoSQLiteDatabase<typeof schema>,
    remote.supabase as SupabaseClient,
    { repo: noopSeedRepo },
  );
  return { service, local, remote };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('RestoreService — restore-before-push ordering', () => {
  it('does NOT overwrite a local row that still has an unpushed op (RESTORE-001)', async () => {
    const { service, local } = build(
      { tables: { envelopes: [REMOTE_STALE_ENVELOPE] } },
      { unpushedRowIds: [DIRTY_ENVELOPE_ID] },
    );

    const result = await service.restore(USER);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Kruger');
    // The stale server copy was fetched but deliberately not written: the
    // user's offline edit stays exactly as they left it.
    expect(local.written.filter((w) => w.table === 'envelopes')).toEqual([]);
  });

  it('leaves the queued op alone, so the offline edit still reaches the server (RESTORE-002)', async () => {
    const { service, local } = build(
      { tables: { envelopes: [REMOTE_STALE_ENVELOPE] } },
      { unpushedRowIds: [DIRTY_ENVELOPE_ID] },
    );

    await service.restore(USER);

    // Restore touches the outbox in no way at all — it neither clears the
    // pending op (which would lose the edit) nor rewrites the row underneath
    // it (which would push stale server data back as if it were the edit).
    // The only rows it writes are the household and the tables it restored.
    expect(local.written.map((w) => w.table)).toEqual(['households']);
  });

  it('DOES restore a row whose ops have all been pushed', async () => {
    const { service, local } = build(
      { tables: { envelopes: [REMOTE_STALE_ENVELOPE] } },
      { unpushedRowIds: [] },
    );

    await service.restore(USER);

    const written = local.written.filter((w) => w.table === 'envelopes');
    expect(written).toHaveLength(1);
    expect(written[0].row).toMatchObject({ id: DIRTY_ENVELOPE_ID, name: 'Groceries' });
    // Remote is authoritative for a clean row, so the upsert still carries
    // the full non-id column set.
    expect(written[0].conflict).toBe('update');
  });

  it('skips only the dirty row, not the whole table', async () => {
    const cleanEnvelope = { ...REMOTE_STALE_ENVELOPE, id: 'env-clean', name: 'Fuel' };
    const { service, local } = build(
      { tables: { envelopes: [REMOTE_STALE_ENVELOPE, cleanEnvelope] } },
      { unpushedRowIds: [DIRTY_ENVELOPE_ID] },
    );

    await service.restore(USER);

    expect(local.written.filter((w) => w.table === 'envelopes').map((w) => w.row.id)).toEqual([
      'env-clean',
    ]);
  });

  it('does not run at all once the household has a sync cursor (RESTORE-003)', async () => {
    const { service, local, remote } = build(
      { tables: { envelopes: [REMOTE_STALE_ENVELOPE] } },
      { householdsWithCursor: [HH] },
    );

    const result = await service.restore(USER);

    // The household is still discovered and returned (that is why restore is
    // called on every sign-in), but no snapshot is applied: after the first
    // bootstrap the oplog puller owns local state, so there is no recurring
    // app-open overwrite for an offline edit to be lost to.
    expect(result).toHaveLength(1);
    expect(local.transactions).toBe(0);
    expect(local.written).toEqual([]);
    expect(remote.recorder.queries.map((q) => q.table)).not.toContain('envelopes');
  });

  it('commits the snapshot and the pull cursor in ONE transaction', async () => {
    const { service, local } = build({
      tables: { envelopes: [REMOTE_STALE_ENVELOPE] },
      maxSeq: 42,
    });

    await service.restore(USER);

    expect(local.transactions).toBe(1);
    expect(local.cursorWrittenInTransaction).toBe(true);
    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 42 }]);
  });

  it('writes nothing — cursor included — when the snapshot fetch fails', async () => {
    const { service, local } = build({
      tables: { envelopes: [REMOTE_STALE_ENVELOPE] },
      maxSeq: 42,
      errors: { envelopes: 'permission denied' },
    });

    await expect(service.restore(USER)).rejects.toThrow('permission denied');
    expect(local.written).toEqual([]);
    expect(local.cursorWrites).toEqual([]);
  });
});

/**
 * sync-error-branches.test.ts — RestoreService error path tests.
 *
 * These used to assert that a failing table fetch was SKIPPED and the restore
 * reported success anyway. That is the SYNC-9 bug: a swallowed error let the
 * restore go on to write a sync cursor for data it never actually restored,
 * so the puller then started past every op that would have rebuilt it. The
 * expectations below are inverted accordingly — a failed fetch now aborts the
 * restore, and the caller (App.tsx's `initSessionRemote`) catches it.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { RestoreService } from '../RestoreService';
import { makeFakeSupabase, makeFakeLocalDb } from '../../../../tests/support/fakeRestoreDb';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../local/schema';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncedRepo } from '../../uow/createSyncedRepo';

const HH = 'hh1';
const HH_ROW = {
  id: HH,
  name: 'Test',
  payday_day: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const noopRepo: SyncedRepo = {
  insert: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  increment: jest.fn(),
};

function build(errors: Record<string, string> = {}): {
  svc: RestoreService;
  local: ReturnType<typeof makeFakeLocalDb>;
} {
  const { supabase } = makeFakeSupabase({ households: { [HH]: HH_ROW }, maxSeq: 0, errors });
  const local = makeFakeLocalDb();
  const svc = new RestoreService(
    local.db as ExpoSQLiteDatabase<typeof schema>,
    supabase as SupabaseClient,
    { repo: noopRepo },
  );
  return { svc, local };
}

describe('RestoreService error branches', () => {
  it('an entity-table fetch error aborts the restore instead of skipping the table', async () => {
    const { svc, local } = build({ envelopes: 'permission denied' });

    await expect(svc.restoreHousehold(HH, 'owner', 'u1')).rejects.toThrow('permission denied');
    // Nothing was written — in particular no cursor for data that never landed.
    expect(local.written).toEqual([]);
    expect(local.cursorWrites).toEqual([]);
  });

  it('a user_consent fetch error aborts the restore too', async () => {
    const { svc, local } = build({ user_consent: 'rls error' });

    await expect(svc.restoreHousehold(HH, 'owner', 'u1')).rejects.toThrow('rls error');
    expect(local.cursorWrites).toEqual([]);
  });

  it('empty entity tables write nothing but still commit the cursor', async () => {
    const { svc, local } = build();

    await expect(svc.restoreHousehold(HH, 'owner', 'u1')).resolves.not.toBeNull();

    // Only the household row itself — every entity table came back empty.
    expect(local.written.map((w) => w.table)).toEqual(['households']);
    expect(local.cursorWrites).toEqual([{ householdId: HH, seq: 0 }]);
  });

  it('a household the server has no row for returns null without writing anything', async () => {
    const { supabase } = makeFakeSupabase({ households: {} });
    const local = makeFakeLocalDb();
    const svc = new RestoreService(
      local.db as ExpoSQLiteDatabase<typeof schema>,
      supabase as SupabaseClient,
      { repo: noopRepo },
    );

    expect(await svc.restoreHousehold('hh-missing', 'owner', 'u1')).toBeNull();
    expect(local.written).toEqual([]);
    expect(local.cursorWrites).toEqual([]);
  });

  it('a households fetch ERROR throws rather than being read as "no such household"', async () => {
    const { svc } = build({ households: 'connection reset' });
    await expect(svc.restoreHousehold(HH, 'owner', 'u1')).rejects.toThrow('connection reset');
  });
});

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid' }));

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from '../../../tests/realsql/harness/openMigratedDb';
import type * as schema from '../../data/local/schema';
import { EnsureHouseholdUseCase } from './EnsureHouseholdUseCase';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHouseholdAndMembership(
  raw: Database.Database,
  opts: { householdId: string; userId: string; deletedAt: string | null },
): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Kruger Home', 25, ?, ?)`,
    )
    .run(opts.householdId, NOW, NOW);
  raw
    .prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, joined_at, updated_at, deleted_at)
       VALUES ('hm-1', ?, ?, 'owner', ?, ?, ?)`,
    )
    .run(opts.householdId, opts.userId, NOW, NOW, opts.deletedAt);
}

function asDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

describe('EnsureHouseholdUseCase', () => {
  it('returns existing household when a membership row exists', async () => {
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ householdId: 'hh-1', role: 'owner' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { id: 'hh-1', name: 'My Household', paydayDay: 25, userLevel: 1 },
                ]),
            }),
          }),
        }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          then: jest.fn(), // make it thenable for await
        }),
      }),
    };
    const uc = new EnsureHouseholdUseCase(db as any, 'user-1');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('hh-1');
  });

  it('returns failure when user has no household (new user — create/join choice deferred to UI)', async () => {
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        })
        .mockReturnValueOnce({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        }),
      insert: jest.fn(),
    };
    const uc = new EnsureHouseholdUseCase(db as any, 'new-user-id');
    const result = await uc.execute();
    expect(result.success).toBe(false);
    // Must NOT have inserted anything — household creation is now explicit via UI
    expect(db.insert).not.toHaveBeenCalled();
  });

  // Regression: membership rows are SOFT-deleted (leaving, an owner's removal
  // pulled as a `delete` op, SyncEngine.evictHousehold). Before the
  // `deleted_at IS NULL` filter, cold start matched the tombstoned row and
  // resurrected a household the user no longer belongs to — with no server
  // access behind it.
  it('ignores a SOFT-DELETED membership row (a household the user left or was removed from)', async () => {
    const raw = openMigratedDb();
    seedHouseholdAndMembership(raw, {
      householdId: 'hh-left',
      userId: 'user-1',
      deletedAt: '2026-02-01T00:00:00.000Z',
    });

    const result = await new EnsureHouseholdUseCase(asDb(raw), 'user-1').execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('no_household');
    raw.close();
  });

  it('still resolves a household from an ACTIVE membership row', async () => {
    const raw = openMigratedDb();
    seedHouseholdAndMembership(raw, {
      householdId: 'hh-active',
      userId: 'user-1',
      deletedAt: null,
    });

    const result = await new EnsureHouseholdUseCase(asDb(raw), 'user-1', {
      repo: { insert: jest.fn(), update: jest.fn(), softDelete: jest.fn(), increment: jest.fn() },
    }).execute();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('hh-active');
    raw.close();
  });
});

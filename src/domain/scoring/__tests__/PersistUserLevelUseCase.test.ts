/**
 * `PersistUserLevelUseCase` against a REAL migrated better-sqlite3 database.
 *
 * The contract is entirely about a row and an oplog op — that the synced
 * `households.user_level` column is actually written, that the op the server
 * will replay carries the same value, and that a level is never taken away —
 * so it runs against the real driver and the real `runInUnitOfWork`, which a
 * mocked unit of work could not exercise.
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: (): string => `random-uuid-${++counter}` };
});

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from '../../../../tests/realsql/harness/openMigratedDb';
import type * as schema from '../../../data/local/schema';
import { PersistUserLevelUseCase } from '../PersistUserLevelUseCase';

const HOUSEHOLD_ID = 'hh-level';
const NOW = '2026-09-21T00:00:00.000Z';
const DEPS = { deviceId: 'device-1', actorUserId: 'user-1', clock: () => NOW };

interface Ctx {
  raw: Database.Database;
  db: ExpoSQLiteDatabase<typeof schema>;
}

function open(userLevel = 1): Ctx {
  const raw = openMigratedDb();
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
       VALUES (?, 'Kruger', 20, ?, ?, ?)`,
    )
    .run(HOUSEHOLD_ID, userLevel, NOW, NOW);
  return { raw, db: drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema> };
}

function storedLevel(raw: Database.Database): number {
  return (
    raw.prepare(`SELECT user_level FROM households WHERE id = ?`).get(HOUSEHOLD_ID) as {
      user_level: number;
    }
  ).user_level;
}

function householdOps(raw: Database.Database): { payload: string }[] {
  return raw
    .prepare(`SELECT payload FROM oplog WHERE table_name = 'households' ORDER BY rowid`)
    .all() as { payload: string }[];
}

describe('PersistUserLevelUseCase (real migrated sqlite)', () => {
  let ctx: Ctx;

  afterEach(() => {
    ctx.raw.close();
  });

  it('writes the new level and one households oplog op when the level goes up', async () => {
    ctx = open(1);

    const result = await new PersistUserLevelUseCase(ctx.db, DEPS).execute({
      householdId: HOUSEHOLD_ID,
      level: 2,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ level: 2, changed: true });
    expect(storedLevel(ctx.raw)).toBe(2);

    const ops = householdOps(ctx.raw);
    expect(ops).toHaveLength(1);
    expect(JSON.parse(ops[0].payload)).toEqual({ user_level: 2, updated_at: NOW });
  });

  it('writes NOTHING when the stored level already matches — no row touched, no op', async () => {
    ctx = open(2);

    const result = await new PersistUserLevelUseCase(ctx.db, DEPS).execute({
      householdId: HOUSEHOLD_ID,
      level: 2,
    });

    expect(result.success && result.data).toEqual({ level: 2, changed: false });
    expect(householdOps(ctx.raw)).toHaveLength(0);
  });

  it('never demotes: a lower derived level leaves the earned level in place', async () => {
    ctx = open(3);

    const result = await new PersistUserLevelUseCase(ctx.db, DEPS).execute({
      householdId: HOUSEHOLD_ID,
      level: 1,
    });

    expect(result.success && result.data).toEqual({ level: 3, changed: false });
    expect(storedLevel(ctx.raw)).toBe(3);
    expect(householdOps(ctx.raw)).toHaveLength(0);
  });

  it('is idempotent across repeated calls — the second writes no second op', async () => {
    ctx = open(1);
    const useCase = new PersistUserLevelUseCase(ctx.db, DEPS);

    await useCase.execute({ householdId: HOUSEHOLD_ID, level: 2 });
    const second = await useCase.execute({ householdId: HOUSEHOLD_ID, level: 2 });

    expect(second.success && second.data.changed).toBe(false);
    expect(householdOps(ctx.raw)).toHaveLength(1);
  });

  it('rejects a level outside 1..3 rather than writing it to a synced column', async () => {
    ctx = open(1);

    const result = await new PersistUserLevelUseCase(ctx.db, DEPS).execute({
      householdId: HOUSEHOLD_ID,
      level: 4 as 1 | 2 | 3,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('INVALID_LEVEL');
    expect(storedLevel(ctx.raw)).toBe(1);
  });

  it('fails cleanly for a household that is not here', async () => {
    ctx = open(1);

    const result = await new PersistUserLevelUseCase(ctx.db, DEPS).execute({
      householdId: 'hh-missing',
      level: 2,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('HOUSEHOLD_NOT_FOUND');
  });
});

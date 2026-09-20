import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { UpdateHouseholdPaydayDayUseCase } from '../../src/domain/households/UpdateHouseholdPaydayDayUseCase';
import { StartNewPeriodUseCase } from '../../src/domain/budgets/StartNewPeriodUseCase';
import { getPersistentEnvelopeSavedCents } from '../../src/data/local/balances/EnvelopeBalanceQuery';
import type * as schema from '../../src/data/local/schema';

/**
 * UX-5/DOM-6: changing the payday moves the CURRENT period's key, so the
 * rows carrying the old key must move with it — otherwise the household's
 * whole budget silently disappears from a dashboard that queries the new key.
 */

// 10 Oct 2026. With payday 25 the current period started 25 Sep; with payday 5
// it started 5 Oct. So a 25 -> 5 change moves the current-period key.
const NOW = '2026-10-10T09:00:00.000Z';
const OLD_PERIOD = '2026-09-25';
const NEW_PERIOD = '2026-10-05';
const OLDER_PERIOD = '2026-08-25';
const HOUSEHOLD_ID = 'hh-payday';

function seedHousehold(db: Database.Database, paydayDay: number): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', ?, ?, ?)`,
  ).run(HOUSEHOLD_ID, paydayDay, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  name: string;
  envelopeType: string;
  periodStart: string;
  allocatedCents?: number;
}

function seedEnvelope(db: Database.Database, args: SeedEnvelopeArgs): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(
    args.id,
    HOUSEHOLD_ID,
    args.name,
    args.allocatedCents ?? 50_000,
    args.envelopeType,
    args.periodStart,
    NOW,
    NOW,
  );
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function run(
  db: ExpoSQLiteDatabase<typeof schema>,
  paydayDay: number,
): ReturnType<UpdateHouseholdPaydayDayUseCase['execute']> {
  return new UpdateHouseholdPaydayDayUseCase(db, HOUSEHOLD_ID, paydayDay, {
    deviceId: 'device-1',
    actorUserId: 'user-1',
    clock: () => NOW,
  }).execute();
}

function periodOf(raw: Database.Database, envelopeId: string): string {
  return (
    raw.prepare('SELECT period_start FROM envelopes WHERE id = ?').get(envelopeId) as {
      period_start: string;
    }
  ).period_start;
}

describe('UpdateHouseholdPaydayDayUseCase (real SQLite)', () => {
  it('re-keys the current period’s period-scoped envelopes onto the new payday’s key', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 25);
    seedEnvelope(raw, {
      id: 'env-income',
      name: 'Monthly Income',
      envelopeType: 'income',
      periodStart: OLD_PERIOD,
      allocatedCents: 3_000_000,
    });
    seedEnvelope(raw, {
      id: 'env-groceries',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
    });
    seedEnvelope(raw, {
      id: 'env-lights',
      name: 'Lights',
      envelopeType: 'utility',
      periodStart: OLD_PERIOD,
    });
    // A PERSISTENT fund — period_start is meaningless for it and must not move.
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: OLD_PERIOD,
    });
    // A PREVIOUS period's row — history, and must not move.
    seedEnvelope(raw, {
      id: 'env-old-groceries',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: OLDER_PERIOD,
    });

    const db = makeDb(raw);
    const result = await run(db, 5);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.fromPeriodStart).toBe(OLD_PERIOD);
    expect(result.data.toPeriodStart).toBe(NEW_PERIOD);
    expect(result.data.reKeyedEnvelopeCount).toBe(3);
    expect(result.data.collidedEnvelopeCount).toBe(0);

    expect(periodOf(raw, 'env-income')).toBe(NEW_PERIOD);
    expect(periodOf(raw, 'env-groceries')).toBe(NEW_PERIOD);
    expect(periodOf(raw, 'env-lights')).toBe(NEW_PERIOD);
    expect(periodOf(raw, 'env-emf')).toBe(OLD_PERIOD);
    expect(periodOf(raw, 'env-old-groceries')).toBe(OLDER_PERIOD);

    // The payday itself was written too.
    const household = raw
      .prepare('SELECT payday_day FROM households WHERE id = ?')
      .get(HOUSEHOLD_ID) as { payday_day: number };
    expect(household.payday_day).toBe(5);

    raw.close();
  });

  it('replicates the re-key: one oplog op per moved row, plus the households update', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 25);
    seedEnvelope(raw, {
      id: 'env-groceries',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
    });
    const db = makeDb(raw);

    await run(db, 5);

    const ops = raw
      .prepare('SELECT table_name, row_id, op_type FROM oplog ORDER BY rowid')
      .all() as { table_name: string; row_id: string; op_type: string }[];
    expect(ops).toEqual([
      { table_name: 'households', row_id: HOUSEHOLD_ID, op_type: 'update' },
      { table_name: 'envelopes', row_id: 'env-groceries', op_type: 'update' },
    ]);

    raw.close();
  });

  it('leaves an envelope on the old key when the new key already has one with the same name and type', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 25);
    seedEnvelope(raw, {
      id: 'env-groceries-old',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
      allocatedCents: 40_000,
    });
    // Already present under the target key — this IS the new period's
    // Groceries envelope, so the old one stays put as history rather than
    // being merged into it or deleted.
    seedEnvelope(raw, {
      id: 'env-groceries-new',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: NEW_PERIOD,
      allocatedCents: 55_000,
    });
    seedEnvelope(raw, {
      id: 'env-transport',
      name: 'Transport',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
    });

    const db = makeDb(raw);
    const result = await run(db, 5);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');

    expect(result.data.reKeyedEnvelopeCount).toBe(1); // Transport only
    expect(result.data.collidedEnvelopeCount).toBe(1); // Groceries

    expect(periodOf(raw, 'env-groceries-old')).toBe(OLD_PERIOD);
    expect(periodOf(raw, 'env-groceries-new')).toBe(NEW_PERIOD);
    expect(periodOf(raw, 'env-transport')).toBe(NEW_PERIOD);

    // Neither allocation was touched — no silent merge, no data loss.
    const allocations = raw
      .prepare('SELECT id, allocated_cents FROM envelopes ORDER BY id')
      .all() as { id: string; allocated_cents: number }[];
    expect(allocations).toEqual([
      { id: 'env-groceries-new', allocated_cents: 55_000 },
      { id: 'env-groceries-old', allocated_cents: 40_000 },
      { id: 'env-transport', allocated_cents: 50_000 },
    ]);

    raw.close();
  });

  it('writes nothing but the payday when the period key does not change', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 25);
    seedEnvelope(raw, {
      id: 'env-groceries',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
    });
    const db = makeDb(raw);

    // Re-confirming the SAME payday — the path onboarding's PaydayStep takes
    // when the user simply presses Next on the pre-filled value. The period
    // key is unchanged, so no envelope may be touched and no envelope op may
    // be enqueued.
    const result = await run(db, 25);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.fromPeriodStart).toBe(result.data.toPeriodStart);
    expect(result.data.reKeyedEnvelopeCount).toBe(0);

    expect(periodOf(raw, 'env-groceries')).toBe(OLD_PERIOD);
    const ops = raw.prepare('SELECT table_name FROM oplog').all() as { table_name: string }[];
    expect(ops).toEqual([{ table_name: 'households' }]);

    raw.close();
  });

  it('moves the current period’s contributions too, so a payday change cannot double-fund a saving envelope', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 25);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: OLD_PERIOD,
      allocatedCents: 50_000,
    });
    const db = makeDb(raw);

    // A rollover funds the EMF for the CURRENT period (old key).
    const funded = await new StartNewPeriodUseCase(db, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    }).execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: OLDER_PERIOD,
      toPeriodStart: OLD_PERIOD,
    });
    expect(funded.success).toBe(true);
    if (!funded.success) throw new Error('unreachable');
    expect(funded.data.contributionCount).toBe(1);

    // Payday changes; the contribution follows the period key.
    const result = await run(db, 5);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.reKeyedContributionCount).toBe(1);

    const contributionPeriods = raw
      .prepare('SELECT period_start FROM envelope_contributions')
      .all() as { period_start: string }[];
    expect(contributionPeriods).toEqual([{ period_start: NEW_PERIOD }]);

    // A rollover into the NEW key must now see the period as already funded —
    // the deterministic id differs (it hashes the period), so only the
    // value-based guard can catch this.
    const again = await new StartNewPeriodUseCase(db, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    }).execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: OLD_PERIOD,
      toPeriodStart: NEW_PERIOD,
    });
    expect(again.success).toBe(true);
    if (!again.success) throw new Error('unreachable');
    expect(again.data.contributionCount).toBe(0);

    const saved = await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID);
    expect(saved.get('env-emf')).toBe(50_000);

    raw.close();
  });

  it('rejects an out-of-range payday without writing anything', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 25);
    const db = makeDb(raw);

    const result = await run(db, 31);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.code).toBe('INVALID_PAYDAY');

    const household = raw
      .prepare('SELECT payday_day FROM households WHERE id = ?')
      .get(HOUSEHOLD_ID) as { payday_day: number };
    expect(household.payday_day).toBe(25);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oplog').get()).toEqual({ n: 0 });

    raw.close();
  });
});

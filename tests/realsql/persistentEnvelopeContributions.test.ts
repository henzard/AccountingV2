import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { StartNewPeriodUseCase } from '../../src/domain/budgets/StartNewPeriodUseCase';
import { ReconcileBabyStepsUseCase } from '../../src/domain/babySteps/ReconcileBabyStepsUseCase';
import { getPersistentEnvelopeSavedCents } from '../../src/data/local/balances/EnvelopeBalanceQuery';
import { LEGACY_OPENING_BALANCE_CUTOFF } from '../../src/domain/budgets/PersistentContributions';
import type * as schema from '../../src/data/local/schema';

/**
 * "Savings are real" — a persistent envelope's balance ACCUMULATES one
 * contribution per rolled-over period instead of being the static
 * `allocatedCents` the user typed (DOM-4/VAL-3), and Baby Step 3 does not
 * falsely regress while the new period's income is still unknown (DOM-8).
 */

/**
 * Every envelope in this file is created AFTER the legacy cutoff, so none of
 * them receives an `opening_balance` backfill and each starts at exactly R0
 * saved. That is the whole point: typing an allocation must buy nothing.
 */
const NOW = '2026-10-01T00:00:00.000Z';
const P1 = '2026-10-01';
const P2 = '2026-11-01';
const P3 = '2026-12-01';
const P4 = '2027-01-01';
const HOUSEHOLD_ID = 'hh-contributions';
const R500 = 50_000;

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  name: string;
  envelopeType: string;
  periodStart: string;
  allocatedCents: number;
  createdAt?: string;
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
    args.allocatedCents,
    args.envelopeType,
    args.periodStart,
    args.createdAt ?? NOW,
    args.createdAt ?? NOW,
  );
}

function seedBabyStepRow(
  db: Database.Database,
  args: { stepNumber: number; isCompleted: boolean; completedAt: string | null },
): void {
  db.prepare(
    `INSERT INTO baby_steps
       (id, household_id, step_number, is_completed, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `bs-${args.stepNumber}`,
    HOUSEHOLD_ID,
    args.stepNumber,
    args.isCompleted ? 1 : 0,
    args.completedAt,
    NOW,
    NOW,
  );
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function rollover(
  db: ExpoSQLiteDatabase<typeof schema>,
  from: string,
  to: string,
  deviceId = 'device-1',
): ReturnType<StartNewPeriodUseCase['execute']> {
  return new StartNewPeriodUseCase(db, { deviceId, actorUserId: 'user-1' }).execute({
    householdId: HOUSEHOLD_ID,
    fromPeriodStart: from,
    toPeriodStart: to,
  });
}

function countRows(raw: Database.Database, table: string): number {
  return (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('persistent envelope contributions (real SQLite)', () => {
  it('a R500/month sinking fund reaches R1,500 after three rolled-over periods', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-car',
      name: 'Car Service',
      envelopeType: 'sinking_fund',
      periodStart: P1,
      allocatedCents: R500,
    });
    const db = makeDb(raw);

    // Nothing has been rolled over yet: an allocation the user typed is a
    // pledge for the current period, not money in the fund.
    expect((await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID)).get('env-car')).toBe(0);

    for (const [from, to] of [
      [P1, P2],
      [P2, P3],
      [P3, P4],
    ]) {
      const result = await rollover(db, from, to);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.contributionCount).toBe(1);
      expect(result.data.contributedCents).toBe(R500);
    }

    const saved = await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID);
    expect(saved.get('env-car')).toBe(150_000); // R1,500

    // The fund row itself was never duplicated — only contribution rows grew.
    expect(countRows(raw, "envelopes WHERE envelope_type = 'sinking_fund'")).toBe(1);
    expect(countRows(raw, 'envelope_contributions')).toBe(3);

    raw.close();
  });

  it('spend against a fund is subtracted from its contributions', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-car',
      name: 'Car Service',
      envelopeType: 'sinking_fund',
      periodStart: P1,
      allocatedCents: R500,
    });
    const db = makeDb(raw);

    await rollover(db, P1, P2);
    await rollover(db, P2, P3);
    raw
      .prepare(
        `INSERT INTO transactions
           (id, household_id, envelope_id, amount_cents, transaction_date,
            is_business_expense, created_at, updated_at)
         VALUES ('txn-1', ?, 'env-car', 30000, ?, 0, ?, ?)`,
      )
      .run(HOUSEHOLD_ID, P3, NOW, NOW);

    const saved = await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID);
    expect(saved.get('env-car')).toBe(100_000 - 30_000);

    raw.close();
  });

  it('a double rollover of the same transition funds the envelope exactly once', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-car',
      name: 'Car Service',
      envelopeType: 'sinking_fund',
      periodStart: P1,
      allocatedCents: R500,
    });
    seedEnvelope(raw, {
      id: 'env-groceries',
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: P1,
      allocatedCents: 45_000,
    });
    const db = makeDb(raw);

    const first = await rollover(db, P1, P2);
    expect(first.success).toBe(true);
    if (!first.success) throw new Error('unreachable');
    expect(first.data.count).toBe(1);
    expect(first.data.contributionCount).toBe(1);

    // Replay the SAME transition — a crash retry, or a second device that
    // rolled over offline and whose ops have now synced. Deterministic
    // contribution ids make this a no-op.
    const second = await rollover(db, P1, P2, 'device-2');
    expect(second.success).toBe(true);
    if (!second.success) throw new Error('unreachable');
    expect(second.data.count).toBe(0);
    expect(second.data.contributionCount).toBe(0);
    expect(second.data.contributedCents).toBe(0);

    expect(countRows(raw, 'envelope_contributions')).toBe(1);
    const saved = await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID);
    expect(saved.get('env-car')).toBe(R500);

    raw.close();
  });

  it('Baby Step 1 does not complete from a typed R1,000 allocation, and does complete once R1,000 is contributed', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    // R1,000 typed straight into the allocation field of a brand-new EMF.
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: 100_000,
    });
    for (const stepNumber of [1, 2, 3, 4, 5, 6, 7]) {
      seedBabyStepRow(raw, { stepNumber, isCompleted: false, completedAt: null });
    }
    const db = makeDb(raw);

    const typed = await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P1);
    expect(typed.success).toBe(true);
    if (!typed.success) throw new Error('unreachable');
    const step1Typed = typed.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1Typed?.isCompleted).toBe(false);
    expect(step1Typed?.progress).toEqual({ current: 0, target: 100_000, unit: 'cents' });
    expect(typed.data.newlyCompleted).not.toContain(1);

    // One period rolled over funds R1,000 for real.
    await rollover(db, P1, P2);

    const funded = await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P2);
    expect(funded.success).toBe(true);
    if (!funded.success) throw new Error('unreachable');
    const step1Funded = funded.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1Funded?.isCompleted).toBe(true);
    expect(step1Funded?.progress).toEqual({ current: 100_000, target: 100_000, unit: 'cents' });
    expect(funded.data.newlyCompleted).toContain(1);

    raw.close();
  });

  it('Baby Step 3 does not regress when the new period has no income envelopes yet (DOM-8)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-emf',
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: 1_000_000,
    });
    // Step 3 was completed in an earlier period and is persisted as such.
    seedBabyStepRow(raw, { stepNumber: 3, isCompleted: true, completedAt: NOW });
    for (const stepNumber of [1, 2, 4, 5, 6, 7]) {
      seedBabyStepRow(raw, { stepNumber, isCompleted: false, completedAt: null });
    }
    const db = makeDb(raw);

    // No income envelope exists at all, so INCOME_TOTAL = 0 and the 3-months
    // target is UNKNOWN — not unmet.
    const result = await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P2);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');

    expect(result.data.newlyRegressed).not.toContain(3);
    const step3 = result.data.statuses.find((s) => s.stepNumber === 3);
    expect(step3?.isCompleted).toBe(true);
    expect(step3?.completedAt).toBe(NOW);

    // And nothing was WRITTEN: the persisted row is untouched.
    const persisted = raw
      .prepare('SELECT * FROM baby_steps WHERE household_id = ? AND step_number = 3')
      .get(HOUSEHOLD_ID) as { is_completed: number; completed_at: string | null };
    expect(persisted.is_completed).toBe(1);
    expect(persisted.completed_at).toBe(NOW);

    raw.close();
  });

  it('carries a LEGACY envelope’s pre-ledger allocation in exactly once, and never a post-cutoff one', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-legacy',
      name: 'Legacy Fund',
      envelopeType: 'savings',
      periodStart: '2026-01-01',
      allocatedCents: 250_000,
      createdAt: '2026-01-01T00:00:00.000Z', // before LEGACY_OPENING_BALANCE_CUTOFF
    });
    seedEnvelope(raw, {
      id: 'env-new',
      name: 'New Fund',
      envelopeType: 'sinking_fund',
      periodStart: P1,
      allocatedCents: 250_000,
    });
    expect('2026-01-01T00:00:00.000Z' < LEGACY_OPENING_BALANCE_CUTOFF).toBe(true);
    expect(NOW < LEGACY_OPENING_BALANCE_CUTOFF).toBe(false);
    const db = makeDb(raw);

    for (const stepNumber of [1, 2, 3, 4, 5, 6, 7]) {
      seedBabyStepRow(raw, { stepNumber, isCompleted: false, completedAt: null });
    }

    // Reconcile runs the backfill. Running it twice must not double it.
    await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P1);
    await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P1);

    const saved = await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID);
    expect(saved.get('env-legacy')).toBe(250_000);
    expect(saved.get('env-new')).toBe(0);
    expect(countRows(raw, 'envelope_contributions')).toBe(1);

    raw.close();
  });
});

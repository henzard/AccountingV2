import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { StartNewPeriodUseCase } from '../../src/domain/budgets/StartNewPeriodUseCase';
import { ReconcileBabyStepsUseCase } from '../../src/domain/babySteps/ReconcileBabyStepsUseCase';
import type * as schema from '../../src/data/local/schema';

/**
 * Regression test for the deep-review bug: "Baby Steps 1 & 3 regress every
 * month." Root cause (pre-slice-3): the emergency_fund envelope was
 * period-scoped, so after payday rolled the household onto a new period,
 * there was no emergency_fund row for the new period — reconcile would find
 * no EMF and report Step 1/3 as incomplete even though the household's
 * savings never moved.
 *
 * Slice 3 made `emergency_fund` a PERSISTENT-scope envelope type (one row,
 * all-time derived balance, never recreated per period). Slice 4 added
 * `StartNewPeriodUseCase`, which copies PERIOD-scoped envelopes forward at
 * rollover and — correctly — never touches persistent-scope rows.
 *
 * This test proves the fix holds end-to-end: seed a household with a funded,
 * persistent emergency_fund envelope in period P1, mark Baby Step 1 complete,
 * roll over to period P2 via StartNewPeriodUseCase, then reconcile in P2 and
 * assert Step 1 is STILL complete.
 */

const NOW = '2026-07-25T00:00:00.000Z';
const P1 = '2026-07-01';
const P2 = '2026-08-01';
const HOUSEHOLD_ID = 'hh-babystep-rollover';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  householdId: string;
  name: string;
  envelopeType: string;
  periodStart: string;
  allocatedCents: number;
}

function seedEnvelope(db: Database.Database, args: SeedEnvelopeArgs): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  ).run(
    args.id,
    args.householdId,
    args.name,
    args.allocatedCents,
    args.envelopeType,
    args.periodStart,
    NOW,
    NOW,
  );
}

function seedTransaction(
  db: Database.Database,
  args: { id: string; householdId: string; envelopeId: string; amountCents: number },
): void {
  db.prepare(
    `INSERT INTO transactions
       (id, household_id, envelope_id, amount_cents, transaction_date,
        is_business_expense, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(args.id, args.householdId, args.envelopeId, args.amountCents, NOW, NOW, NOW);
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

interface BabyStepRow {
  step_number: number;
  is_completed: number;
  completed_at: string | null;
}

describe('Baby Step 1/3 regression across a period rollover (real SQLite)', () => {
  it('does NOT regress Step 1 after StartNewPeriodUseCase rolls the household onto a new period', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);

    // Persistent emergency_fund envelope, funded above the R1,000 Step-1 target,
    // created in period P1 (its period_start never changes going forward).
    seedEnvelope(raw, {
      id: 'env-emf',
      householdId: HOUSEHOLD_ID,
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: 150_000, // R1,500
    });
    // No spend against it — balance = allocated = R1,500 >= R1,000 target.

    // A couple of ordinary period-scoped envelopes in P1, so rollover has
    // something realistic to copy forward alongside the untouched EMF.
    seedEnvelope(raw, {
      id: 'env-groceries',
      householdId: HOUSEHOLD_ID,
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: P1,
      allocatedCents: 45_000,
    });
    seedEnvelope(raw, {
      id: 'env-income',
      householdId: HOUSEHOLD_ID,
      name: 'Salary',
      envelopeType: 'income',
      periodStart: P1,
      allocatedCents: 500_000,
    });

    seedTransaction(raw, {
      id: 'txn-groceries-1',
      householdId: HOUSEHOLD_ID,
      envelopeId: 'env-groceries',
      amountCents: 10_000,
    });

    // Persisted baby_steps rows: Step 1 already marked complete in P1.
    seedBabyStepRow(raw, { stepNumber: 1, isCompleted: true, completedAt: NOW });
    for (const stepNumber of [2, 3, 4, 5, 6, 7]) {
      seedBabyStepRow(raw, { stepNumber, isCompleted: false, completedAt: null });
    }

    const db = makeDb(raw);

    // Sanity check: reconcile in P1 keeps Step 1 complete (no regression even
    // before rollover — establishes the baseline).
    const beforeRollover = await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P1);
    expect(beforeRollover.success).toBe(true);
    if (!beforeRollover.success) throw new Error('unreachable');
    expect(beforeRollover.data.newlyRegressed).not.toContain(1);
    const step1Before = beforeRollover.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1Before?.isCompleted).toBe(true);

    // Roll over to period P2 — copies period-scoped envelopes forward,
    // leaves the persistent EMF row untouched (same id, same period_start).
    const rolloverResult = await new StartNewPeriodUseCase(db, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    }).execute({ householdId: HOUSEHOLD_ID, fromPeriodStart: P1, toPeriodStart: P2 });
    expect(rolloverResult.success).toBe(true);
    if (!rolloverResult.success) throw new Error('unreachable');
    expect(rolloverResult.data.count).toBe(2); // groceries + income copied; EMF skipped

    // The EMF row itself was never duplicated or moved to P2.
    const emfRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
      .all() as { id: string; period_start: string }[];
    expect(emfRows).toHaveLength(1);
    expect(emfRows[0].id).toBe('env-emf');
    expect(emfRows[0].period_start).toBe(P1);

    // Reconcile against the NEW period. THE HEADLINE ASSERTION: Step 1 must
    // still be complete — it must not be in newlyRegressed, and its
    // isCompleted must remain true — because the persistent EMF is found
    // regardless of period.
    const afterRollover = await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P2);
    expect(afterRollover.success).toBe(true);
    if (!afterRollover.success) throw new Error('unreachable');

    expect(afterRollover.data.newlyRegressed).not.toContain(1);
    const step1After = afterRollover.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1After?.isCompleted).toBe(true);
    expect(step1After?.progress).toEqual({ current: 150_000, target: 100_000, unit: 'cents' });

    // The persisted baby_steps row for step 1 was not flipped to incomplete.
    const persistedStep1 = raw
      .prepare('SELECT * FROM baby_steps WHERE household_id = ? AND step_number = 1')
      .get(HOUSEHOLD_ID) as BabyStepRow;
    expect(persistedStep1.is_completed).toBe(1);
    expect(persistedStep1.completed_at).not.toBeNull();

    raw.close();
  });

  it('WOULD regress Step 1 if the EMF query filtered by period_start equality (documents the bug this fixes)', async () => {
    // This test pins down the pre-fix behavior directly against the query
    // shape, independent of the use case, so a future edit that reintroduces
    // a strict period_start equality filter on the envelope read is caught
    // even if ReconcileBabyStepsUseCase's structure changes.
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-emf',
      householdId: HOUSEHOLD_ID,
      name: 'Emergency Fund',
      envelopeType: 'emergency_fund',
      periodStart: P1,
      allocatedCents: 150_000,
    });

    // Simulate the OLD buggy query: strict period_start equality against the
    // new period, with no persistent-scope carve-out.
    const buggyRows = raw
      .prepare('SELECT * FROM envelopes WHERE household_id = ? AND period_start = ?')
      .all(HOUSEHOLD_ID, P2) as unknown[];
    expect(buggyRows).toHaveLength(0); // <- the bug: EMF invisible in the new period

    // The fixed scope-aware query (what ReconcileBabyStepsUseCase now runs)
    // still finds it.
    const db = makeDb(raw);
    const afterRollover = await new ReconcileBabyStepsUseCase(db).execute(HOUSEHOLD_ID, P2);
    expect(afterRollover.success).toBe(true);
    if (!afterRollover.success) throw new Error('unreachable');
    const step1 = afterRollover.data.statuses.find((s) => s.stepNumber === 1);
    expect(step1?.isCompleted).toBe(true);

    raw.close();
  });
});

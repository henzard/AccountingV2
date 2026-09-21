/**
 * rolloverRealHouseholdShape.test.ts
 *
 * The rollover the dashboard/Budget screens offer to THE REAL HOUSEHOLD this
 * round is for: payday on the 20th, 18 budgeted periods of history, and a
 * current period (2026-09-20) with no envelopes of its own. The newest period
 * with envelopes is 2026-08-20, carrying 12 rows:
 *   - 10 `spending` envelopes,
 *   - 1 `income` envelope ("Nedbank"),
 *   - 1 `savings` fund ("Saving") — a PERSISTENT type, which must be FUNDED
 *     by the rollover, never copied into a second row.
 *
 * This pins what "Start this period from last period's budget" actually does
 * for that shape, so the CTA those screens now offer prominently cannot
 * quietly start doing something else.
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { StartNewPeriodUseCase } from '../../src/domain/budgets/StartNewPeriodUseCase';
import { periodContributionId } from '../../src/domain/budgets/PersistentContributions';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-08-20T00:00:00.000Z';
const FROM_PERIOD = '2026-08-20';
const TO_PERIOD = '2026-09-20';
const HOUSEHOLD_ID = 'hh-real';

const SPENDING_NAMES = [
  'Clothing',
  'Education',
  'Food',
  'Giving',
  'Health',
  'Housing',
  'Lifestyle',
  'Transfers',
  'Transportation',
  'Utilities',
];

function seedHousehold(db: Database.Database): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Real Household', 20, ?, ?)`,
  ).run(HOUSEHOLD_ID, NOW, NOW);
}

function seedEnvelope(
  db: Database.Database,
  args: {
    id: string;
    name: string;
    envelopeType: string;
    periodStart: string;
    allocatedCents: number;
    createdAt?: string;
  },
): void {
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
    NOW,
  );
}

/** The 12 rows the 2026-08-20 period carries, as the import created them. */
function seedLastBudgetedPeriod(db: Database.Database): void {
  seedHousehold(db);
  SPENDING_NAMES.forEach((name, index) => {
    seedEnvelope(db, {
      id: `env-${name.toLowerCase()}`,
      name,
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      // 36 of the household's 216 envelopes carry a zero allocation; keep one
      // here so a zero-allocation spending envelope is covered too.
      allocatedCents: index === 0 ? 0 : 50_000 + index * 1_000,
    });
  });
  seedEnvelope(db, {
    id: 'env-nedbank',
    name: 'Nedbank',
    envelopeType: 'income',
    periodStart: FROM_PERIOD,
    allocatedCents: 3_500_00,
  });
  seedEnvelope(db, {
    id: 'env-saving',
    name: 'Saving',
    envelopeType: 'savings',
    periodStart: FROM_PERIOD,
    allocatedCents: 100_000,
    // Born AFTER the legacy cutoff, i.e. its allocation is a genuine monthly
    // contribution, not a saved balance needing the opening-balance backfill.
    createdAt: '2026-09-21T00:00:00.001Z',
  });
  db.prepare(
    `INSERT INTO envelope_contributions
       (id, household_id, envelope_id, amount_cents, source, period_start, created_at, updated_at)
     VALUES ('contrib-initial', ?, 'env-saving', 0, 'initial', ?, ?, ?)`,
  ).run(HOUSEHOLD_ID, FROM_PERIOD, NOW, NOW);
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

interface EnvelopeRow {
  id: string;
  name: string;
  envelope_type: string;
  allocated_cents: number;
  period_start: string;
}

describe('the rollover offered to the real household (payday 20, 18 periods of history)', () => {
  it('carries forward all 10 spending envelopes AND the income envelope', async () => {
    const raw = openMigratedDb();
    seedLastBudgetedPeriod(raw);

    const useCase = new StartNewPeriodUseCase(makeDb(raw), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    });
    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.count).toBe(11);

    const newRows = raw
      .prepare('SELECT * FROM envelopes WHERE period_start = ? ORDER BY name')
      .all(TO_PERIOD) as EnvelopeRow[];
    expect(newRows).toHaveLength(11);
    expect(newRows.filter((r) => r.envelope_type === 'spending')).toHaveLength(10);
    expect(newRows.filter((r) => r.envelope_type === 'income')).toHaveLength(1);
    expect(newRows.map((r) => r.name)).toEqual(
      [...SPENDING_NAMES, 'Nedbank'].sort((a, b) => a.localeCompare(b)),
    );

    // Allocations carry over unchanged, zero-allocation envelopes included.
    const food = newRows.find((r) => r.name === 'Food');
    expect(food?.allocated_cents).toBe(52_000);
    expect(newRows.find((r) => r.name === 'Clothing')?.allocated_cents).toBe(0);
    expect(newRows.find((r) => r.name === 'Nedbank')?.allocated_cents).toBe(3_500_00);

    raw.close();
  });

  it('FUNDS the savings fund rather than copying it into a second row', async () => {
    const raw = openMigratedDb();
    seedLastBudgetedPeriod(raw);

    const useCase = new StartNewPeriodUseCase(makeDb(raw), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    });
    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');

    // Never copied: still exactly ONE savings row, the original.
    const savingsRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'savings'")
      .all() as EnvelopeRow[];
    expect(savingsRows).toHaveLength(1);
    expect(savingsRows[0].id).toBe('env-saving');
    expect(savingsRows[0].period_start).toBe(FROM_PERIOD);

    // Funded: one contribution row for the NEW period, for its monthly amount.
    expect(result.data.contributionCount).toBe(1);
    expect(result.data.contributedCents).toBe(100_000);
    const contributions = raw
      .prepare(
        `SELECT amount_cents, period_start FROM envelope_contributions
         WHERE envelope_id = 'env-saving' AND period_start = ?`,
      )
      .all(TO_PERIOD) as { amount_cents: number; period_start: string }[];
    expect(contributions).toHaveLength(1);
    expect(contributions[0].amount_cents).toBe(100_000);

    raw.close();
  });

  it('is safe to replay: a second run copies and funds nothing further', async () => {
    const raw = openMigratedDb();
    seedLastBudgetedPeriod(raw);

    const useCase = new StartNewPeriodUseCase(makeDb(raw), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    });
    const input = {
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    };
    await useCase.execute(input);
    const second = await useCase.execute(input);

    expect(second.success).toBe(true);
    if (!second.success) throw new Error('unreachable');
    expect(second.data.count).toBe(0);
    expect(second.data.contributionCount).toBe(0);

    const newRows = raw
      .prepare('SELECT id FROM envelopes WHERE period_start = ?')
      .all(TO_PERIOD) as { id: string }[];
    expect(newRows).toHaveLength(11);

    raw.close();
  });

  /**
   * THE DATA HAZARD, now FIXED rather than pinned: the import created ONE
   * 'savings' row per period — 18 "Saving" envelopes for one persistent fund.
   * The rollover's scope predicate matches every persistent row
   * unconditionally, so it used to fund EACH of them, turning one month's
   * R1 000 contribution into R18 000 across 18 duplicate rows. Duplicates of
   * the same (type, name) are now treated as ONE fund and funded once, on the
   * group's deterministically chosen carrier row — here the earliest
   * `created_at`, and since all three share one, the lowest id ('env-saving').
   *
   * (Before this change this test asserted contributionCount 3 /
   * contributedCents 300 000, i.e. the bug; it is the same scenario, flipped
   * to the fixed expectation.)
   */
  it('funds duplicate savings rows of the same fund exactly ONCE', async () => {
    const raw = openMigratedDb();
    seedLastBudgetedPeriod(raw);
    // Two more periods' worth of the same fund, exactly as the import left it.
    for (const periodStart of ['2026-06-20', '2026-07-20']) {
      seedEnvelope(raw, {
        id: `env-saving-${periodStart}`,
        name: 'Saving',
        envelopeType: 'savings',
        periodStart,
        allocatedCents: 100_000,
        createdAt: '2026-09-21T00:00:00.001Z',
      });
      raw
        .prepare(
          `INSERT INTO envelope_contributions
             (id, household_id, envelope_id, amount_cents, source, period_start, created_at, updated_at)
           VALUES (?, ?, ?, 0, 'initial', ?, ?, ?)`,
        )
        .run(
          `contrib-initial-${periodStart}`,
          HOUSEHOLD_ID,
          `env-saving-${periodStart}`,
          periodStart,
          NOW,
          NOW,
        );
    }

    const useCase = new StartNewPeriodUseCase(makeDb(raw), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    });
    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    // One per FUND, not one per duplicate row.
    expect(result.data.contributionCount).toBe(1);
    expect(result.data.contributedCents).toBe(100_000);

    const written = raw
      .prepare(
        `SELECT envelope_id, amount_cents FROM envelope_contributions
         WHERE period_start = ? AND source = 'rollover'`,
      )
      .all(TO_PERIOD) as { envelope_id: string; amount_cents: number }[];
    expect(written).toEqual([{ envelope_id: 'env-saving', amount_cents: 100_000 }]);

    raw.close();
  });
});

/** The 18 period_starts the household's history really carries, oldest first. */
const SAVING_PERIODS = Array.from({ length: 18 }, (_, index) => {
  const month = 2 + index; // 0-based from January 2025: index 0 => 2025-03
  const year = 2025 + Math.floor(month / 12);
  return `${year}-${String((month % 12) + 1).padStart(2, '0')}-20`;
});

/**
 * The fund as the IMPORT actually left it: one `savings` row per period, all
 * named "Saving", each already carrying its own `opening_balance`
 * contribution written by the importer — i.e. under an id this app did not
 * choose, which is what makes it invisible to an id-keyed existence check.
 */
function seedImportedSavingDuplicates(db: Database.Database): void {
  SAVING_PERIODS.forEach((periodStart) => {
    seedEnvelope(db, {
      id: `env-saving-${periodStart}`,
      name: 'Saving',
      envelopeType: 'savings',
      periodStart,
      allocatedCents: 100_000,
      // Pre-cutoff, like everything this household's import created.
      createdAt: `${periodStart}T00:00:00.000Z`,
    });
    db.prepare(
      `INSERT INTO envelope_contributions
         (id, household_id, envelope_id, amount_cents, source, period_start, created_at, updated_at)
       VALUES (?, ?, ?, 250000, 'opening_balance', ?, ?, ?)`,
    ).run(
      `import-open-${periodStart}`,
      HOUSEHOLD_ID,
      `env-saving-${periodStart}`,
      periodStart,
      NOW,
      NOW,
    );
  });
}

function seedImportedHousehold(db: Database.Database): void {
  seedHousehold(db);
  SPENDING_NAMES.forEach((name, index) => {
    seedEnvelope(db, {
      id: `env-${name.toLowerCase()}`,
      name,
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      allocatedCents: index === 0 ? 0 : 50_000 + index * 1_000,
    });
  });
  seedEnvelope(db, {
    id: 'env-nedbank',
    name: 'Nedbank',
    envelopeType: 'income',
    periodStart: FROM_PERIOD,
    allocatedCents: 3_500_00,
  });
  seedImportedSavingDuplicates(db);
}

function countContributions(raw: Database.Database): number {
  return (raw.prepare('SELECT COUNT(*) AS n FROM envelope_contributions').get() as { n: number }).n;
}

function rollForward(raw: Database.Database): ReturnType<StartNewPeriodUseCase['execute']> {
  return new StartNewPeriodUseCase(makeDb(raw), {
    deviceId: 'device-1',
    actorUserId: 'user-1',
  }).execute({
    householdId: HOUSEHOLD_ID,
    fromPeriodStart: FROM_PERIOD,
    toPeriodStart: TO_PERIOD,
  });
}

/**
 * The household's 18 duplicate "Saving" rows, each with its own imported
 * opening balance — the exact state the owner's phone is in when the new
 * "Start this period from last period's budget" button appears.
 */
describe('18 duplicate "Saving" rows are ONE fund (real household)', () => {
  it('writes exactly one rollover contribution, on the oldest row, for one month of saving', async () => {
    const raw = openMigratedDb();
    seedImportedHousehold(raw);

    const result = await rollForward(raw);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    // Before the fix this was 18 contributions / R18 000 — one month's saving
    // credited once per duplicate row.
    expect(result.data.contributionCount).toBe(1);
    expect(result.data.contributedCents).toBe(100_000);

    const written = raw
      .prepare(
        `SELECT id, envelope_id, amount_cents FROM envelope_contributions
         WHERE period_start = ? AND source = 'rollover'`,
      )
      .all(TO_PERIOD) as { id: string; envelope_id: string; amount_cents: number }[];
    expect(written).toHaveLength(1);
    expect(written[0].envelope_id).toBe(`env-saving-${SAVING_PERIODS[0]}`);
    expect(written[0].amount_cents).toBe(100_000);

    raw.close();
  });

  it('picks the same carrier — and so the same contribution id — in two independent databases', async () => {
    // Two phones, each with its own sqlite file, rolling the same transition
    // over offline. A different carrier on each would mean two
    // differently-keyed rows for one month, and the fund funded twice the
    // moment they sync.
    const deviceA = openMigratedDb();
    const deviceB = openMigratedDb();
    seedImportedHousehold(deviceA);
    seedImportedHousehold(deviceB);

    await rollForward(deviceA);
    await rollForward(deviceB);

    const idOf = (raw: Database.Database): { id: string; envelope_id: string } =>
      raw
        .prepare(
          `SELECT id, envelope_id FROM envelope_contributions
           WHERE period_start = ? AND source = 'rollover'`,
        )
        .get(TO_PERIOD) as { id: string; envelope_id: string };

    expect(idOf(deviceA)).toEqual(idOf(deviceB));
    expect(idOf(deviceA).id).toBe(
      periodContributionId(HOUSEHOLD_ID, `env-saving-${SAVING_PERIODS[0]}`, TO_PERIOD),
    );

    deviceA.close();
    deviceB.close();
  });

  it('replays without writing anything further', async () => {
    const raw = openMigratedDb();
    seedImportedHousehold(raw);

    await rollForward(raw);
    const before = countContributions(raw);
    const second = await rollForward(raw);

    expect(second.success).toBe(true);
    if (!second.success) throw new Error('unreachable');
    expect(second.data).toEqual({ count: 0, contributionCount: 0, contributedCents: 0 });
    expect(countContributions(raw)).toBe(before);

    raw.close();
  });

  it('treats the fund as funded when ANY duplicate row already has the period (value guard)', async () => {
    const raw = openMigratedDb();
    seedImportedHousehold(raw);
    // A row funded for the target period under an id the deterministic check
    // cannot predict — what `UpdateHouseholdPaydayDayUseCase` leaves behind
    // when a payday change re-keys a contribution, here landing on a
    // duplicate that is NOT the carrier.
    raw
      .prepare(
        `INSERT INTO envelope_contributions
           (id, household_id, envelope_id, amount_cents, source, period_start, created_at, updated_at)
         VALUES ('rekeyed-row', ?, ?, 100000, 'rollover', ?, ?, ?)`,
      )
      .run(HOUSEHOLD_ID, `env-saving-${SAVING_PERIODS[5]}`, TO_PERIOD, NOW, NOW);

    const result = await rollForward(raw);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.contributionCount).toBe(0);
    expect(result.data.contributedCents).toBe(0);
    expect(
      raw
        .prepare(
          `SELECT COUNT(*) AS n FROM envelope_contributions
           WHERE period_start = ? AND source = 'rollover'`,
        )
        .get(TO_PERIOD),
    ).toEqual({ n: 1 });

    raw.close();
  });

  /**
   * The two bugs meet here: 18 duplicates, each already holding an imported
   * `opening_balance`. The backfill must not add a second opening row beside
   * any of them (which would double all 18 saved balances), and must leave
   * their allocations alone so the fund still gets its month.
   */
  it('adds no second opening balance beside the import’s 18, and still funds the fund', async () => {
    const raw = openMigratedDb();
    seedImportedHousehold(raw);

    const result = await rollForward(raw);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(
      raw
        .prepare(
          `SELECT COUNT(*) AS n FROM envelope_contributions WHERE source = 'opening_balance'`,
        )
        .get(),
    ).toEqual({ n: 18 });
    // Untouched: `allocated_cents` beside an existing opening balance is a
    // MONTHLY contribution, never a legacy saved balance to be moved again.
    expect(
      raw
        .prepare(
          `SELECT COUNT(*) AS n FROM envelopes
           WHERE envelope_type = 'savings' AND allocated_cents = 100000`,
        )
        .get(),
    ).toEqual({ n: 18 });
    expect(result.data.contributionCount).toBe(1);

    raw.close();
  });
});

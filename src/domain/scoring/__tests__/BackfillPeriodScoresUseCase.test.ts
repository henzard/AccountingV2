/**
 * `BackfillPeriodScoresUseCase` against a REAL migrated better-sqlite3
 * database, seeded in the shape of the household this was written for:
 * payday on the 20th, several CLOSED periods that each carry the same twelve
 * envelope names (ten `spending`, one `income` "Nedbank", one persistent
 * `savings` "Saving"), income transactions recorded against the income
 * envelope, and ZERO meter readings.
 *
 * Everything asserted here is a number this use case has to get exactly
 * right — the scores, that a second run writes nothing, and the level the
 * resulting history earns — so it runs against the real driver and the real
 * migration chain rather than a mocked db that could only ever agree with
 * whatever the implementation happened to do.
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
import { BackfillPeriodScoresUseCase } from '../BackfillPeriodScoresUseCase';
import { deriveLevelFromScores } from '../LevelAdvancementEvaluator';
import { periodScoreId } from '../RecordPeriodScoreUseCase';

const HOUSEHOLD_ID = 'hh-backfill';
const NOW_ISO = '2026-09-21T00:00:00.000Z';
/** Today is 2026-09-21 with payday 20 -> the CURRENT period starts 2026-09-20. */
const TODAY = new Date(NOW_ISO);
const PAYDAY_DAY = 20;

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

/** The closed periods seeded below, oldest first. */
const CLOSED_PERIODS = ['2026-06-20', '2026-07-20', '2026-08-20'];
/** Has envelopes but is the CURRENT period — must never be scored. */
const CURRENT_PERIOD = '2026-09-20';

interface Ctx {
  raw: Database.Database;
  db: ExpoSQLiteDatabase<typeof schema>;
}

function open(): Ctx {
  const raw = openMigratedDb();
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
       VALUES (?, 'Kruger', ?, 1, ?, ?)`,
    )
    .run(HOUSEHOLD_ID, PAYDAY_DAY, NOW_ISO, NOW_ISO);
  return { raw, db: drizzle(raw) as unknown as ExpoSQLiteDatabase<typeof schema> };
}

function insertEnvelope(
  raw: Database.Database,
  id: string,
  name: string,
  envelopeType: string,
  periodStart: string,
  allocatedCents: number,
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type, is_savings_locked,
          is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    )
    .run(id, HOUSEHOLD_ID, name, allocatedCents, envelopeType, periodStart, NOW_ISO, NOW_ISO);
}

function insertTransaction(
  raw: Database.Database,
  id: string,
  envelopeId: string,
  amountCents: number,
  date: string,
): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, transaction_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, HOUSEHOLD_ID, envelopeId, amountCents, date, NOW_ISO, NOW_ISO);
}

/** `yyyy-MM-dd` + n days, computed in UTC. */
function plusDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Seeds one period exactly the way the real import did: 10 spending
 * envelopes + 1 income envelope ("Nedbank") + 1 persistent savings envelope
 * ("Saving"), with envelope ids unique to the period.
 *
 * `overspentCount` spending envelopes are pushed over their allocation;
 * every other spending envelope stays under. `loggingDays` distinct
 * transaction DATES are used, so the logging component is controllable.
 * The income envelope always receives a deposit far above its allocation —
 * money IN, which must never read as an overspend.
 */
function seedPeriod(
  raw: Database.Database,
  periodStart: string,
  opts: { overspentCount: number; loggingDays: number },
): void {
  SPENDING_NAMES.forEach((name, index) => {
    const id = `env-${periodStart}-${name}`;
    insertEnvelope(raw, id, name, 'spending', periodStart, 100_000);
    const over = index < opts.overspentCount;
    // One transaction per envelope, spread over `loggingDays` distinct dates.
    const day = index % Math.max(1, opts.loggingDays);
    insertTransaction(
      raw,
      `txn-${periodStart}-${name}`,
      id,
      over ? 150_000 : 40_000,
      plusDays(periodStart, day),
    );
  });

  const incomeId = `env-${periodStart}-Nedbank`;
  insertEnvelope(raw, incomeId, 'Nedbank', 'income', periodStart, 100_000);
  // The salary deposit: far above the income envelope's allocation.
  insertTransaction(raw, `txn-${periodStart}-Nedbank`, incomeId, 900_000, plusDays(periodStart, 1));

  // Persistent 'savings' envelope — NOT period-scoped, so it is never part
  // of the on-budget count for any period.
  insertEnvelope(raw, `env-${periodStart}-Saving`, 'Saving', 'savings', periodStart, 50_000);
}

function scoreRows(raw: Database.Database): { period_start: string; score: number }[] {
  return raw
    .prepare(
      `SELECT period_start, score FROM score_history
       WHERE household_id = ? ORDER BY period_start ASC`,
    )
    .all(HOUSEHOLD_ID) as { period_start: string; score: number }[];
}

describe('BackfillPeriodScoresUseCase (real migrated sqlite, DATA_SHAPE household)', () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = open();
  });

  afterEach(() => {
    ctx.raw.close();
  });

  it('scores every closed period that has envelopes, oldest first, and never the current one', async () => {
    for (const periodStart of CLOSED_PERIODS) {
      seedPeriod(ctx.raw, periodStart, { overspentCount: 0, loggingDays: 10 });
    }
    seedPeriod(ctx.raw, CURRENT_PERIOD, { overspentCount: 0, loggingDays: 10 });

    const result = await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.recordedPeriodStarts).toEqual(CLOSED_PERIODS);
    expect(result.data.recorded).toBe(3);
    expect(scoreRows(ctx.raw).map((r) => r.period_start)).toEqual(CLOSED_PERIODS);
  });

  it('computes the exact score: income is money IN, and never-used meters are EXCLUDED, not zeroed', async () => {
    // 2026-06-20 -> 2026-07-19 is 30 days. 10 distinct logging dates.
    // logging    = round(10/30 * 30) = 10
    // discipline = all TEN spending envelopes on budget; the income envelope
    //              is excluded entirely -> round(10/10 * 30) = 30
    // meters     = NOT APPLICABLE — this household has never logged one, so
    //              the component is dropped and the rest re-normalised.
    // babyStep   = 0 (no completed baby step seeded)
    // score      = (10 + 30 + 0) / 80 * 100 = 50   (was 40 under the old
    //              formula, which charged them 20 points for a feature they
    //              have never used)
    seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 0, loggingDays: 10 });

    const result = await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });
    expect(result.success).toBe(true);

    const rows = ctx.raw
      .prepare(`SELECT id, score, components FROM score_history WHERE period_start = ?`)
      .all('2026-06-20') as { id: string; score: number; components: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(periodScoreId(HOUSEHOLD_ID, '2026-06-20'));
    expect(JSON.parse(rows[0].components)).toEqual({
      score: 50,
      loggingPoints: 10,
      disciplinePoints: 30,
      metersPoints: null,
      babyStepPoints: 0,
      metersApplicable: false,
    });
    expect(rows[0].score).toBe(50);
  });

  it('counts overspent spending envelopes against discipline, still ignoring income', async () => {
    // 3 of 10 spending envelopes overspent -> 7 on budget.
    // discipline = round(7/10 * 30) = 21; logging = round(10/30 * 30) = 10.
    // score = (10 + 21) / 80 * 100 = 38.75 -> 39.
    seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 3, loggingDays: 10 });

    await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    const [row] = ctx.raw
      .prepare(`SELECT components FROM score_history WHERE period_start = ?`)
      .all('2026-06-20') as { components: string }[];
    expect(JSON.parse(row.components)).toMatchObject({
      score: 39,
      loggingPoints: 10,
      disciplinePoints: 21,
    });
  });

  it('awards the baby-step points from the real table, not a guess', async () => {
    seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 0, loggingDays: 10 });
    ctx.raw
      .prepare(
        `INSERT INTO baby_steps (id, household_id, step_number, is_completed, created_at, updated_at)
         VALUES ('bs-1', ?, 1, 1, ?, ?)`,
      )
      .run(HOUSEHOLD_ID, NOW_ISO, NOW_ISO);

    await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    const [row] = ctx.raw
      .prepare(`SELECT score, components FROM score_history WHERE period_start = ?`)
      .all('2026-06-20') as { score: number; components: string }[];
    // (10 + 30 + 20) / 80 * 100 = 75.
    expect(JSON.parse(row.components)).toMatchObject({ babyStepPoints: 20, score: 75 });
  });

  // ── Meters applicability, end to end against the real table ─────────────
  describe('meters applicability', () => {
    it('scores a household that has EVER logged a reading on the full 100, as before', async () => {
      seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 0, loggingDays: 10 });
      // One reading, logged inside the period being scored.
      ctx.raw
        .prepare(
          `INSERT INTO meter_readings
             (id, household_id, meter_type, reading_value, reading_date, created_at, updated_at)
           VALUES ('mr-1', ?, 'electricity', 100, '2026-06-25', ?, ?)`,
        )
        .run(HOUSEHOLD_ID, NOW_ISO, NOW_ISO);

      await new BackfillPeriodScoresUseCase(ctx.db).execute({
        householdId: HOUSEHOLD_ID,
        paydayDay: PAYDAY_DAY,
        now: TODAY,
      });

      const [row] = ctx.raw
        .prepare(`SELECT components FROM score_history WHERE period_start = ?`)
        .all('2026-06-20') as { components: string }[];
      expect(JSON.parse(row.components)).toEqual({
        score: 60, // 10 + 30 + 20 + 0, NOT re-normalised
        loggingPoints: 10,
        disciplinePoints: 30,
        metersPoints: 20,
        babyStepPoints: 0,
        metersApplicable: true,
      });
    });

    it('applies the component from the period they FIRST logged one onwards, not before', async () => {
      seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 0, loggingDays: 10 });
      seedPeriod(ctx.raw, '2026-08-20', { overspentCount: 0, loggingDays: 10 });
      // First-ever reading lands in the LATER period.
      ctx.raw
        .prepare(
          `INSERT INTO meter_readings
             (id, household_id, meter_type, reading_value, reading_date, created_at, updated_at)
           VALUES ('mr-1', ?, 'electricity', 100, '2026-08-25', ?, ?)`,
        )
        .run(HOUSEHOLD_ID, NOW_ISO, NOW_ISO);

      await new BackfillPeriodScoresUseCase(ctx.db).execute({
        householdId: HOUSEHOLD_ID,
        paydayDay: PAYDAY_DAY,
        now: TODAY,
      });

      const rows = ctx.raw
        .prepare(`SELECT period_start, components FROM score_history ORDER BY period_start ASC`)
        .all() as { period_start: string; components: string }[];

      // June: they had never used meters by then -> excluded, re-normalised.
      expect(JSON.parse(rows[0].components)).toMatchObject({
        metersApplicable: false,
        metersPoints: null,
        score: 50,
      });
      // August: the feature is in use -> scored on the full 100.
      expect(JSON.parse(rows[1].components)).toMatchObject({
        metersApplicable: true,
        metersPoints: 20,
      });
    });

    it('recomputes an OLD-FORMULA row exactly once, then never touches it again', async () => {
      seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 0, loggingDays: 10 });
      // A row as an earlier build would have written it: no `metersApplicable`
      // key, and the old capped-at-80 score.
      ctx.raw
        .prepare(
          `INSERT INTO score_history (id, household_id, period_start, score, components, created_at)
           VALUES (?, ?, '2026-06-20', 40,
                   '{"score":40,"loggingPoints":10,"disciplinePoints":30,"metersPoints":0,"babyStepPoints":0}',
                   '2026-01-01T00:00:00.000Z')`,
        )
        .run(periodScoreId(HOUSEHOLD_ID, '2026-06-20'), HOUSEHOLD_ID);

      const useCase = new BackfillPeriodScoresUseCase(ctx.db);
      const first = await useCase.execute({
        householdId: HOUSEHOLD_ID,
        paydayDay: PAYDAY_DAY,
        now: TODAY,
      });

      expect(first.success).toBe(true);
      if (!first.success) return;
      expect(first.data.recomputedPeriodStarts).toEqual(['2026-06-20']);
      expect(first.data.recorded).toBe(0);

      const after = ctx.raw
        .prepare(`SELECT score, components, created_at FROM score_history WHERE period_start = ?`)
        .all('2026-06-20') as { score: number; components: string; created_at: string }[];
      expect(after).toHaveLength(1);
      expect(after[0].score).toBe(50);
      expect(JSON.parse(after[0].components)).toMatchObject({ metersApplicable: false, score: 50 });
      // The row still records when that period was FIRST scored.
      expect(after[0].created_at).toBe('2026-01-01T00:00:00.000Z');

      // Exactly once: the marker is now present, so a second pass is a no-op.
      const second = await useCase.execute({
        householdId: HOUSEHOLD_ID,
        paydayDay: PAYDAY_DAY,
        now: TODAY,
      });
      expect(second.success).toBe(true);
      if (!second.success) return;
      expect(second.data.recomputed).toBe(0);
      expect(second.data.recorded).toBe(0);
      expect(
        ctx.raw.prepare(`SELECT score FROM score_history WHERE period_start = ?`).all('2026-06-20'),
      ).toEqual([{ score: 50 }]);
    });

    it('never rewrites a row that already carries the marker', async () => {
      seedPeriod(ctx.raw, '2026-06-20', { overspentCount: 0, loggingDays: 10 });
      ctx.raw
        .prepare(
          `INSERT INTO score_history (id, household_id, period_start, score, components, created_at)
           VALUES (?, ?, '2026-06-20', 99,
                   '{"score":99,"loggingPoints":1,"disciplinePoints":1,"metersPoints":null,"babyStepPoints":1,"metersApplicable":false}',
                   ?)`,
        )
        .run(periodScoreId(HOUSEHOLD_ID, '2026-06-20'), HOUSEHOLD_ID, NOW_ISO);

      const result = await new BackfillPeriodScoresUseCase(ctx.db).execute({
        householdId: HOUSEHOLD_ID,
        paydayDay: PAYDAY_DAY,
        now: TODAY,
      });

      expect(result.success && result.data.recomputed).toBe(0);
      expect(
        (
          ctx.raw
            .prepare(`SELECT score FROM score_history WHERE period_start = ?`)
            .get('2026-06-20') as { score: number }
        ).score,
      ).toBe(99);
    });
  });

  it('is idempotent — a second run writes nothing and changes no row', async () => {
    for (const periodStart of CLOSED_PERIODS) {
      seedPeriod(ctx.raw, periodStart, { overspentCount: 1, loggingDays: 12 });
    }
    const useCase = new BackfillPeriodScoresUseCase(ctx.db);

    const first = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });
    expect(first.success && first.data.recorded).toBe(3);
    const after = scoreRows(ctx.raw);

    const second = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.recorded).toBe(0);
    expect(second.data.recordedPeriodStarts).toEqual([]);
    expect(scoreRows(ctx.raw)).toEqual(after);
  });

  it('leaves a period that already has a score exactly as it was', async () => {
    for (const periodStart of CLOSED_PERIODS) {
      seedPeriod(ctx.raw, periodStart, { overspentCount: 0, loggingDays: 10 });
    }
    ctx.raw
      .prepare(
        `INSERT INTO score_history (id, household_id, period_start, score, components, created_at)
         VALUES (?, ?, ?, 99,
                 '{"score":99,"loggingPoints":1,"disciplinePoints":1,"metersPoints":null,"babyStepPoints":1,"metersApplicable":false}',
                 ?)`,
      )
      .run(periodScoreId(HOUSEHOLD_ID, '2026-07-20'), HOUSEHOLD_ID, '2026-07-20', NOW_ISO);

    const result = await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    expect(result.success && result.data.recordedPeriodStarts).toEqual([
      '2026-06-20',
      '2026-08-20',
    ]);
    const preserved = scoreRows(ctx.raw).find((r) => r.period_start === '2026-07-20');
    expect(preserved?.score).toBe(99);
  });

  it('does nothing, and reports nothing scoreable, for a brand-new household', async () => {
    const result = await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      scoreablePeriods: 0,
      recorded: 0,
      recordedPeriodStarts: [],
      recomputed: 0,
      recomputedPeriodStarts: [],
    });
    expect(scoreRows(ctx.raw)).toEqual([]);
  });

  it('a period whose only envelope is the persistent savings fund is not scoreable', async () => {
    insertEnvelope(ctx.raw, 'env-only-fund', 'Saving', 'savings', '2026-06-20', 50_000);

    const result = await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    expect(result.success && result.data.scoreablePeriods).toBe(0);
    expect(scoreRows(ctx.raw)).toEqual([]);
  });

  it('the backfilled history is what the level is then derived from', async () => {
    // Six periods, every spending envelope on budget and (nearly) every day
    // logged, plus a completed baby step -> high enough for the Lv2->Lv3
    // rule (six consecutive periods at 85+).
    const periods = [
      '2026-03-20',
      '2026-04-20',
      '2026-05-20',
      '2026-06-20',
      '2026-07-20',
      '2026-08-20',
    ];
    ctx.raw
      .prepare(
        `INSERT INTO baby_steps (id, household_id, step_number, is_completed, created_at, updated_at)
         VALUES ('bs-1', ?, 1, 1, ?, ?)`,
      )
      .run(HOUSEHOLD_ID, NOW_ISO, NOW_ISO);
    for (const periodStart of periods) {
      seedPeriod(ctx.raw, periodStart, { overspentCount: 0, loggingDays: 10 });
      // Push logging to full marks with extra dates, and log a meter reading.
      for (let day = 0; day < 28; day += 1) {
        insertTransaction(
          ctx.raw,
          `txn-extra-${periodStart}-${day}`,
          `env-${periodStart}-Food`,
          10,
          plusDays(periodStart, day),
        );
      }
      ctx.raw
        .prepare(
          `INSERT INTO meter_readings
             (id, household_id, meter_type, reading_value, reading_date, created_at, updated_at)
           VALUES (?, ?, 'electricity', 100, ?, ?, ?)`,
        )
        .run(`mr-${periodStart}`, HOUSEHOLD_ID, plusDays(periodStart, 2), NOW_ISO, NOW_ISO);
    }

    await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    const scores = scoreRows(ctx.raw).map((r) => r.score);
    expect(scores).toHaveLength(6);
    expect(scores.every((s) => s >= 85)).toBe(true);
    expect(deriveLevelFromScores(scores)).toBe(3);
  });

  it('a modest history lands on Lv1 — a backfill never invents a level', async () => {
    for (const periodStart of CLOSED_PERIODS) {
      seedPeriod(ctx.raw, periodStart, { overspentCount: 6, loggingDays: 3 });
    }

    await new BackfillPeriodScoresUseCase(ctx.db).execute({
      householdId: HOUSEHOLD_ID,
      paydayDay: PAYDAY_DAY,
      now: TODAY,
    });

    const scores = scoreRows(ctx.raw).map((r) => r.score);
    expect(scores).toHaveLength(3);
    expect(deriveLevelFromScores(scores)).toBe(1);
  });
});

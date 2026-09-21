import { parseISO } from 'date-fns';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import type { EnvelopeBalanceDb } from '../../src/data/local/balances/EnvelopeBalanceQuery';
import { getCategoryHistory } from '../../src/data/local/balances/CategoryHistoryQuery';
import {
  BASELINE_PERIOD_WINDOW,
  baselineKey,
  buildCategoryBaselines,
  incomeBaselines,
  spendingBaselines,
} from '../../src/domain/forecasting/CategoryBaseline';
import { CashFlowForecaster } from '../../src/domain/forecasting/CashFlowForecaster';
import type { EnvelopeEntity } from '../../src/domain/envelopes/EnvelopeEntity';

/**
 * Seeded to the shape of the REAL household this feature exists for
 * (DATA_SHAPE): payday on the 20th, 18 closed periods of history, the SAME
 * category names every period but a DIFFERENT envelope id each time, salary
 * recorded as transactions against an income envelope, and — the reason the
 * forecast screen is blank today — NO envelopes at all for the current
 * period (2026-09-20).
 */
const NOW = '2026-09-21T00:00:00.000Z';
const HOUSEHOLD_ID = 'hh-real';
const CURRENT_PERIOD_START = '2026-09-20';

/** The 18 period starts, oldest first: 2025-03-20 … 2026-08-20. */
function allPeriodStarts(): string[] {
  const starts: string[] = [];
  let year = 2025;
  let month = 3; // 1-based
  for (let i = 0; i < 18; i += 1) {
    starts.push(`${year}-${String(month).padStart(2, '0')}-20`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return starts;
}

/** `periodStart` + (dayOfPeriod - 1) days, as a YYYY-MM-DD string. */
function dayOfPeriodDate(periodStart: string, dayOfPeriod: number): string {
  const [year, month, day] = periodStart.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + (dayOfPeriod - 1)));
  return date.toISOString().slice(0, 10);
}

function seedHousehold(db: Database.Database): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Real Household', 20, ?, ?)`,
  ).run(HOUSEHOLD_ID, NOW, NOW);
}

interface EnvelopeSeed {
  id: string;
  name: string;
  envelopeType: string;
  periodStart: string;
  allocatedCents?: number;
  isArchived?: boolean;
  deletedAt?: string | null;
}

function seedEnvelope(db: Database.Database, e: EnvelopeSeed): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).run(
    e.id,
    HOUSEHOLD_ID,
    e.name,
    e.allocatedCents ?? 0,
    e.envelopeType,
    e.isArchived === true ? 1 : 0,
    e.periodStart,
    NOW,
    NOW,
    e.deletedAt ?? null,
  );
}

interface TransactionSeed {
  id: string;
  envelopeId: string;
  amountCents: number;
  transactionDate: string;
  deletedAt?: string | null;
}

function seedTransaction(db: Database.Database, t: TransactionSeed): void {
  db.prepare(
    `INSERT INTO transactions
       (id, household_id, envelope_id, amount_cents, transaction_date,
        is_business_expense, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    t.id,
    HOUSEHOLD_ID,
    t.envelopeId,
    t.amountCents,
    t.transactionDate,
    NOW,
    NOW,
    t.deletedAt ?? null,
  );
}

/**
 * The last six CLOSED periods — the window a baseline is built from.
 * Everything before them is history the window must ignore.
 */
const RECENT_SIX = [
  '2026-03-20',
  '2026-04-20',
  '2026-05-20',
  '2026-06-20',
  '2026-07-20',
  '2026-08-20',
];

/** Food's day-3 spend, then the rest of the period's spend, per recent period. */
const FOOD_DAY_3 = [30000, 40000, 50000, 60000, 70000, 80000];
const FOOD_TOTAL = [100000, 120000, 140000, 160000, 180000, 200000];

function seedRealHousehold(db: Database.Database): void {
  seedHousehold(db);

  for (const periodStart of allPeriodStarts()) {
    const recentIndex = RECENT_SIX.indexOf(periodStart);
    const tag = periodStart.replace(/-/g, '');

    // FOOD — note the leading/trailing space and the changing case: the only
    // thing linking these rows across periods is lower(trim(name)).
    const foodId = `env-food-${tag}`;
    seedEnvelope(db, {
      id: foodId,
      name: recentIndex % 2 === 0 ? ' Food ' : 'food',
      envelopeType: 'spending',
      periodStart,
      allocatedCents: 150000,
    });
    if (recentIndex === -1) {
      // Older than the window: a deliberately absurd figure, so a baseline
      // that accidentally included it could not possibly pass.
      seedTransaction(db, {
        id: `tx-food-old-${tag}`,
        envelopeId: foodId,
        amountCents: 9999900,
        transactionDate: dayOfPeriodDate(periodStart, 5),
      });
    } else {
      seedTransaction(db, {
        id: `tx-food-a-${tag}`,
        envelopeId: foodId,
        amountCents: FOOD_DAY_3[recentIndex],
        transactionDate: dayOfPeriodDate(periodStart, 3),
      });
      seedTransaction(db, {
        id: `tx-food-b-${tag}`,
        envelopeId: foodId,
        amountCents: FOOD_TOTAL[recentIndex] - FOOD_DAY_3[recentIndex],
        // Day 20 — after the day-9 cut, so it must NOT appear in the
        // "by day 9" figure but must appear in the period total.
        transactionDate: dayOfPeriodDate(periodStart, 20),
      });
    }

    // HOUSING — one fixed debit order on day 1, identical every period.
    const housingId = `env-housing-${tag}`;
    seedEnvelope(db, {
      id: housingId,
      name: 'Housing',
      envelopeType: 'spending',
      periodStart,
      allocatedCents: 500000,
    });
    seedTransaction(db, {
      id: `tx-housing-${tag}`,
      envelopeId: housingId,
      amountCents: 500000,
      transactionDate: dayOfPeriodDate(periodStart, 1),
    });

    // CLOTHING — the envelope exists every period but is usually untouched.
    // Those zeros are real observations and must count toward the median.
    const clothingId = `env-clothing-${tag}`;
    seedEnvelope(db, {
      id: clothingId,
      name: 'Clothing',
      envelopeType: 'spending',
      periodStart,
      allocatedCents: 0,
    });
    if (periodStart === '2026-07-20' || periodStart === '2026-08-20') {
      seedTransaction(db, {
        id: `tx-clothing-${tag}`,
        envelopeId: clothingId,
        amountCents: periodStart === '2026-07-20' ? 20000 : 40000,
        transactionDate: dayOfPeriodDate(periodStart, 4),
      });
    }

    // LIFESTYLE — a purchase and a refund, so the net is what counts.
    const lifestyleId = `env-lifestyle-${tag}`;
    seedEnvelope(db, {
      id: lifestyleId,
      name: 'Lifestyle',
      envelopeType: 'spending',
      periodStart,
      allocatedCents: 60000,
    });
    seedTransaction(db, {
      id: `tx-lifestyle-buy-${tag}`,
      envelopeId: lifestyleId,
      amountCents: 50000,
      transactionDate: dayOfPeriodDate(periodStart, 2),
    });
    seedTransaction(db, {
      id: `tx-lifestyle-refund-${tag}`,
      envelopeId: lifestyleId,
      amountCents: -10000,
      transactionDate: dayOfPeriodDate(periodStart, 5),
    });

    // INCOME — the import recorded salary as transactions on the income
    // envelope. Money IN; never spending.
    const incomeId = `env-income-${tag}`;
    seedEnvelope(db, {
      id: incomeId,
      name: 'Nedbank',
      envelopeType: 'income',
      periodStart,
      allocatedCents: 2500000,
    });
    seedTransaction(db, {
      id: `tx-income-${tag}`,
      envelopeId: incomeId,
      amountCents: 2500000,
      transactionDate: dayOfPeriodDate(periodStart, 1),
    });

    // Excluded noise: an ARCHIVED envelope and a SOFT-DELETED transaction.
    const archivedId = `env-archived-${tag}`;
    seedEnvelope(db, {
      id: archivedId,
      name: 'Old Hobby',
      envelopeType: 'spending',
      periodStart,
      allocatedCents: 90000,
      isArchived: true,
    });
    seedTransaction(db, {
      id: `tx-archived-${tag}`,
      envelopeId: archivedId,
      amountCents: 90000,
      transactionDate: dayOfPeriodDate(periodStart, 6),
    });
    seedTransaction(db, {
      id: `tx-deleted-food-${tag}`,
      envelopeId: foodId,
      amountCents: 777700,
      transactionDate: dayOfPeriodDate(periodStart, 4),
      deletedAt: NOW,
    });
  }
  // NOTHING is seeded for CURRENT_PERIOD_START — that empty current period is
  // the state the real household is in today.
}

function openSeeded(): { raw: Database.Database; db: EnvelopeBalanceDb } {
  const raw = openMigratedDb();
  seedRealHousehold(raw);
  return { raw, db: drizzle(raw) };
}

/** The real household's current period is genuinely empty. */
async function loadBaselines(db: EnvelopeBalanceDb, dayOfPeriod: number) {
  const history = await getCategoryHistory(db, HOUSEHOLD_ID, CURRENT_PERIOD_START, {
    maxPeriods: BASELINE_PERIOD_WINDOW,
    throughDayOfPeriod: dayOfPeriod,
  });
  return { history, baselines: buildCategoryBaselines(history) };
}

describe('category spending history (real SQLite, real-household shape)', () => {
  it('has no envelopes at all for the current period — the state that blanks the screen today', () => {
    const { raw } = openSeeded();
    try {
      const row = raw
        .prepare(`SELECT COUNT(*) AS n FROM envelopes WHERE period_start = ?`)
        .get(CURRENT_PERIOD_START) as { n: number };
      expect(row.n).toBe(0);
    } finally {
      raw.close();
    }
  });

  it('looks back over exactly the last six CLOSED periods, newest first', async () => {
    const { raw, db } = openSeeded();
    try {
      const { history } = await loadBaselines(db, 9);
      expect(history.periodStarts).toEqual([...RECENT_SIX].reverse());
    } finally {
      raw.close();
    }
  });

  it('matches a category across periods by (type, lower(trim(name))) despite new ids each period', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      const food = baselines.get(baselineKey('spending', 'Food'));
      expect(food).toBeDefined();
      expect(food?.periodsObserved).toBe(6);
      // ' Food ' and 'food' collapsed into one category, not two.
      expect(spendingBaselines(baselines).filter((b) => b.categoryKey === 'food')).toHaveLength(1);
    } finally {
      raw.close();
    }
  });

  it('computes the MEDIAN period spend, and the range around it', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      const food = baselines.get(baselineKey('spending', 'Food'));
      // 100000 120000 140000 160000 180000 200000 → (140000 + 160000) / 2
      expect(food?.typicalPeriodSpendCents).toBe(150000);
      expect(food?.lowestPeriodSpendCents).toBe(100000);
      expect(food?.highestPeriodSpendCents).toBe(200000);
    } finally {
      raw.close();
    }
  });

  it('counts a period the category existed but was never spent in as a real ZERO', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      const clothing = baselines.get(baselineKey('spending', 'Clothing'));
      // 0 0 0 0 20000 40000 → median of the two middle zeros
      expect(clothing?.periodsObserved).toBe(6);
      expect(clothing?.typicalPeriodSpendCents).toBe(0);
      expect(clothing?.highestPeriodSpendCents).toBe(40000);
    } finally {
      raw.close();
    }
  });

  it('nets refunds against purchases', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      // 50000 spent, 10000 refunded, every period.
      expect(baselines.get(baselineKey('spending', 'Lifestyle'))?.typicalPeriodSpendCents).toBe(
        40000,
      );
    } finally {
      raw.close();
    }
  });

  it('gives the typical CUMULATIVE spend by the same day of the period', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      const food = baselines.get(baselineKey('spending', 'Food'));
      // Only the day-3 transactions fall on or before day 9:
      // 30000 40000 50000 60000 70000 80000 → (50000 + 60000) / 2
      expect(food?.typicalSpendByDayCents).toBe(55000);
      expect(food?.throughDayOfPeriod).toBe(9);

      // Housing's whole bill lands on day 1, so it is already fully spent.
      expect(baselines.get(baselineKey('spending', 'Housing'))?.typicalSpendByDayCents).toBe(
        500000,
      );
    } finally {
      raw.close();
    }
  });

  it('moves the by-day figure with the day asked for', async () => {
    const { raw, db } = openSeeded();
    try {
      const day1 = await loadBaselines(db, 1);
      const day25 = await loadBaselines(db, 25);
      const key = baselineKey('spending', 'Food');
      // Nothing on day 1; by day 25 both transactions have landed.
      expect(day1.baselines.get(key)?.typicalSpendByDayCents).toBe(0);
      expect(day25.baselines.get(key)?.typicalSpendByDayCents).toBe(150000);
    } finally {
      raw.close();
    }
  });

  it('keeps income out of the spending baselines and carries it as income', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      expect(spendingBaselines(baselines).map((b) => b.categoryKey)).not.toContain('nedbank');
      const income = incomeBaselines(baselines);
      expect(income).toHaveLength(1);
      expect(income[0].typicalPeriodSpendCents).toBe(2500000);
    } finally {
      raw.close();
    }
  });

  it('excludes archived envelopes and soft-deleted transactions', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      expect(baselines.get(baselineKey('spending', 'Old Hobby'))).toBeUndefined();
      // The 777700 soft-deleted row would have wrecked Food's median.
      expect(baselines.get(baselineKey('spending', 'Food'))?.typicalPeriodSpendCents).toBe(150000);
    } finally {
      raw.close();
    }
  });

  it('carries the typical allocation for each category', async () => {
    const { raw, db } = openSeeded();
    try {
      const { baselines } = await loadBaselines(db, 9);
      expect(baselines.get(baselineKey('spending', 'Food'))?.typicalAllocatedCents).toBe(150000);
      expect(baselines.get(baselineKey('spending', 'Clothing'))?.typicalAllocatedCents).toBe(0);
    } finally {
      raw.close();
    }
  });

  describe('the blended projection, fed by this real history', () => {
    const forecaster = new CashFlowForecaster();
    const periodStart = '2026-09-20';
    const periodEnd = '2026-10-19'; // 30 days

    function foodEnvelope(spentCents: number): EnvelopeEntity {
      return {
        id: 'env-food-current',
        householdId: HOUSEHOLD_ID,
        name: 'Food',
        allocatedCents: 150000,
        spentCents,
        envelopeType: 'spending',
        isSavingsLocked: false,
        isArchived: false,
        periodStart,
        targetAmountCents: null,
        targetDate: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
    }

    it('on day 1 leans on history instead of extrapolating one shop into a month', async () => {
      const { raw, db } = openSeeded();
      try {
        const { baselines } = await loadBaselines(db, 1);
        // One R800 shop on day 1. The pure run rate says 800 x 30 = R24 000.
        const [result] = forecaster.project({
          envelopes: [foodEnvelope(80000)],
          baselines,
          periodStart,
          periodEnd,
          today: parseISO('2026-09-20'),
        });
        expect(result.baselineWeight).toBeCloseTo(29 / 30, 5);
        // 29/30 x 150000 + 1/30 x 2400000 = 145000 + 80000 = 225000
        expect(result.projectedTotalSpendCents).toBe(225000);
        // …and nowhere near the R24 000 the run rate alone would claim.
        expect(result.projectedTotalSpendCents).toBeLessThan(400000);
      } finally {
        raw.close();
      }
    });

    it('on the LAST day is purely what actually happened', async () => {
      const { raw, db } = openSeeded();
      try {
        const { baselines } = await loadBaselines(db, 30);
        const [result] = forecaster.project({
          envelopes: [foodEnvelope(90000)],
          baselines,
          periodStart,
          periodEnd,
          today: parseISO('2026-10-19'),
        });
        expect(result.baselineWeight).toBe(0);
        expect(result.projectedTotalSpendCents).toBe(90000);
        expect(result.projectedSpendRemainingCents).toBe(0);
      } finally {
        raw.close();
      }
    });

    it('halfway through, splits the difference between history and the run rate', async () => {
      const { raw, db } = openSeeded();
      try {
        const { baselines } = await loadBaselines(db, 15);
        // Day 15 of 30: 15 days elapsed, 15 remaining, R900 spent so far →
        // run rate 6000/day → run-rate total 90000 + 90000 = 180000.
        const [result] = forecaster.project({
          envelopes: [foodEnvelope(90000)],
          baselines,
          periodStart,
          periodEnd,
          today: parseISO('2026-10-04'),
        });
        expect(result.baselineWeight).toBeCloseTo(0.5, 5);
        expect(result.projectedTotalSpendCents).toBe(Math.round(0.5 * 150000 + 0.5 * 180000));
      } finally {
        raw.close();
      }
    });

    it('reports pace against the typical spend by the same day', async () => {
      const { raw, db } = openSeeded();
      try {
        const { baselines } = await loadBaselines(db, 9);
        const [result] = forecaster.project({
          envelopes: [foodEnvelope(75000)],
          baselines,
          periodStart,
          periodEnd,
          today: parseISO('2026-09-28'), // day 9
        });
        expect(result.daysElapsed).toBe(9);
        expect(result.typicalSpendByTodayCents).toBe(55000);
        expect(result.paceVsTypicalCents).toBe(20000);
      } finally {
        raw.close();
      }
    });
  });

  describe('performance', () => {
    it('answers the whole screen in a handful of queries over 18 periods of ledger', async () => {
      const { raw } = openSeeded();
      try {
        let queries = 0;
        const counting = drizzle(raw, {
          logger: {
            logQuery: () => {
              queries += 1;
            },
          },
        });
        const started = Date.now();
        const history = await getCategoryHistory(counting, HOUSEHOLD_ID, CURRENT_PERIOD_START, {
          maxPeriods: BASELINE_PERIOD_WINDOW,
          throughDayOfPeriod: 9,
        });
        const elapsedMs = Date.now() - started;

        // Five spending/income categories over six periods, from >900 rows —
        // and never more than four queries, whatever the category count.
        expect(history.categories.length).toBeGreaterThanOrEqual(5);
        expect(queries).toBeLessThanOrEqual(4);
        expect(elapsedMs).toBeLessThan(1000);
      } finally {
        raw.close();
      }
    });
  });
});

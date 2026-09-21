import type {
  CategoryHistory,
  CategoryHistoryEntry,
} from '../../../data/local/balances/CategoryHistoryQuery';
import {
  MIN_PERIODS_FOR_BASELINE,
  baselineKey,
  buildCategoryBaselines,
  categoryKey,
  incomeBaselines,
  medianCents,
  spendingBaselines,
} from '../CategoryBaseline';

function entry(
  over: Partial<CategoryHistoryEntry> & {
    spends: number[];
    byDay?: number[];
    allocated?: number[];
  },
): CategoryHistoryEntry {
  const { spends, byDay, allocated, ...rest } = over;
  return {
    categoryKey: 'food',
    displayName: 'Food',
    envelopeType: 'spending',
    ...rest,
    periods: spends.map((spendCents, index) => ({
      periodStart: `2026-0${index + 1}-20`,
      spendCents,
      spendByDayCents: byDay?.[index] ?? 0,
      allocatedCents: allocated?.[index] ?? 0,
    })),
  };
}

function history(
  categories: CategoryHistoryEntry[],
  throughDayOfPeriod: number | null = 9,
): CategoryHistory {
  return { periodStarts: [], throughDayOfPeriod, categories };
}

describe('categoryKey / baselineKey', () => {
  it('matches a category across periods case-insensitively and trimmed', () => {
    expect(categoryKey('  FOOD ')).toBe('food');
    expect(baselineKey('spending', ' Food ')).toBe(baselineKey('spending', 'food'));
  });

  it('keeps categories of DIFFERENT types apart even with the same name', () => {
    expect(baselineKey('spending', 'Nedbank')).not.toBe(baselineKey('income', 'Nedbank'));
  });
});

describe('medianCents', () => {
  it('averages the two middle values of an even sample', () => {
    expect(medianCents([100, 200, 300, 400])).toBe(250);
  });

  it('takes the middle value of an odd sample', () => {
    expect(medianCents([300, 100, 200])).toBe(200);
  });

  it('is unmoved by a single freak period, where a mean would not be', () => {
    const ordinary = [100000, 110000, 105000, 115000, 108000];
    const withFreak = [...ordinary, 1400000];
    expect(medianCents(withFreak)).toBeLessThan(120000);
  });

  it('returns 0 for no observations', () => {
    expect(medianCents([])).toBe(0);
  });
});

describe('buildCategoryBaselines', () => {
  it('refuses to call a single period a baseline', () => {
    expect(MIN_PERIODS_FOR_BASELINE).toBe(2);
    const built = buildCategoryBaselines(history([entry({ spends: [123400] })]));
    expect(built.size).toBe(0);
  });

  it('builds the median, the range and the by-day figure', () => {
    const built = buildCategoryBaselines(
      history([
        entry({
          spends: [100000, 120000, 140000, 160000, 180000, 200000],
          byDay: [30000, 40000, 50000, 60000, 70000, 80000],
          allocated: [150000, 150000, 150000, 150000, 150000, 150000],
        }),
      ]),
    );
    const food = built.get(baselineKey('spending', 'Food'));
    expect(food?.typicalPeriodSpendCents).toBe(150000);
    expect(food?.lowestPeriodSpendCents).toBe(100000);
    expect(food?.highestPeriodSpendCents).toBe(200000);
    expect(food?.typicalSpendByDayCents).toBe(55000);
    expect(food?.throughDayOfPeriod).toBe(9);
    expect(food?.typicalAllocatedCents).toBe(150000);
    expect(food?.periodsObserved).toBe(6);
  });

  it('leaves the by-day figure null when no day-of-period was asked for', () => {
    const built = buildCategoryBaselines(history([entry({ spends: [1000, 2000] })], null));
    const food = built.get(baselineKey('spending', 'Food'));
    expect(food?.typicalSpendByDayCents).toBeNull();
    expect(food?.throughDayOfPeriod).toBeNull();
  });

  it('keeps income out of the spending baselines', () => {
    const built = buildCategoryBaselines(
      history([
        entry({ spends: [100000, 120000] }),
        entry({
          categoryKey: 'nedbank',
          displayName: 'Nedbank',
          envelopeType: 'income',
          spends: [2500000, 2500000],
        }),
      ]),
    );
    expect(spendingBaselines(built).map((b) => b.categoryKey)).toEqual(['food']);
    expect(incomeBaselines(built).map((b) => b.categoryKey)).toEqual(['nedbank']);
  });

  it('orders spending baselines biggest-typical first', () => {
    const built = buildCategoryBaselines(
      history([
        entry({ categoryKey: 'clothing', displayName: 'Clothing', spends: [0, 0] }),
        entry({ spends: [100000, 120000] }),
        entry({ categoryKey: 'housing', displayName: 'Housing', spends: [500000, 500000] }),
      ]),
    );
    expect(spendingBaselines(built).map((b) => b.categoryKey)).toEqual([
      'housing',
      'food',
      'clothing',
    ]);
  });
});

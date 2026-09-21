import type { EnvelopeForecast } from '../CashFlowForecaster';
import type { CategoryBaseline } from '../CategoryBaseline';
import {
  MAX_AT_RISK_CATEGORIES,
  buildEnvelopeInsight,
  buildPeriodSummaryCopy,
  summarisePeriodForecast,
} from '../ForecastInsight';

const format = (cents: number): string => `R${(cents / 100).toFixed(2)}`;

function baseline(overrides: Partial<CategoryBaseline> = {}): CategoryBaseline {
  return {
    categoryKey: 'food',
    displayName: 'Food',
    envelopeType: 'spending',
    periodsObserved: 6,
    typicalPeriodSpendCents: 150000,
    lowestPeriodSpendCents: 100000,
    highestPeriodSpendCents: 200000,
    typicalSpendByDayCents: 55000,
    throughDayOfPeriod: 9,
    typicalAllocatedCents: 150000,
    ...overrides,
  };
}

function forecast(overrides: Partial<EnvelopeForecast> = {}): EnvelopeForecast {
  return {
    envelopeId: 'e1',
    envelopeName: 'Food',
    allocatedCents: 150000,
    spentCents: 75000,
    dailySpendCents: 8333,
    daysElapsed: 9,
    daysRemaining: 21,
    projectedSpendRemainingCents: 55000,
    projectedRemainingCents: 20000,
    projectedRemainingPct: 13,
    status: 'warning',
    isFixed: false,
    baseline: baseline(),
    projectedTotalSpendCents: 130000,
    baselineWeight: 0.7,
    typicalSpendByTodayCents: 55000,
    paceVsTypicalCents: 20000,
    ...overrides,
  };
}

describe('buildEnvelopeInsight', () => {
  it('says what the household usually spends and what is left when on track', () => {
    const copy = buildEnvelopeInsight(forecast(), format);
    expect(copy.headline).toBe(
      'On track — projected to reach R1300.00; you usually spend about R1500.00 on Food; R200.00 left',
    );
  });

  it('names the overshoot in cash, not in colour, when heading over', () => {
    const copy = buildEnvelopeInsight(
      forecast({ projectedTotalSpendCents: 190000, status: 'over_budget' }),
      format,
    );
    expect(copy.headline).toContain('Likely over by R400.00');
    expect(copy.headline).toContain('you usually spend about R1500.00 on Food');
  });

  it('calls a zero allocation with spend unbudgeted, not fine', () => {
    const copy = buildEnvelopeInsight(
      forecast({ allocatedCents: 0, spentCents: 50000, projectedTotalSpendCents: 120000 }),
      format,
    );
    expect(copy.headline).toContain('Not budgeted this period');
    expect(copy.headline).toContain('R500.00 spent');
  });

  it('reports pace against the usual pace by this day of the period', () => {
    expect(buildEnvelopeInsight(forecast(), format).pace).toBe(
      'R200.00 ahead of your usual pace by day 9',
    );
    expect(buildEnvelopeInsight(forecast({ paceVsTypicalCents: -12000 }), format).pace).toBe(
      'R120.00 behind your usual pace by day 9',
    );
    expect(buildEnvelopeInsight(forecast({ paceVsTypicalCents: 0 }), format).pace).toBe(
      'Exactly your usual pace by day 9',
    );
  });

  it('has no pace line and no "usually" claim without history', () => {
    const copy = buildEnvelopeInsight(
      forecast({ baseline: null, paceVsTypicalCents: null, typicalSpendByTodayCents: null }),
      format,
    );
    expect(copy.pace).toBeNull();
    expect(copy.headline).not.toContain('usually');
    expect(copy.headline).toContain('projected to reach R1300.00');
  });

  it('rolls both lines into one accessibility label', () => {
    const copy = buildEnvelopeInsight(forecast(), format);
    expect(copy.accessibilityLabel).toBe(`${copy.headline}. ${copy.pace}.`);
  });
});

describe('summarisePeriodForecast', () => {
  const forecasts = [
    forecast({
      envelopeId: 'a',
      envelopeName: 'Food',
      allocatedCents: 150000,
      projectedTotalSpendCents: 190000,
    }),
    forecast({
      envelopeId: 'b',
      envelopeName: 'Housing',
      allocatedCents: 500000,
      projectedTotalSpendCents: 500000,
    }),
    forecast({
      envelopeId: 'c',
      envelopeName: 'Transport',
      allocatedCents: 100000,
      projectedTotalSpendCents: 250000,
    }),
    forecast({
      envelopeId: 'd',
      envelopeName: 'Giving',
      allocatedCents: 50000,
      projectedTotalSpendCents: 60000,
    }),
    forecast({
      envelopeId: 'e',
      envelopeName: 'Health',
      allocatedCents: 40000,
      projectedTotalSpendCents: 45000,
    }),
  ];

  it('totals the projection against what is allocated and what income was allocated', () => {
    const summary = summarisePeriodForecast(forecasts, 1200000);
    expect(summary.projectedTotalSpendCents).toBe(1045000);
    expect(summary.totalAllocatedCents).toBe(840000);
    expect(summary.projectedVsAllocatedCents).toBe(-205000);
    expect(summary.incomeAllocatedCents).toBe(1200000);
    expect(summary.projectedVsIncomeCents).toBe(155000);
  });

  it('names at most three categories, biggest overshoot first', () => {
    const summary = summarisePeriodForecast(forecasts, 0);
    expect(summary.atRisk).toHaveLength(MAX_AT_RISK_CATEGORIES);
    expect(summary.atRisk.map((f) => f.envelopeName)).toEqual(['Transport', 'Food', 'Giving']);
  });

  it('has nothing at risk when every category fits its allocation', () => {
    const summary = summarisePeriodForecast(
      [forecast({ allocatedCents: 150000, projectedTotalSpendCents: 130000 })],
      0,
    );
    expect(summary.atRisk).toEqual([]);
  });
});

describe('buildPeriodSummaryCopy', () => {
  it('spells out an overrun in cash', () => {
    const copy = buildPeriodSummaryCopy(
      summarisePeriodForecast(
        [
          forecast({
            envelopeName: 'Food',
            allocatedCents: 150000,
            projectedTotalSpendCents: 190000,
          }),
        ],
        0,
      ),
      format,
    );
    expect(copy.headline).toContain('R400.00 more than budgeted');
    expect(copy.atRisk).toBe('Most likely to overshoot: Food (R400.00 over).');
  });

  it('spells out the slack when the budget covers the projection', () => {
    const copy = buildPeriodSummaryCopy(
      summarisePeriodForecast(
        [forecast({ allocatedCents: 150000, projectedTotalSpendCents: 130000 })],
        0,
      ),
      format,
    );
    expect(copy.headline).toContain('R200.00 to spare');
    expect(copy.atRisk).toBeNull();
  });
});

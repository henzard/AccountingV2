import { buildHabitScoreInput } from '../buildHabitScoreInput';
import { HabitScoreCalculator } from '../RamseyScoreCalculator';

/**
 * Table-driven parity check for the assembly extracted from
 * `DashboardScreen`'s old inline block (VAL-14/DOM-13):
 *
 *   const envelopesOnBudget = budgetSpendEnvelopes.filter(
 *     (e) => e.spentCents <= e.allocatedCents,
 *   ).length;
 *   const scoreResult = scoreCalculator.calculate({
 *     loggingDaysCount, totalDaysInPeriod, envelopesOnBudget,
 *     totalEnvelopes: budgetSpendEnvelopes.length,
 *     meterReadingsLoggedThisPeriod, babyStepIsActive,
 *   });
 *
 * Each case recomputes that exact old logic independently and asserts
 * `buildHabitScoreInput` + `HabitScoreCalculator.calculate` produce the
 * identical `HabitScoreResult` — proving the refactor changed nothing about
 * the dashboard's displayed score.
 */
describe("buildHabitScoreInput — parity with DashboardScreen's old inline assembly", () => {
  const calculator = new HabitScoreCalculator();

  function oldInlineCalculate(params: {
    loggingDaysCount: number;
    totalDaysInPeriod: number;
    envelopes: { spentCents: number; allocatedCents: number }[];
    meterReadingsLoggedThisPeriod: boolean;
    babyStepIsActive: boolean;
  }) {
    const envelopesOnBudget = params.envelopes.filter(
      (e) => e.spentCents <= e.allocatedCents,
    ).length;
    return calculator.calculate({
      loggingDaysCount: params.loggingDaysCount,
      totalDaysInPeriod: params.totalDaysInPeriod,
      envelopesOnBudget,
      totalEnvelopes: params.envelopes.length,
      meterReadingsLoggedThisPeriod: params.meterReadingsLoggedThisPeriod,
      babyStepIsActive: params.babyStepIsActive,
    });
  }

  const cases: {
    name: string;
    loggingDaysCount: number;
    totalDaysInPeriod: number;
    envelopes: { spentCents: number; allocatedCents: number }[];
    meterReadingsLoggedThisPeriod: boolean;
    babyStepIsActive: boolean;
  }[] = [
    {
      name: 'no envelopes, nothing logged',
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopes: [],
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    },
    {
      name: 'all envelopes on budget, everything logged',
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopes: [
        { spentCents: 1000, allocatedCents: 1000 },
        { spentCents: 500, allocatedCents: 1000 },
      ],
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    },
    {
      name: 'a mix of over- and on-budget envelopes',
      loggingDaysCount: 12,
      totalDaysInPeriod: 30,
      envelopes: [
        { spentCents: 6000, allocatedCents: 5000 }, // over
        { spentCents: 1000, allocatedCents: 2000 }, // on budget
        { spentCents: 2000, allocatedCents: 2000 }, // exactly on budget
      ],
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: true,
    },
    {
      name: 'every envelope over budget',
      loggingDaysCount: 5,
      totalDaysInPeriod: 15,
      envelopes: [
        { spentCents: 9000, allocatedCents: 5000 },
        { spentCents: 3000, allocatedCents: 1000 },
      ],
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: false,
    },
  ];

  it.each(cases)('$name', (params) => {
    const expected = oldInlineCalculate(params);
    const actual = calculator.calculate(buildHabitScoreInput(params));
    expect(actual).toEqual(expected);
  });

  it('computes envelopesOnBudget/totalEnvelopes the same way the old inline code did', () => {
    const input = buildHabitScoreInput({
      loggingDaysCount: 10,
      totalDaysInPeriod: 20,
      envelopes: [
        { spentCents: 100, allocatedCents: 100 },
        { spentCents: 101, allocatedCents: 100 },
        { spentCents: 50, allocatedCents: 100 },
      ],
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });

    expect(input.envelopesOnBudget).toBe(2);
    expect(input.totalEnvelopes).toBe(3);
  });
});

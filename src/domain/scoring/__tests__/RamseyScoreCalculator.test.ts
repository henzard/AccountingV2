import { HabitScoreCalculator } from '../RamseyScoreCalculator';

describe('HabitScoreCalculator', () => {
  const calc = new HabitScoreCalculator();

  it('returns 100 for perfect inputs', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 5,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBe(100);
    expect(result.loggingPoints).toBe(30);
    expect(result.disciplinePoints).toBe(30);
    expect(result.metersPoints).toBe(20);
    expect(result.babyStepPoints).toBe(20);
  });

  it('returns 0 for all-zero inputs', () => {
    const result = calc.calculate({
      loggingDaysCount: 0,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: false,
      babyStepIsActive: false,
    });
    expect(result.score).toBe(0);
  });

  it('calculates logging points proportionally', () => {
    const result = calc.calculate({
      loggingDaysCount: 15,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 5,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.loggingPoints).toBe(15); // 50% of 30
    expect(result.score).toBe(85);
  });

  it('calculates discipline points proportionally', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 2,
      totalEnvelopes: 4,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.disciplinePoints).toBe(15); // 50% of 30
    expect(result.score).toBe(85);
  });

  it('awards full discipline points when no envelopes exist', () => {
    const result = calc.calculate({
      loggingDaysCount: 30,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 0,
      totalEnvelopes: 0,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.disciplinePoints).toBe(30);
  });

  it('does not exceed 100', () => {
    const result = calc.calculate({
      loggingDaysCount: 100,
      totalDaysInPeriod: 30,
      envelopesOnBudget: 10,
      totalEnvelopes: 5,
      meterReadingsLoggedThisPeriod: true,
      babyStepIsActive: true,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  // ── Meters: excluded and re-normalised when the household never used it ──
  //
  // Meters are an all-or-nothing 20 of 100. For a household that has never
  // logged a reading (and may never — it is an optional feature), that is a
  // hard ceiling of 80 they cannot lift, which puts Lv1->Lv2 (three periods
  // at 70+) nearly out of reach and Lv2->Lv3 (85+) fully out of reach. The
  // component is therefore dropped and the remaining 80 re-normalised to 100.
  describe('metersApplicable: false', () => {
    it('re-normalises a perfect-but-for-meters period to a full 100', () => {
      const result = calc.calculate({
        loggingDaysCount: 30,
        totalDaysInPeriod: 30,
        envelopesOnBudget: 5,
        totalEnvelopes: 5,
        meterReadingsLoggedThisPeriod: false,
        babyStepIsActive: true,
        metersApplicable: false,
      });
      // (30 + 30 + 20) / 80 * 100 = 100 — the old formula capped this at 80.
      expect(result.score).toBe(100);
      expect(result.metersPoints).toBeNull();
      expect(result.metersApplicable).toBe(false);
    });

    it('scores a disciplined month with no baby step at 73, not 58', () => {
      // The REAL household's shape: nearly every day logged, every envelope
      // on budget, no completed baby step, no meter reading ever.
      const result = calc.calculate({
        loggingDaysCount: 28,
        totalDaysInPeriod: 30,
        envelopesOnBudget: 10,
        totalEnvelopes: 10,
        meterReadingsLoggedThisPeriod: false,
        babyStepIsActive: false,
        metersApplicable: false,
      });
      expect(result.loggingPoints).toBe(28);
      expect(result.disciplinePoints).toBe(30);
      // (28 + 30 + 0) / 80 * 100 = 72.5 -> 73. Under the old formula the
      // identical month scored 58 and could never reach the Lv2 bar of 70.
      expect(result.score).toBe(73);
    });

    it('still reflects a bad month — normalisation is not a free pass', () => {
      const result = calc.calculate({
        loggingDaysCount: 6,
        totalDaysInPeriod: 30,
        envelopesOnBudget: 4,
        totalEnvelopes: 10,
        meterReadingsLoggedThisPeriod: false,
        babyStepIsActive: false,
        metersApplicable: false,
      });
      // logging 6, discipline 12 -> 18/80 -> 23.
      expect(result.score).toBe(23);
    });

    it('a household that HAS used meters is scored on the full 100, exactly as before', () => {
      const applicable = calc.calculate({
        loggingDaysCount: 28,
        totalDaysInPeriod: 30,
        envelopesOnBudget: 10,
        totalEnvelopes: 10,
        meterReadingsLoggedThisPeriod: false,
        babyStepIsActive: false,
        metersApplicable: true,
      });
      expect(applicable.metersPoints).toBe(0);
      expect(applicable.metersApplicable).toBe(true);
      expect(applicable.score).toBe(58);

      const logged = calc.calculate({
        loggingDaysCount: 28,
        totalDaysInPeriod: 30,
        envelopesOnBudget: 10,
        totalEnvelopes: 10,
        meterReadingsLoggedThisPeriod: true,
        babyStepIsActive: false,
        metersApplicable: true,
      });
      expect(logged.metersPoints).toBe(20);
      expect(logged.score).toBe(78);
    });

    it('omitting metersApplicable means applicable — every existing caller is unchanged', () => {
      const result = calc.calculate({
        loggingDaysCount: 28,
        totalDaysInPeriod: 30,
        envelopesOnBudget: 10,
        totalEnvelopes: 10,
        meterReadingsLoggedThisPeriod: false,
        babyStepIsActive: false,
      });
      expect(result.score).toBe(58);
      expect(result.metersPoints).toBe(0);
      expect(result.metersApplicable).toBe(true);
    });
  });
});

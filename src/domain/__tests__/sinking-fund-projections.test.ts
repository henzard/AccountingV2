import {
  SinkingFundProjector,
  type SinkingFundProjectInput,
} from '../envelopes/SinkingFundProjector';

describe('Sinking Fund Projections', () => {
  const projector = new SinkingFundProjector();

  describe('Holiday fund: target R15,000 by Dec 2026, balance R3,000, month June', () => {
    it('calculates correct monthly contribution', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 300000, // R3,000
        targetAmountCents: 1500000, // R15,000
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);

      // shortfall = 1,500,000 - 300,000 = 1,200,000 cents
      // months remaining = differenceInMonths('2026-12-01', '2026-06-01') = 6
      // requiredMonthly = ceil(1,200,000 / 6) = 200,000 cents = R2,000/month
      expect(result.requiredMonthlyCents).toBe(200000);
      expect(result.monthsRemaining).toBe(6);
      expect(result.percentComplete).toBe(20); // 300000 / 1500000 * 100 = 20%
      expect(result.isOnTrack).toBe(false); // no currentMonthlyCents provided
    });

    it('is on track when current monthly meets required', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 300000,
        targetAmountCents: 1500000,
        targetDate: '2026-12-01',
        currentMonthlyCents: 200000,
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.isOnTrack).toBe(true);
    });

    it('is not on track when current monthly is below required', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 300000,
        targetAmountCents: 1500000,
        targetDate: '2026-12-01',
        currentMonthlyCents: 150000,
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.isOnTrack).toBe(false);
    });
  });

  describe('Target already met', () => {
    it('returns 100% complete, 0 required monthly', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 1500000,
        targetAmountCents: 1500000,
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(100);
      expect(result.requiredMonthlyCents).toBe(0);
      expect(result.isOnTrack).toBe(true);
    });

    it('handles over-saved scenario', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 2000000,
        targetAmountCents: 1500000,
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(100); // capped at 100
      expect(result.requiredMonthlyCents).toBe(0);
      expect(result.isOnTrack).toBe(true);
    });
  });

  describe('Target date in past', () => {
    it('returns 0 months remaining and full shortfall as required monthly', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 300000,
        targetAmountCents: 1500000,
        targetDate: '2026-01-01',
        today: new Date('2026-06-15'),
      };
      const result = projector.project(input);
      expect(result.monthsRemaining).toBe(0);
      // requiredMonthlyCents = shortfall (entire amount needed now)
      expect(result.requiredMonthlyCents).toBe(1200000);
      expect(result.isOnTrack).toBe(false);
    });

    it('target met even if date passed', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 1500000,
        targetAmountCents: 1500000,
        targetDate: '2025-12-01',
        today: new Date('2026-06-15'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(100);
      expect(result.requiredMonthlyCents).toBe(0);
      expect(result.isOnTrack).toBe(true);
    });
  });

  describe('Zero balance, far target', () => {
    it('calculates required monthly from scratch', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 0,
        targetAmountCents: 1500000,
        targetDate: '2027-06-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      // 12 months, shortfall = 1,500,000
      // requiredMonthly = ceil(1,500,000 / 12) = 125,000
      expect(result.monthsRemaining).toBe(12);
      expect(result.requiredMonthlyCents).toBe(125000);
      expect(result.percentComplete).toBe(0);
    });

    it('large target over many months', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 0,
        targetAmountCents: 50000000, // R500,000
        targetDate: '2030-06-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      // 48 months
      expect(result.monthsRemaining).toBe(48);
      expect(result.requiredMonthlyCents).toBe(Math.ceil(50000000 / 48));
    });
  });

  describe('allocatedCents = 0 (targetAmountCents = 0) -> no divide-by-zero', () => {
    it('returns 100% complete for zero target', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 0,
        targetAmountCents: 0,
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(100);
      expect(result.requiredMonthlyCents).toBe(0);
      expect(result.isOnTrack).toBe(true);
    });

    it('returns 100% complete for zero target with saved amount', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 50000,
        targetAmountCents: 0,
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(100);
    });
  });

  describe('sub-month gap handling', () => {
    it('ensures at least 1 month when target is in the future', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 0,
        targetAmountCents: 100000,
        targetDate: '2026-06-20',
        today: new Date('2026-06-15'),
      };
      const result = projector.project(input);
      expect(result.monthsRemaining).toBe(1);
      expect(result.requiredMonthlyCents).toBe(100000);
    });
  });

  describe('percentComplete rounding', () => {
    it('rounds to nearest integer', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 333333,
        targetAmountCents: 1000000,
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(33); // 33.3333 -> 33
    });

    it('never exceeds 100%', () => {
      const input: SinkingFundProjectInput = {
        savedCents: 1500000,
        targetAmountCents: 1000000,
        targetDate: '2026-12-01',
        today: new Date('2026-06-01'),
      };
      const result = projector.project(input);
      expect(result.percentComplete).toBe(100);
    });
  });
});

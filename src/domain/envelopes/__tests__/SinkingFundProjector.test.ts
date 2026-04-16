import { SinkingFundProjector } from '../SinkingFundProjector';

const TODAY = new Date('2026-04-16');

describe('SinkingFundProjector', () => {
  const projector = new SinkingFundProjector();

  it('returns monthsRemaining = 0 when target date is in the past', () => {
    const result = projector.project({
      savedCents: 5000_00,
      targetAmountCents: 10000_00,
      targetDate: '2025-01-01',
      today: TODAY,
    });
    expect(result.monthsRemaining).toBe(0);
  });

  it('calculates correct monthly top-up for future target', () => {
    const targetDate = '2027-02-16';
    const result = projector.project({
      savedCents: 2000_00,
      targetAmountCents: 12000_00,
      targetDate,
      today: TODAY,
    });
    expect(result.requiredMonthlyCents).toBe(1000_00);
    expect(result.monthsRemaining).toBe(10);
    expect(result.isOnTrack).toBe(false);
  });

  it('isOnTrack = true when currentMonthlyCents >= requiredMonthlyCents', () => {
    const targetDate = '2027-02-16';
    const result = projector.project({
      savedCents: 2000_00,
      targetAmountCents: 12000_00,
      targetDate,
      currentMonthlyCents: 1000_00,
      today: TODAY,
    });
    expect(result.isOnTrack).toBe(true);
  });

  it('returns percentComplete as integer 0-100', () => {
    const result = projector.project({
      savedCents: 5000_00,
      targetAmountCents: 10000_00,
      targetDate: '2027-04-16',
      today: TODAY,
    });
    expect(result.percentComplete).toBe(50);
  });

  it('clamps percentComplete to 100 when saved >= target', () => {
    const result = projector.project({
      savedCents: 12000_00,
      targetAmountCents: 10000_00,
      targetDate: '2027-04-16',
      today: TODAY,
    });
    expect(result.percentComplete).toBe(100);
    expect(result.requiredMonthlyCents).toBe(0);
  });

  it('requiredMonthlyCents = 0 when already at target', () => {
    const result = projector.project({
      savedCents: 10000_00,
      targetAmountCents: 10000_00,
      targetDate: '2027-04-16',
      today: TODAY,
    });
    expect(result.requiredMonthlyCents).toBe(0);
  });

  it('isOnTrack = false when overdue with remaining shortfall', () => {
    // Target was in the past, but savings < target → impossible to meet on schedule
    const result = projector.project({
      savedCents: 5000_00,
      targetAmountCents: 10000_00,
      targetDate: '2025-01-01', // past
      today: TODAY,
    });
    expect(result.monthsRemaining).toBe(0);
    expect(result.isOnTrack).toBe(false);
    // requiredMonthlyCents equals full shortfall (signal that goal is overdue)
    expect(result.requiredMonthlyCents).toBe(5000_00);
  });

  it('uses at least 1 month when target is within current month but still future', () => {
    // Target is tomorrow — differenceInMonths would return 0, but we have time left
    const tomorrow = new Date('2026-04-17');
    const result = projector.project({
      savedCents: 0,
      targetAmountCents: 500_00,
      targetDate: '2026-04-17',
      today: TODAY,
    });
    // hasTimeLeft → monthsRemaining ≥ 1, so requiredMonthlyCents should be 500_00
    expect(result.monthsRemaining).toBeGreaterThanOrEqual(1);
    expect(result.isOnTrack).toBe(false);
    void tomorrow; // keep reference
  });
});

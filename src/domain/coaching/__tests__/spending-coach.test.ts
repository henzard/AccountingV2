import { SpendingCoach } from '../SpendingCoach';

describe('SpendingCoach', () => {
  const coach = new SpendingCoach();

  it('returns null when projected spend is under allocated', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      allocatedCents: 50000,
      spentCents: 30000,
    });
    expect(result).toBeNull();
  });

  it('returns null when projected spend exactly equals allocated', () => {
    const result = coach.evaluate({
      amountCents: 10000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    expect(result).toBeNull();
  });

  it('returns coaching message when projected spend exceeds allocated', () => {
    const result = coach.evaluate({
      amountCents: 20000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    expect(result).not.toBeNull();
    expect(result!.message).toBeTruthy();
    expect(result!.overspendCents).toBe(10000);
  });

  it('calculates correct overspend amount', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      allocatedCents: 10000,
      spentCents: 8000,
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(3000);
  });

  it('returns message when allocatedCents is 0 and spending any amount', () => {
    const result = coach.evaluate({
      amountCents: 100,
      allocatedCents: 0,
      spentCents: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(100);
  });

  it('returns message when already over budget before this transaction', () => {
    const result = coach.evaluate({
      amountCents: 1000,
      allocatedCents: 50000,
      spentCents: 55000,
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(6000);
  });

  it('returns messages from a known set', () => {
    const messages = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = coach.evaluate({ amountCents: 20000, allocatedCents: 10000, spentCents: 0 });
      if (r) messages.add(r.message);
    }
    expect(messages.size).toBeGreaterThanOrEqual(2);
  });
});

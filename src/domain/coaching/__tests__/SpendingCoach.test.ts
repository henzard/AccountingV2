import { SpendingCoach } from '../SpendingCoach';

describe('SpendingCoach', () => {
  const coach = new SpendingCoach();

  it('returns null when transaction keeps envelope on budget', () => {
    const result = coach.evaluate({
      amountCents: 5000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    // 40000 + 5000 = 45000 ≤ 50000 → no warning
    expect(result).toBeNull();
  });

  it('returns a coaching message when transaction would overspend', () => {
    const result = coach.evaluate({
      amountCents: 20000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    // 40000 + 20000 = 60000 > 50000 → warning
    expect(result).not.toBeNull();
    expect(result!.message).toBeTruthy();
    expect(result!.overspendCents).toBe(10000);
  });

  it('returns a message when envelope is already over budget', () => {
    const result = coach.evaluate({
      amountCents: 1000,
      allocatedCents: 50000,
      spentCents: 51000,
    });
    expect(result).not.toBeNull();
    expect(result!.overspendCents).toBe(2000);
  });

  it('returns null when amount exactly meets remaining budget', () => {
    const result = coach.evaluate({
      amountCents: 10000,
      allocatedCents: 50000,
      spentCents: 40000,
    });
    expect(result).toBeNull();
  });

  it('returns different messages to avoid repetition', () => {
    const messages = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = coach.evaluate({ amountCents: 20000, allocatedCents: 50000, spentCents: 40000 });
      if (r) messages.add(r.message);
    }
    // At least 2 distinct messages in 20 calls
    expect(messages.size).toBeGreaterThanOrEqual(2);
  });
});

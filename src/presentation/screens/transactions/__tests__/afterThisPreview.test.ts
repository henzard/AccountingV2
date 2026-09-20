import { computeAfterThisPreview } from '../afterThisPreview';
import { formatCurrency } from '../../../utils/currency';

describe('computeAfterThisPreview', () => {
  it('period scope: shows remaining left and a per-day rate for the rest of the period', () => {
    const result = computeAfterThisPreview({
      scope: 'period',
      envelopeName: 'Groceries',
      amountCents: 2000,
      remainingBeforeCents: 10000,
      savedBeforeCents: 0,
      daysRemaining: 10,
    });
    // 10000 - 2000 = 8000 remaining; 8000 / 10 = 800/day
    expect(result.text).toBe(
      `After this: ${formatCurrency(8000)} left in Groceries · about ${formatCurrency(800)}/day for 10 days`,
    );
    expect(result.isNegative).toBe(false);
  });

  it('period scope: turns negative when the amount exceeds what remains', () => {
    const result = computeAfterThisPreview({
      scope: 'period',
      envelopeName: 'Groceries',
      amountCents: 15000,
      remainingBeforeCents: 10000,
      savedBeforeCents: 0,
      daysRemaining: 5,
    });
    expect(result.isNegative).toBe(true);
    expect(result.text).toContain(formatCurrency(-5000));
  });

  it('period scope: clamps the per-day divisor to at least 1 day', () => {
    const result = computeAfterThisPreview({
      scope: 'period',
      envelopeName: 'Groceries',
      amountCents: 1000,
      remainingBeforeCents: 5000,
      savedBeforeCents: 0,
      daysRemaining: 0,
    });
    expect(result.text).toContain('for 1 day');
    expect(result.text).not.toContain('for 1 days');
  });

  it('persistent scope (fund): shows saved balance, no days/per-day text', () => {
    const result = computeAfterThisPreview({
      scope: 'persistent',
      envelopeName: 'Holiday fund',
      amountCents: 200000,
      remainingBeforeCents: 0,
      savedBeforeCents: 600000,
      daysRemaining: 10,
    });
    expect(result.text).toBe(`After this: ${formatCurrency(400000)} saved in Holiday fund`);
    expect(result.text).not.toContain('/day');
    expect(result.isNegative).toBe(false);
  });

  it('persistent scope (fund): turns negative when the spend exceeds what is saved', () => {
    const result = computeAfterThisPreview({
      scope: 'persistent',
      envelopeName: 'Holiday fund',
      amountCents: 700000,
      remainingBeforeCents: 0,
      savedBeforeCents: 600000,
      daysRemaining: 10,
    });
    expect(result.isNegative).toBe(true);
    expect(result.text).toContain(formatCurrency(-100000));
  });
});

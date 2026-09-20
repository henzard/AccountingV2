import { buildPeriodClosingMessage, buildWeeklyCheckInMessage } from '../budgetNudgeMessages';
import type { PeriodEnvelopeSnapshot } from '../budgetNudgeMessages';

describe('buildPeriodClosingMessage (VAL2-11)', () => {
  it('sums unspent allocation across every envelope and pluralizes the count', () => {
    const envelopes: PeriodEnvelopeSnapshot[] = [
      { allocatedCents: 50000, spentCents: 20000 }, // 30000 left
      { allocatedCents: 30000, spentCents: 10000 }, // 20000 left
    ];
    const message = buildPeriodClosingMessage(envelopes);
    expect(message.title).toBe('3 days to payday');
    expect(message.body).toBe('R500,00 left across 2 envelopes');
  });

  it('uses singular "envelope" for exactly one', () => {
    const message = buildPeriodClosingMessage([{ allocatedCents: 10000, spentCents: 0 }]);
    expect(message.body).toBe('R100,00 left across 1 envelope');
  });

  it('clamps a negative (over budget) envelope balance to zero rather than subtracting from the total', () => {
    const envelopes: PeriodEnvelopeSnapshot[] = [
      { allocatedCents: 10000, spentCents: 15000 }, // over budget -> contributes 0, not -5000
      { allocatedCents: 10000, spentCents: 0 }, // 10000 left
    ];
    const message = buildPeriodClosingMessage(envelopes);
    expect(message.body).toBe('R100,00 left across 2 envelopes');
  });

  it('handles zero envelopes without dividing by zero or crashing', () => {
    const message = buildPeriodClosingMessage([]);
    expect(message.body).toBe('R0,00 left across 0 envelopes');
  });
});

describe('buildWeeklyCheckInMessage (VAL2-11)', () => {
  it('reports the given week spend and counts envelopes within their allocation as "on track"', () => {
    const envelopes: PeriodEnvelopeSnapshot[] = [
      { allocatedCents: 50000, spentCents: 20000 }, // on track
      { allocatedCents: 30000, spentCents: 30000 }, // exactly at allocation -> still on track
      { allocatedCents: 20000, spentCents: 25000 }, // over -> not on track
    ];
    const message = buildWeeklyCheckInMessage(envelopes, 15000);
    expect(message.title).toBe('Your week in envelopes');
    expect(message.body).toBe('This week: R150,00 spent, 2 envelopes on track');
  });

  it('uses singular "envelope" for exactly one on-track envelope', () => {
    const message = buildWeeklyCheckInMessage([{ allocatedCents: 10000, spentCents: 0 }], 0);
    expect(message.body).toBe('This week: R0,00 spent, 1 envelope on track');
  });

  it('handles zero envelopes without crashing', () => {
    const message = buildWeeklyCheckInMessage([], 5000);
    expect(message.body).toBe('This week: R50,00 spent, 0 envelopes on track');
  });
});

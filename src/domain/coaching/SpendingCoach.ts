import type { EnvelopeScope } from '../envelopes/EnvelopeEntity';

export interface CoachingResult {
  message: string;
  overspendCents: number;
  /**
   * REG-8/VAL2-2: which balance `overspendCents` is measured against —
   * 'period' means the envelope's remaining monthly budget, 'persistent'
   * means a fund's saved balance. Presentation uses this to avoid ever
   * calling a fund "over budget" (persistent envelopes don't have one).
   */
  scope: EnvelopeScope;
}

export interface CoachingInput {
  amountCents: number;
  /**
   * The balance available to spend from BEFORE this transaction: the
   * envelope's remaining monthly budget (`allocatedCents - spentCents`) for
   * a 'period' envelope, or its saved balance
   * (`getPersistentEnvelopeSavedCents`) for a 'persistent' one. Never
   * `allocatedCents` alone for a persistent envelope — that is its monthly
   * CONTRIBUTION, not a balance (REG-8/VAL2-2).
   */
  availableCents: number;
  scope: EnvelopeScope;
}

// Dave Ramsey-style coaching messages, rotated randomly to avoid repetition.
const MESSAGES = [
  "You don't need it if you can't afford it. The envelope is empty for a reason.",
  'Every rand over budget is a rand stolen from your future self.',
  'Gazelle intensity means saying no to today so you can say yes to tomorrow.',
  'This spend will put you over budget. Is it an emergency? If not, wait.',
  "The envelope has spoken. Stick to the plan — it's working.",
  'Living like no one else now means you can live like no one else later.',
  'Your budget is a promise to yourself. Keep it.',
  'Short-term sacrifice. Long-term freedom. Skip this one.',
];

// Fund-specific messages: a persistent envelope isn't "over budget" — it
// simply doesn't have that much saved yet.
const FUND_MESSAGES = [
  "This fund hasn't saved that much yet. Give it more time before you dip in.",
  'Raiding the fund before it grows defeats the point of having one.',
  "The fund isn't there yet. Every rand you leave in it now is a rand you won't have to borrow later.",
  'A fund exists to be ready when you need it — spending ahead of what it holds empties it before that day comes.',
];

export class SpendingCoach {
  evaluate(input: CoachingInput): CoachingResult | null {
    const projectedBalance = input.availableCents - input.amountCents;
    if (projectedBalance >= 0) return null;

    const overspendCents = -projectedBalance;
    const pool = input.scope === 'persistent' ? FUND_MESSAGES : MESSAGES;
    const message = pool[Math.floor(Math.random() * pool.length)] ?? 'Stick to your budget.';
    return { message, overspendCents, scope: input.scope };
  }
}

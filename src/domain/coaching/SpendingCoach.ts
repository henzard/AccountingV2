export interface CoachingResult {
  message: string;
  overspendCents: number;
}

export interface CoachingInput {
  amountCents: number;
  allocatedCents: number;
  spentCents: number;
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

export class SpendingCoach {
  evaluate(input: CoachingInput): CoachingResult | null {
    const projectedSpend = input.spentCents + input.amountCents;
    if (projectedSpend <= input.allocatedCents) return null;

    const overspendCents = projectedSpend - input.allocatedCents;
    const message =
      MESSAGES[Math.floor(Math.random() * MESSAGES.length)] ?? 'Stick to your budget.';
    return { message, overspendCents };
  }
}

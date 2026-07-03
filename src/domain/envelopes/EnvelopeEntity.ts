export type EnvelopeType =
  | 'spending'
  | 'savings'
  | 'emergency_fund'
  | 'baby_step'
  | 'utility'
  | 'income'
  | 'sinking_fund';

export interface EnvelopeEntity {
  id: string;
  householdId: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
  envelopeType: EnvelopeType;
  isSavingsLocked: boolean;
  isArchived: boolean;
  periodStart: string; // ISO date YYYY-MM-DD
  targetAmountCents: number | null;
  targetDate: string | null; // ISO date YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
}

export function getRemainingCents(envelope: EnvelopeEntity): number {
  return envelope.allocatedCents - envelope.spentCents;
}

export function getPercentRemaining(envelope: EnvelopeEntity): number {
  if (envelope.allocatedCents === 0) return 100;
  const pct = ((envelope.allocatedCents - envelope.spentCents) / envelope.allocatedCents) * 100;
  return Math.max(0, Math.round(pct));
}

export function isOverBudget(envelope: EnvelopeEntity): boolean {
  return envelope.spentCents > envelope.allocatedCents;
}

/**
 * Scope of an envelope's balance, per the derived-balance read model
 * (`EnvelopeBalanceQuery`):
 *  - 'period': re-created per budget period ('spending' | 'income' |
 *    'utility'); the envelope row's `id` is already period-specific.
 *  - 'persistent': keeps the same row across periods ('sinking_fund' |
 *    'emergency_fund' | 'savings' | 'baby_step'); its balance is an
 *    all-time total.
 */
export type EnvelopeScope = 'period' | 'persistent';

const PERSISTENT_ENVELOPE_TYPES: ReadonlySet<EnvelopeType> = new Set([
  'sinking_fund',
  'emergency_fund',
  'savings',
  'baby_step',
]);

export function getEnvelopeScope(envelope: Pick<EnvelopeEntity, 'envelopeType'>): EnvelopeScope {
  return PERSISTENT_ENVELOPE_TYPES.has(envelope.envelopeType) ? 'persistent' : 'period';
}

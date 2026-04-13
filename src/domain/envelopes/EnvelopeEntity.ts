export type EnvelopeType =
  | 'spending'
  | 'savings'
  | 'emergency_fund'
  | 'baby_step'
  | 'utility'
  | 'income';

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

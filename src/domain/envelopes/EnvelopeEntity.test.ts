import {
  getRemainingCents,
  getPercentRemaining,
  isOverBudget,
} from './EnvelopeEntity';
import type { EnvelopeEntity } from './EnvelopeEntity';

const makeEnvelope = (allocated: number, spent: number): EnvelopeEntity => ({
  id: 'e1',
  householdId: 'hh1',
  name: 'Groceries',
  allocatedCents: allocated,
  spentCents: spent,
  envelopeType: 'spending',
  isSavingsLocked: false,
  isArchived: false,
  periodStart: '2026-03-25',
  createdAt: '2026-03-25T00:00:00.000Z',
  updatedAt: '2026-03-25T00:00:00.000Z',
});

describe('EnvelopeEntity pure functions', () => {
  describe('getRemainingCents', () => {
    it('returns allocated minus spent', () => {
      expect(getRemainingCents(makeEnvelope(200000, 75000))).toBe(125000);
    });
    it('returns negative when over budget', () => {
      expect(getRemainingCents(makeEnvelope(100000, 120000))).toBe(-20000);
    });
  });

  describe('getPercentRemaining', () => {
    it('returns 100 when nothing spent', () => {
      expect(getPercentRemaining(makeEnvelope(200000, 0))).toBe(100);
    });
    it('returns 50 when half spent', () => {
      expect(getPercentRemaining(makeEnvelope(200000, 100000))).toBe(50);
    });
    it('returns 0 when fully spent', () => {
      expect(getPercentRemaining(makeEnvelope(200000, 200000))).toBe(0);
    });
    it('returns 0 (not negative) when over budget', () => {
      expect(getPercentRemaining(makeEnvelope(100000, 120000))).toBe(0);
    });
    it('returns 100 when allocated is zero', () => {
      expect(getPercentRemaining(makeEnvelope(0, 0))).toBe(100);
    });
  });

  describe('isOverBudget', () => {
    it('returns false when under budget', () => {
      expect(isOverBudget(makeEnvelope(200000, 100000))).toBe(false);
    });
    it('returns true when over budget', () => {
      expect(isOverBudget(makeEnvelope(100000, 120000))).toBe(true);
    });
    it('returns false when exactly at budget', () => {
      expect(isOverBudget(makeEnvelope(100000, 100000))).toBe(false);
    });
  });
});

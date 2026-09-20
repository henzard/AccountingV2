import { parseISO } from 'date-fns';
import { CashFlowForecaster } from '../CashFlowForecaster';
import type { EnvelopeEntity } from '../../envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../../transactions/TransactionEntity';

function env(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Groceries',
    allocatedCents: 500000,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionEntity>): TransactionEntity {
  return {
    id: 'tx-1',
    householdId: 'hh-1',
    envelopeId: 'env-1',
    amountCents: 10000,
    payee: 'Shop',
    description: null,
    transactionDate: '2026-04-10',
    isBusinessExpense: false,
    spendingTriggerNote: null,
    slipId: null,
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
    ...overrides,
  };
}

describe('CashFlowForecaster', () => {
  const forecaster = new CashFlowForecaster();
  // Period: 1 Apr – 30 Apr (30 days). Today = 10 Apr (day 10). Days remaining = 20.
  // Use parseISO so today is local midnight, consistent with how start/end are parsed.
  const periodStart = '2026-04-01';
  const periodEnd = '2026-04-30';
  const today = parseISO('2026-04-10');

  it('returns empty array for empty envelopes', () => {
    const result = forecaster.project({
      envelopes: [],
      transactions: [],
      periodStart,
      periodEnd,
      today,
    });
    expect(result).toEqual([]);
  });

  it('skips income and archived envelopes', () => {
    const result = forecaster.project({
      envelopes: [env({ envelopeType: 'income' }), env({ isArchived: true })],
      transactions: [],
      periodStart,
      periodEnd,
      today,
    });
    expect(result).toHaveLength(0);
  });

  it('projects period-end balance with no spending as full allocation', () => {
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 0 })],
      transactions: [],
      periodStart,
      periodEnd,
      today,
    });
    expect(result).toHaveLength(1);
    expect(result[0].projectedRemainingCents).toBe(500000);
    expect(result[0].status).toBe('on_track');
  });

  it('calculates correct projected spend based on daily rate', () => {
    // Spent R1000 in 10 days = R100/day. 20 days left → R2000 more projected.
    // Allocated R5000 → projected remaining = 5000 - 1000 - 2000 = 2000
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 100000 })],
      // Four modest transactions: ongoing spending, so the daily rate IS
      // meaningful and gets extrapolated (see `isFixedCommitment`).
      transactions: [
        tx({ id: 'tx-1', amountCents: 25000, transactionDate: '2026-04-03' }),
        tx({ id: 'tx-2', amountCents: 25000, transactionDate: '2026-04-05' }),
        tx({ id: 'tx-3', amountCents: 25000, transactionDate: '2026-04-07' }),
        tx({ id: 'tx-4', amountCents: 25000, transactionDate: '2026-04-09' }),
      ],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].isFixed).toBe(false);
    expect(result[0].dailySpendCents).toBe(10000); // 100000 / 10 days
    expect(result[0].projectedSpendRemainingCents).toBe(200000); // 10000 * 20
    expect(result[0].projectedRemainingCents).toBe(200000); // 500000 - 100000 - 200000
    expect(result[0].status).toBe('on_track');
  });

  it('marks status as over_budget when projected remaining is negative', () => {
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 350000 })],
      transactions: [
        tx({ id: 'tx-1', amountCents: 70000, transactionDate: '2026-04-02' }),
        tx({ id: 'tx-2', amountCents: 70000, transactionDate: '2026-04-04' }),
        tx({ id: 'tx-3', amountCents: 70000, transactionDate: '2026-04-06' }),
        tx({ id: 'tx-4', amountCents: 70000, transactionDate: '2026-04-08' }),
        tx({ id: 'tx-5', amountCents: 70000, transactionDate: '2026-04-10' }),
      ],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].status).toBe('over_budget');
  });

  it('marks status as warning when projected remaining is 10-20% of allocation', () => {
    // allocated = 100000, projectedRemaining = 12000 (12%) → warning
    // 12000 = 100000 - spent - (spent/10 * 20) → spent ≈ 29333
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 100000, spentCents: 29333 })],
      transactions: [
        tx({ id: 'tx-1', amountCents: 9778, transactionDate: '2026-04-04' }),
        tx({ id: 'tx-2', amountCents: 9778, transactionDate: '2026-04-06' }),
        tx({ id: 'tx-3', amountCents: 9777, transactionDate: '2026-04-08' }),
      ],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].status).toBe('warning');
  });

  // ─── Fixed commitments (DOM-7/VAL-7) ──────────────────────────────────────
  describe('fixed commitments are not extrapolated', () => {
    it('does not project another month of rent from a single day-1 debit order', () => {
      // R12,000 rent out of a R15,000 allocation, paid once on 1 Apr. The old
      // maths read that as R12,000/day and projected a further R240,000,
      // reporting a perfectly healthy budget as catastrophically over.
      const result = forecaster.project({
        envelopes: [
          env({ id: 'env-rent', name: 'Rent', allocatedCents: 1_500_000, spentCents: 1_200_000 }),
        ],
        transactions: [
          tx({
            id: 'tx-rent',
            envelopeId: 'env-rent',
            amountCents: 1_200_000,
            transactionDate: '2026-04-01',
          }),
        ],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].isFixed).toBe(true);
      expect(result[0].projectedSpendRemainingCents).toBe(0);
      expect(result[0].projectedRemainingCents).toBe(300_000);
      expect(result[0].status).toBe('on_track');
    });

    it('treats one dominant transaction as fixed even with small extras alongside it', () => {
      // Four transactions, so the "at most two" rule does not apply — but one
      // of them is 80% of the allocation, so the envelope's purpose has
      // already been paid.
      const result = forecaster.project({
        envelopes: [
          env({
            id: 'env-school',
            name: 'School Fees',
            allocatedCents: 1_000_000,
            spentCents: 830_000,
          }),
        ],
        transactions: [
          tx({ id: 'tx-1', envelopeId: 'env-school', amountCents: 800_000 }),
          tx({ id: 'tx-2', envelopeId: 'env-school', amountCents: 10_000 }),
          tx({ id: 'tx-3', envelopeId: 'env-school', amountCents: 10_000 }),
          tx({ id: 'tx-4', envelopeId: 'env-school', amountCents: 10_000 }),
        ],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].isFixed).toBe(true);
      expect(result[0].projectedSpendRemainingCents).toBe(0);
    });

    it('still extrapolates when transactions are not supplied at all', () => {
      const result = forecaster.project({
        envelopes: [env({ allocatedCents: 500000, spentCents: 100000 })],
        periodStart,
        periodEnd,
        today,
      });
      expect(result[0].isFixed).toBe(false);
      expect(result[0].projectedSpendRemainingCents).toBe(200000);
    });
  });
});

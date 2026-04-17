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
  const periodStart = '2026-04-01';
  const periodEnd = '2026-04-30';
  const today = new Date('2026-04-10');

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
      transactions: [
        tx({ amountCents: 50000, transactionDate: '2026-04-05' }),
        tx({ amountCents: 50000, transactionDate: '2026-04-09' }),
      ],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].dailySpendCents).toBe(10000); // 100000 / 10 days
    expect(result[0].projectedSpendRemainingCents).toBe(200000); // 10000 * 20
    expect(result[0].projectedRemainingCents).toBe(200000); // 500000 - 100000 - 200000
    expect(result[0].status).toBe('on_track');
  });

  it('marks status as over_budget when projected remaining is negative', () => {
    const result = forecaster.project({
      envelopes: [env({ allocatedCents: 500000, spentCents: 350000 })],
      transactions: [tx({ amountCents: 350000, transactionDate: '2026-04-05' })],
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
      transactions: [tx({ amountCents: 29333, transactionDate: '2026-04-05' })],
      periodStart,
      periodEnd,
      today,
    });
    expect(result[0].status).toBe('warning');
  });
});

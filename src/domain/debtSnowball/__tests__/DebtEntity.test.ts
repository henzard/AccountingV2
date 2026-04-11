import { getDebtTypeLabel, getPayoffProgressPercent } from '../DebtEntity';
import type { DebtEntity } from '../DebtEntity';

const base: DebtEntity = {
  id: 'd1',
  householdId: 'h1',
  creditorName: 'FNB Credit Card',
  debtType: 'credit_card',
  outstandingBalanceCents: 75000,
  initialBalanceCents: 100000,
  interestRatePercent: 22.5,
  minimumPaymentCents: 2500,
  sortOrder: 0,
  isPaidOff: false,
  totalPaidCents: 25000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  isSynced: false,
};

describe('DebtEntity', () => {
  it('getDebtTypeLabel returns human label for each type', () => {
    expect(getDebtTypeLabel('credit_card')).toBe('Credit Card');
    expect(getDebtTypeLabel('personal_loan')).toBe('Personal Loan');
    expect(getDebtTypeLabel('store_account')).toBe('Store Account');
    expect(getDebtTypeLabel('vehicle_finance')).toBe('Vehicle Finance');
    expect(getDebtTypeLabel('bond')).toBe('Home Bond');
  });

  it('getPayoffProgressPercent returns correct percentage', () => {
    // R250 paid of R1000 initial = 25%
    expect(getPayoffProgressPercent(base)).toBe(25);
  });

  it('getPayoffProgressPercent returns 100 when fully paid off', () => {
    const paid = { ...base, outstandingBalanceCents: 0, totalPaidCents: 100000, isPaidOff: true };
    expect(getPayoffProgressPercent(paid)).toBe(100);
  });

  it('getPayoffProgressPercent returns 0 when no payments made', () => {
    const fresh = { ...base, totalPaidCents: 0, outstandingBalanceCents: 100000 };
    expect(getPayoffProgressPercent(fresh)).toBe(0);
  });
});

export type DebtType =
  | 'credit_card'
  | 'personal_loan'
  | 'store_account'
  | 'vehicle_finance'
  | 'bond';

export interface DebtEntity {
  id: string;
  householdId: string;
  creditorName: string;
  debtType: DebtType;
  outstandingBalanceCents: number;
  initialBalanceCents: number;   // balance at creation — never changes
  interestRatePercent: number;
  minimumPaymentCents: number;
  sortOrder: number;             // 0 = smallest balance first (Ramsey default)
  isPaidOff: boolean;
  totalPaidCents: number;        // running total of all payments
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export function getDebtTypeLabel(debtType: DebtType): string {
  const labels: Record<DebtType, string> = {
    credit_card: 'Credit Card',
    personal_loan: 'Personal Loan',
    store_account: 'Store Account',
    vehicle_finance: 'Vehicle Finance',
    bond: 'Home Bond',
  };
  return labels[debtType];
}

/** Returns 0–100. Based on totalPaidCents / initialBalanceCents. */
export function getPayoffProgressPercent(debt: DebtEntity): number {
  if (debt.initialBalanceCents <= 0) return 0;
  return Math.min(100, Math.round((debt.totalPaidCents / debt.initialBalanceCents) * 100));
}

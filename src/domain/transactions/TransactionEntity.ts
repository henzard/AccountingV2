import { format, parseISO } from 'date-fns';

export interface TransactionEntity {
  id: string;
  householdId: string;
  envelopeId: string;
  amountCents: number;
  payee: string | null;
  description: string | null;
  transactionDate: string; // ISO date YYYY-MM-DD
  isBusinessExpense: boolean;
  spendingTriggerNote: string | null;
  slipId?: string | null; // nullable FK to slip_queue.id
  createdAt: string;
  updatedAt: string;
}

export function getTransactionDisplayDate(tx: TransactionEntity): string {
  return format(parseISO(tx.transactionDate), 'd MMM yyyy');
}

export function formatTransactionAmount(tx: TransactionEntity): number {
  return tx.amountCents;
}

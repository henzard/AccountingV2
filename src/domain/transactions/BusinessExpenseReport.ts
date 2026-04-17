import type { TransactionEntity } from './TransactionEntity';

export interface BusinessExpenseGroup {
  monthKey: string; // 'YYYY-MM'
  monthLabel: string; // 'March 2026'
  totalCents: number;
  transactions: TransactionEntity[];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function groupBusinessExpenses(transactions: TransactionEntity[]): BusinessExpenseGroup[] {
  const business = transactions.filter((t) => t.isBusinessExpense);

  const map = new Map<string, TransactionEntity[]>();
  for (const tx of business) {
    const monthKey = tx.transactionDate.slice(0, 7);
    const bucket = map.get(monthKey) ?? [];
    bucket.push(tx);
    map.set(monthKey, bucket);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, txs]) => {
      const [year, month] = monthKey.split('-');
      const monthLabel = `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
      const sorted = [...txs].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
      const totalCents = sorted.reduce((sum, t) => sum + t.amountCents, 0);
      return { monthKey, monthLabel, totalCents, transactions: sorted };
    });
}

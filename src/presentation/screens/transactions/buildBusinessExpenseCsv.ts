/**
 * buildBusinessExpenseCsv — CSV export for business expense report.
 *
 * Converts transaction rows to a CSV string with proper quoting and escaping,
 * CSV-injection guards, and sorted by date ascending.
 */

import type { TransactionEntity } from '../../../domain/transactions/TransactionEntity';

export interface BusinessExpenseRow {
  date: string; // ISO date YYYY-MM-DD
  payee: string | null;
  description: string | null;
  amountCents: number;
  envelopeName?: string | null;
}

/**
 * Escape a CSV field: quote with double quotes and double any inner quotes.
 * Prefix formula-like and control characters (=, +, -, @, tab, carriage return) with
 * a single quote inside the quotes to guard against CSV injection (OWASP guidance).
 */
function escapeCSVField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '""';
  }

  let str = String(value);

  // Check if string starts with formula-like characters or control chars
  // OWASP CSV injection guidance: =, +, -, @, tab, carriage return
  if (
    str[0] === '=' ||
    str[0] === '+' ||
    str[0] === '-' ||
    str[0] === '@' ||
    str[0] === '\t' ||
    str[0] === '\r'
  ) {
    str = `'${str}`;
  }

  // Double any inner quotes
  str = str.replace(/"/g, '""');

  // Wrap in quotes
  return `"${str}"`;
}

/**
 * Format amount in cents as a decimal with two places.
 */
function formatAmount(amountCents: number): string {
  const amount = amountCents / 100;
  return amount.toFixed(2);
}

/**
 * Build a CSV string from business expense rows.
 *
 * Columns: Date, Payee, Description, Amount (ZAR)
 * - Sorted by date ascending
 * - Total row at the end
 * - Line endings: \r\n
 */
export function buildBusinessExpenseCsv(rows: BusinessExpenseRow[]): string {
  const lines: string[] = [];

  // Header
  lines.push('Date,Payee,Description,Amount (ZAR)');

  // Sort by date ascending
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  // Data rows
  let totalCents = 0;
  for (const row of sorted) {
    const date = escapeCSVField(row.date);
    const payee = escapeCSVField(row.payee);
    const description = escapeCSVField(row.description);
    const amount = formatAmount(row.amountCents);

    lines.push(`${date},${payee},${description},"${amount}"`);
    totalCents += row.amountCents;
  }

  // Total row
  const totalAmount = formatAmount(totalCents);
  lines.push(`"","","Total","${totalAmount}"`);

  // Join with \r\n line endings
  return lines.join('\r\n');
}

/**
 * Convert a list of TransactionEntity objects to BusinessExpenseRow objects
 * suitable for CSV export.
 */
export function transactionsToCsvRows(transactions: TransactionEntity[]): BusinessExpenseRow[] {
  return transactions.map((tx) => ({
    date: tx.transactionDate,
    payee: tx.payee,
    description: tx.description || tx.spendingTriggerNote,
    amountCents: tx.amountCents,
  }));
}

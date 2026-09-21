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
 * Prefix formula-like and control characters (=, +, -, @, tab, carriage
 * return, line feed) with a single quote so spreadsheet apps treat the value as literal
 * text rather than executing it as a formula (OWASP CSV injection guidance).
 */
export function applyFormulaInjectionGuard(str: string): string {
  if (
    str[0] === '=' ||
    str[0] === '+' ||
    str[0] === '-' ||
    str[0] === '@' ||
    str[0] === '\t' ||
    str[0] === '\r' ||
    str[0] === '\n'
  ) {
    return `'${str}`;
  }
  return str;
}

/**
 * Escape a CSV field: quote with double quotes and double any inner quotes.
 * Runs every value through the formula-injection guard first.
 */
function escapeCSVField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '""';
  }

  let str = String(value);
  str = applyFormulaInjectionGuard(str);

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
 * Guards the Amount column against formula injection the same way text
 * fields are guarded, while keeping a legitimate negative amount a plain,
 * spreadsheet-parseable number.
 *
 * `amountStr` is always produced internally by `formatAmount` from a
 * `number` (`amountCents`), so it can only ever be `-?\d+\.\d\d` — there is
 * no path for attacker-controlled text to reach this field the way there is
 * for payee/description. OWASP's guidance to guard a leading '-' targets
 * free-text fields where a string like "-2+3+cmd|' /C calc'!A0" can smuggle
 * in a formula; a clean signed decimal like "-50.00" cannot. Running it
 * through the general text guard would prefix it with an apostrophe,
 * turning it into a text string in the spreadsheet and breaking totals/sums
 * for a household with a genuine negative (refunded) business expense — so
 * that one case is deliberately exempted here. Any other leading
 * formula-trigger character (=, +, @, tab, CR) — which should never occur
 * for a value formatted from a number, but would indicate something went
 * wrong upstream — is still guarded exactly like a text field, as defense
 * in depth.
 */
export function escapeAmountField(amountStr: string): string {
  const isPlainSignedNumber = /^-\d+\.\d{2}$/.test(amountStr);
  const guarded = isPlainSignedNumber ? amountStr : applyFormulaInjectionGuard(amountStr);
  return `"${guarded}"`;
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
    const amount = escapeAmountField(formatAmount(row.amountCents));

    lines.push(`${date},${payee},${description},${amount}`);
    totalCents += row.amountCents;
  }

  // Total row
  const totalAmount = escapeAmountField(formatAmount(totalCents));
  lines.push(`"","","Total",${totalAmount}`);

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

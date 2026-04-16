/**
 * Formats an integer cent value as a ZAR string, e.g. "R1 234,56".
 * Use this when a plain string is required (template literals, prop values).
 * For standalone currency display in JSX use <CurrencyText>.
 */
export function formatCurrency(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = (abs / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `-R${formatted}` : `R${formatted}`;
}

/**
 * Locale-safe money input parser (en-ZA / af-ZA).
 *
 * South African convention accepts both `.` and `,` as the DECIMAL separator
 * ("1,50" and "1.50" both mean one rand fifty). This parser never treats a
 * separator as a THOUSANDS separator — any input with more than one
 * separator, or a separator followed by more than two digits, is rejected
 * outright rather than guessed at. Silently coercing an ambiguous string
 * (e.g. "1,234.56" or "1 000") into a number is exactly the bug this module
 * exists to prevent: it can turn a valid amount into a wildly wrong one
 * while still reporting success.
 *
 * Grammar (input is trimmed first):
 *   money      := prefix? digits (separator digits{1,2})?
 *   prefix     := ("R" | "$") whitespace*
 *   separator  := "." | ","
 *   digits     := [0-9]+
 *
 * Rejected (never coerced):
 *   - empty / whitespace-only input
 *   - a leading "-" (negative amounts are not valid money input here)
 *   - more than one separator, or a separator with >2 trailing digits —
 *     this deliberately also rejects plain "1,234" style thousands
 *     groupings; there is no reliable way to distinguish
 *     "1,234" (thousands, invalid) from "1,234" being a 3-decimal amount
 *     (also invalid, decimals are capped at 2), so both readings reject.
 *   - any whitespace between digits (e.g. "1 000")
 *   - non-numeric input
 *   - a bare separator with no digits ("." or ",")
 *   - a whole part so long that the resulting cents value would exceed
 *     `Number.MAX_SAFE_INTEGER` — `parseInt(...) * 100` silently loses
 *     precision there, producing a wrong amount. Rejecting is the whole point
 *     of this module (a "silently wrong amount" is exactly what it prevents),
 *     so an over-cap number is refused rather than coerced.
 */

export type ParseMoneyResult = { ok: true; cents: number } | { ok: false; error: string };

const CURRENCY_PREFIX_RE = /^[R$]\s*/;
// Anchored, whole-string match: digits, optionally one separator followed by
// 1-2 digits. No whitespace or additional separators are permitted anywhere.
const MONEY_RE = /^\d+([.,]\d{1,2})?$/;

const ERR_EMPTY = 'Enter an amount';
const ERR_NEGATIVE = 'Amount cannot be negative';
const ERR_INVALID =
  'Enter a valid amount, e.g. 150.00 or 150,00 (no thousands separators or spaces)';
const ERR_TOO_LARGE = 'Amount is too large';

// Cap the whole-number part. 13 digits (up to 9,999,999,999,999.99) keeps the
// resulting cents value well inside Number.MAX_SAFE_INTEGER (~9.0e15); beyond
// this, `parseInt(wholePart, 10) * 100` starts losing integer precision.
const MAX_WHOLE_DIGITS = 13;

/**
 * Parses a raw money-entry string into integer cents.
 * Returns `{ ok: false, error }` for anything ambiguous or invalid instead
 * of coercing — callers must show the error inline and block the save.
 */
export function parseMoneyInput(raw: string): ParseMoneyResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: ERR_INVALID };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: ERR_EMPTY };
  }
  if (trimmed.startsWith('-')) {
    return { ok: false, error: ERR_NEGATIVE };
  }

  const body = trimmed.replace(CURRENCY_PREFIX_RE, '');
  if (body.length === 0) {
    return { ok: false, error: ERR_INVALID };
  }
  if (!MONEY_RE.test(body)) {
    return { ok: false, error: ERR_INVALID };
  }

  const [wholePart, fractionPartRaw] = body.split(/[.,]/);
  if (wholePart.length > MAX_WHOLE_DIGITS) {
    return { ok: false, error: ERR_TOO_LARGE };
  }
  const fractionPart = (fractionPartRaw ?? '').padEnd(2, '0');
  const cents = parseInt(wholePart, 10) * 100 + parseInt(fractionPart, 10);
  // Defence in depth: the digit-cap above is the primary guard, but reject any
  // value that still isn't an exact integer rather than return a wrong amount.
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: ERR_TOO_LARGE };
  }
  return { ok: true, cents };
}

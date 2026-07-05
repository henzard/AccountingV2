/**
 * Locale-safe money input parser (en-ZA / af-ZA).
 *
 * Accepts thousands separators (space, `.`, or `,`) AND both `.`/`,` as the
 * DECIMAL separator, because South African users type amounts many ways:
 * "1 500", "1,500", "1 500.00", "1 500,00", "1.500,00" (European), "1500.5".
 * The hard rule remains: never SILENTLY coerce an ambiguous string into a
 * wrong number — anything that isn't unambiguously a valid amount is rejected
 * with an inline error so the caller blocks the save.
 *
 * Disambiguation (the crux):
 *   - The DECIMAL separator is the LAST `.`/`,` that is immediately followed
 *     by exactly 1 or 2 digits at the end of the string. Everything before it
 *     is the integer section; those trailing digits are the fraction.
 *       "1 500,00" -> decimal ",", integer "1 500", fraction "00"  -> 150000c
 *       "1,234.56" -> decimal ".", integer "1,234", fraction "56"  -> 123456c
 *   - A separator followed by exactly 3 digits is a THOUSANDS grouping, not a
 *     decimal (a 3-digit fraction is invalid anyway):
 *       "1,000" -> 1000 ,  "1.000.000" -> 1000000
 *   - "1,50" / "1.50" -> 150 (comma OR period decimal, af-ZA + en-ZA).
 *
 * Integer-section grouping is VALIDATED: it must be either plain digits
 * ("1500") or valid 3-digit groups ("1 500", "1,234,567", "1.000.000").
 * Malformed grouping is REJECTED, not guessed — "1,00,000", "1 2 3", "12 34",
 * "1,2,3" all fail rather than silently producing a wrong amount.
 *
 * Rejected (never coerced): empty/whitespace-only; a leading "-"; a bare or
 * trailing-only separator; >2 decimal digits with a leading-digit decimal;
 * any non [0-9 . ,] character; malformed grouping; and a value so large the
 * resulting cents would exceed Number.MAX_SAFE_INTEGER.
 */

export type ParseMoneyResult = { ok: true; cents: number } | { ok: false; error: string };

const CURRENCY_PREFIX_RE = /^[R$]\s*/;
// Only digits, spaces and separators may appear (after prefix stripping).
const ALLOWED_RE = /^[\d ,.]+$/;
// The decimal tail: an integer section ending in a digit, then one separator,
// then exactly 1-2 digits at end of string. If this does NOT match, there is
// no decimal part (a trailing 3-digit group is thousands, not a fraction).
const DECIMAL_RE = /^(.*[0-9])([.,])(\d{1,2})$/;
// A valid integer section: plain digits, OR 1-3 digits then any number of
// 3-digit groups each introduced by a space/comma/period.
const PLAIN_DIGITS_RE = /^\d+$/;
const GROUPED_RE = /^\d{1,3}([ ,.]\d{3})*$/;

const ERR_EMPTY = 'Enter an amount';
const ERR_NEGATIVE = 'Amount cannot be negative';
const ERR_INVALID = 'Enter a valid amount, e.g. 1 500.00 or 1 500,00';
const ERR_TOO_LARGE = 'Amount is too large';

// Cap the whole-number digit count. 13 digits (up to 9,999,999,999,999.99)
// keeps cents well inside Number.MAX_SAFE_INTEGER (~9.0e15); beyond this,
// parseInt(...) * 100 starts losing integer precision.
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
  if (body.length === 0 || !ALLOWED_RE.test(body) || !/\d/.test(body)) {
    return { ok: false, error: ERR_INVALID };
  }

  // Split off the decimal fraction, if any.
  const decMatch = body.match(DECIMAL_RE);
  const integerSection = decMatch ? decMatch[1] : body;
  const fractionRaw = decMatch ? decMatch[3] : '';

  // The integer section may carry thousands separators; its grouping must be
  // valid (plain digits or 3-digit groups) or we reject rather than guess.
  if (!PLAIN_DIGITS_RE.test(integerSection) && !GROUPED_RE.test(integerSection)) {
    return { ok: false, error: ERR_INVALID };
  }

  const wholeDigits = integerSection.replace(/[ ,.]/g, '');
  if (wholeDigits.length === 0) {
    return { ok: false, error: ERR_INVALID };
  }
  if (wholeDigits.length > MAX_WHOLE_DIGITS) {
    return { ok: false, error: ERR_TOO_LARGE };
  }

  const fractionPart = fractionRaw.padEnd(2, '0');
  const cents = parseInt(wholeDigits, 10) * 100 + parseInt(fractionPart, 10);
  // Defence in depth: reject any value that still isn't an exact integer
  // rather than return a silently-wrong amount.
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: ERR_TOO_LARGE };
  }
  return { ok: true, cents };
}

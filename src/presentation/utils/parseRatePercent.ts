/**
 * Parse interest rate percentage input, supporting both '.' and ',' as decimal separators.
 *
 * South African users may type rates as "12,5" (12.5%) or "12.5" depending on
 * keyboard layout. This parser accepts both, but rejects anything with:
 *   - Whitespace (e.g. "1 2")
 *   - Letters or special characters (e.g. "abc", "12%")
 *   - Multiple decimal separators (e.g. "12,5,1")
 *   - Empty/whitespace-only input
 *
 * Returns the parsed number (0–100 range is validated by the caller),
 * or `null` if the input is unparseable.
 *
 * @param input Raw user input
 * @returns Parsed finite number, or null if invalid
 */
export function parseRatePercent(input: string): number | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Allow only digits and a single decimal separator (. or ,).
  // Reject spaces, letters, multiple separators, etc.
  let separatorCount = 0;
  let normalizedInput = '';

  for (const char of trimmed) {
    if (char === '.' || char === ',') {
      separatorCount++;
      if (separatorCount > 1) {
        return null; // More than one separator
      }
      normalizedInput += '.'; // Normalize to period for parseFloat
    } else if (char >= '0' && char <= '9') {
      normalizedInput += char;
    } else {
      // Any other character (space, letter, symbol, etc.) is invalid
      return null;
    }
  }

  const rate = parseFloat(normalizedInput);
  if (!Number.isFinite(rate)) {
    return null;
  }

  return rate;
}

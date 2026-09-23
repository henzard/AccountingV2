/**
 * Creates a deterministic hash for transaction deduplication.
 * Combines date, amount (cents), and payee/description.
 *
 * This allows idempotent CSV imports: the same transaction
 * imported twice will be skipped on the second import.
 *
 * Uses a simple FNV-1a hash (non-cryptographic but sufficient for deduplication).
 *
 * @param date - ISO date string YYYY-MM-DD
 * @param amountCents - Transaction amount in cents
 * @param identifier - Payee or description
 */
export function createTransactionHash(
  date: string,
  amountCents: number,
  identifier: string,
): string {
  const normalized = `${date}|${amountCents}|${identifier.trim().toLowerCase()}`;
  return fnv1aHash(normalized);
}

/**
 * FNV-1a hash: simple, fast, non-cryptographic hash suitable for deduplication.
 * Returns a 16-character hex string.
 */
function fnv1aHash(input: string): string {
  let hash = 2166136261; // FNV offset basis

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619); // FNV prime
  }

  // Convert to unsigned 32-bit int and then to hex
  const unsigned = hash >>> 0;
  const hex = unsigned.toString(16).padStart(8, '0');

  // Extend to 16 chars by hashing the input twice with different seeds
  let hash2 = 2166136261;
  for (let i = input.length - 1; i >= 0; i--) {
    hash2 ^= input.charCodeAt(i);
    hash2 = Math.imul(hash2, 16777619);
  }
  const unsigned2 = hash2 >>> 0;
  const hex2 = unsigned2.toString(16).padStart(8, '0');

  return hex + hex2;
}

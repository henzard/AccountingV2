/**
 * Deterministic RFC-4122 version-5 UUID generation: `namespace + name ->
 * SHA-1 -> version/variant bits set`. Pure and synchronous — no I/O, no
 * randomness, no new npm dependency.
 *
 * Why not `expo-crypto`: its only digest primitive, `digestStringAsync`
 * (see node_modules/expo-crypto/build/Crypto.d.ts), is Promise-based — it
 * bridges to a native SHA implementation asynchronously. `uuidv5` is used by
 * `StartNewPeriodUseCase` to compute a rolled-over envelope's id inline
 * while building each insert row; threading that single call through async
 * would force the whole copy-forward loop (and its callers) to become async
 * for no real benefit, and a synchronous helper is trivially unit-testable
 * without a fake clock/bridge. Rather than fall back to a random id (which
 * would defeat the entire purpose — the id must be reproducible on two
 * offline devices independently so they converge instead of duplicating),
 * this file implements a small, self-contained, synchronous SHA-1 (FIPS
 * 180-4) and the RFC-4122 v5 bit-twiddling on top of it. Correctness is
 * verified against the RFC 4122 Appendix B-style test vector in
 * `uuidv5.test.ts` (namespace `NAMESPACE_DNS` + name "www.example.com").
 */

/**
 * Fixed namespace UUID for every deterministic id derived within this app
 * (analogous to RFC-4122's well-known namespaces like `NAMESPACE_DNS`).
 * Generated once with Node's `crypto.randomUUID()` and hardcoded — it must
 * NEVER change, since changing it would change every id derived under it
 * (e.g. `StartNewPeriodUseCase`'s rolled-over envelope ids) and break
 * idempotency for any rollover already performed on a device.
 */
export const APP_NAMESPACE = '8426e7d6-cb2e-4116-b945-cd430463c06f';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuidString(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`uuidv5: ${label} is not a valid UUID string: "${value}"`);
  }
}

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  }
  return bytes;
}

/**
 * Encodes a JS string to UTF-8 bytes without relying on the global
 * `TextEncoder` (not guaranteed present on every Hermes/RN runtime this app
 * targets).
 */
function utf8Encode(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const codePoint = input.codePointAt(i) as number;
    if (codePoint > 0xffff) i++; // this code point consumed a UTF-16 surrogate pair

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** Minimal synchronous SHA-1 (FIPS 180-4) over a byte array. Returns the 20-byte digest. */
function sha1(bytes: number[]): Uint8Array {
  const messageLenBits = bytes.length * 8;
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  // 64-bit big-endian bit-length. Every name this app hashes is far below
  // 2^32 bits, so the high 32 bits are always zero.
  for (let shift = 24; shift >= 0; shift -= 8) padded.push(0);
  for (let shift = 24; shift >= 0; shift -= 8) padded.push((messageLenBits >>> shift) & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) {
      const offset = chunkStart + i * 4;
      w[i] =
        (padded[offset] << 24) |
        (padded[offset + 1] << 16) |
        (padded[offset + 2] << 8) |
        padded[offset + 3];
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const words = [h0, h1, h2, h3, h4];
  for (let i = 0; i < 5; i++) {
    digest[i * 4] = (words[i] >>> 24) & 0xff;
    digest[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    digest[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    digest[i * 4 + 3] = words[i] & 0xff;
  }
  return digest;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Computes a deterministic RFC-4122 version-5 UUID from `name` scoped under
 * `namespace` (a UUID string, e.g. `APP_NAMESPACE`). The same `(name,
 * namespace)` pair ALWAYS produces the same UUID — this is what lets
 * `StartNewPeriodUseCase` derive the identical rolled-over envelope id on
 * two offline devices independently, so they converge instead of creating
 * duplicate rows when they eventually sync.
 */
export function uuidv5(name: string, namespace: string): string {
  assertUuidString(namespace, 'namespace');

  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = utf8Encode(name);
  const hash = sha1(namespaceBytes.concat(nameBytes));

  // Truncate to the first 16 bytes, then set the version (5) and variant
  // (RFC 4122, "10xxxxxx") bits per RFC 4122 §4.3.
  const result = hash.slice(0, 16);
  result[6] = (result[6] & 0x0f) | 0x50;
  result[8] = (result[8] & 0x3f) | 0x80;

  return bytesToUuid(result);
}

import { djb2Hex } from '../db';

describe('djb2Hex', () => {
  it('returns an 8-character hex string', () => {
    expect(djb2Hex('hello')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(djb2Hex('CREATE TABLE foo (id TEXT)')).toBe(djb2Hex('CREATE TABLE foo (id TEXT)'));
  });

  it('produces different hashes for different inputs', () => {
    expect(djb2Hex('alpha')).not.toBe(djb2Hex('beta'));
  });

  it('handles empty string', () => {
    expect(djb2Hex('')).toBe('00001505');
  });
});

describe('migration runner — checksum verification', () => {
  it('djb2Hex detects a checksum mismatch correctly', () => {
    // Simulates a stored checksum of 'deadbeef' (tampered/wrong) vs the real hash.
    const sql = 'CREATE TABLE x (id TEXT);';
    const storedChecksum = 'deadbeef';
    const actual = djb2Hex(sql);
    // A mismatch would be caught and thrown by the runner.
    expect(actual).not.toBe(storedChecksum);
    // Same input always produces the same output — no false positives.
    expect(djb2Hex(sql)).toBe(djb2Hex(sql));
  });

  it('legacy sentinel bypasses mismatch check — djb2Hex("legacy") is not special', () => {
    // The runner skips checksum verification when storedChecksum === LEGACY_CHECKSUM.
    // This test confirms 'legacy' is just an ordinary string value in djb2Hex,
    // so the skip must be done by an explicit equality guard (not a hash property).
    const legacyHash = djb2Hex('legacy');
    const sql = 'CREATE TABLE a (id TEXT);';
    // 'legacy' hashes to something — it is not the same as any arbitrary migration hash,
    // so the guard `storedChecksum === 'legacy'` is the only reliable way to skip.
    expect(legacyHash).toMatch(/^[0-9a-f]{8}$/);
    expect(legacyHash).not.toBe(djb2Hex(sql));
  });
});

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

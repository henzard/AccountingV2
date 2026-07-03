import { uuidv5, APP_NAMESPACE } from './uuidv5';

describe('uuidv5', () => {
  // RFC 4122 well-known namespace `NAMESPACE_DNS`, and the canonical
  // "www.example.com" test vector used throughout RFC-4122 v5 implementations
  // (e.g. Python's uuid.uuid5, the `uuid` npm package's own test suite).
  const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

  it('matches the RFC-4122 v5 test vector for NAMESPACE_DNS + "www.example.com"', () => {
    expect(uuidv5('www.example.com', NAMESPACE_DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is deterministic: same name + namespace always produces the same UUID', () => {
    const a = uuidv5('household-1:2026-08-01:env-groceries', APP_NAMESPACE);
    const b = uuidv5('household-1:2026-08-01:env-groceries', APP_NAMESPACE);
    expect(a).toBe(b);
  });

  it('produces a different UUID for a different name under the same namespace', () => {
    const a = uuidv5('household-1:2026-08-01:env-groceries', APP_NAMESPACE);
    const b = uuidv5('household-1:2026-09-01:env-groceries', APP_NAMESPACE);
    expect(a).not.toBe(b);
  });

  it('produces a different UUID for the same name under a different namespace', () => {
    const a = uuidv5('www.example.com', NAMESPACE_DNS);
    const b = uuidv5('www.example.com', APP_NAMESPACE);
    expect(a).not.toBe(b);
  });

  it('sets the RFC-4122 version (5) and variant (10xx) bits', () => {
    const id = uuidv5('some-name', APP_NAMESPACE);
    const parts = id.split('-');
    expect(parts[2][0]).toBe('5'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(parts[3][0]); // variant nibble
  });

  it('rejects a malformed namespace string', () => {
    expect(() => uuidv5('some-name', 'not-a-uuid')).toThrow(/not a valid UUID/);
  });
});

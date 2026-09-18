import { createTransactionHash } from '../transactionHash';

describe('createTransactionHash', () => {
  it('creates consistent hash for same inputs', () => {
    const hash1 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');
    const hash2 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it('creates different hashes for different dates', () => {
    const hash1 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');
    const hash2 = createTransactionHash('2026-09-16', 12550, 'Pick n Pay');

    expect(hash1).not.toBe(hash2);
  });

  it('creates different hashes for different amounts', () => {
    const hash1 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');
    const hash2 = createTransactionHash('2026-09-15', 12551, 'Pick n Pay');

    expect(hash1).not.toBe(hash2);
  });

  it('creates different hashes for different identifiers', () => {
    const hash1 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');
    const hash2 = createTransactionHash('2026-09-15', 12550, 'Woolworths');

    expect(hash1).not.toBe(hash2);
  });

  it('normalizes identifier case', () => {
    const hash1 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');
    const hash2 = createTransactionHash('2026-09-15', 12550, 'PICK N PAY');

    expect(hash1).toBe(hash2);
  });

  it('trims whitespace from identifier', () => {
    const hash1 = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');
    const hash2 = createTransactionHash('2026-09-15', 12550, '  Pick n Pay  ');

    expect(hash1).toBe(hash2);
  });

  it('produces 16-character hex string', () => {
    const hash = createTransactionHash('2026-09-15', 12550, 'Pick n Pay');

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

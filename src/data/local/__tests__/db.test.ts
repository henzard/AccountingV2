/**
 * db.test.ts — tests for djb2Hex hashing utility and useDatabaseMigrations hook.
 */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => ({
    execAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withExclusiveTransactionAsync: jest.fn(),
  })),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: jest.fn(() => ({})),
}));

jest.mock('../schema', () => ({}));
jest.mock('../migrations/migrations', () => ({ migrations: {} }));

import { djb2Hex } from '../db';

describe('djb2Hex', () => {
  it('returns consistent hash for same input', () => {
    const hash1 = djb2Hex('hello world');
    const hash2 = djb2Hex('hello world');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different inputs', () => {
    const hash1 = djb2Hex('hello');
    const hash2 = djb2Hex('world');
    expect(hash1).not.toBe(hash2);
  });

  it('returns 8-character hex string', () => {
    const hash = djb2Hex('test string');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles empty string', () => {
    const hash = djb2Hex('');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hash).toBe('00001505');
  });

  it('handles long strings', () => {
    const hash = djb2Hex('a'.repeat(10000));
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is case-sensitive', () => {
    expect(djb2Hex('Hello')).not.toBe(djb2Hex('hello'));
  });

  it('handles special characters', () => {
    const hash = djb2Hex('CREATE TABLE `users` (`id` INTEGER PRIMARY KEY)');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

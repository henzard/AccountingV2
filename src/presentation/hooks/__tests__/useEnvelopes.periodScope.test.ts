/* eslint-disable @typescript-eslint/no-require-imports */
// Regression test for C3 (2026-07-05 exhaustive audit): useEnvelopes used to
// filter envelopes with a raw `eq(period_start, currentPeriodStart)`, which
// permanently excludes PERSISTENT envelope types (sinking_fund,
// emergency_fund, savings, baby_step) from every budget period after the one
// they were created in, since persistent rows are never re-created per
// period and their `period_start` never advances.
//
// This exercises the REAL query (`envelopeScopeCondition`, real
// `getEnvelopeSpentCents`) against a REAL migrated better-sqlite3 database —
// the same pattern already used by src/data/sync/SyncEngine.test.ts — instead
// of the fully-mocked `db` used by useEnvelopes.test.ts, so it actually
// proves the SQL scope is correct rather than just the hook's JS wiring.
import { renderHook, waitFor } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const NOW = '2026-01-01T00:00:00.000Z';
const HOUSEHOLD = 'hh-1';
const OLD_PERIOD = '2026-06-01';
const CURRENT_PERIOD = '2026-07-01';

// Variable name must be prefixed with `mock` so babel-plugin-jest-hoist
// allows referencing it from inside the (hoisted) jest.mock factory below —
// the factory can't reference other top-level imports/consts.
let mockRawDb: Database.Database;

jest.mock('../../../data/local/db', () => {
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { openMigratedDb } = require('../../../../tests/realsql/harness/openMigratedDb');
  const schema = require('../../../data/local/schema');
  const raw = openMigratedDb();
  mockRawDb = raw;
  return { db: drizzle(raw, { schema }) };
});

import { useEnvelopes } from '../useEnvelopes';

function seedHousehold(raw: Database.Database, id: string): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 25, ?, ?)`,
    )
    .run(id, NOW, NOW);
}

function seedEnvelope(
  raw: Database.Database,
  args: { id: string; envelopeType: string; periodStart: string },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, 50000, ?, 0, 0, ?, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.id, args.envelopeType, args.periodStart, NOW, NOW);
}

describe('useEnvelopes — period scope (real SQLite)', () => {
  beforeEach(() => {
    mockRawDb.exec('DELETE FROM envelopes; DELETE FROM transactions; DELETE FROM households;');
    seedHousehold(mockRawDb, HOUSEHOLD);
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it('includes a persistent envelope created in an OLD period, and excludes an OLD period-scoped envelope', async () => {
    // Persistent envelope, created back in the OLD period — its period_start
    // never gets updated on rollover, so it must still show up now.
    seedEnvelope(mockRawDb, {
      id: 'env-emergency-fund',
      envelopeType: 'emergency_fund',
      periodStart: OLD_PERIOD,
    });
    // Period-scoped envelope left over from the OLD period — must NOT leak
    // into the current period's list.
    seedEnvelope(mockRawDb, {
      id: 'env-old-spending',
      envelopeType: 'spending',
      periodStart: OLD_PERIOD,
    });
    // Period-scoped envelope belonging to the CURRENT period — must be
    // included.
    seedEnvelope(mockRawDb, {
      id: 'env-current-spending',
      envelopeType: 'spending',
      periodStart: CURRENT_PERIOD,
    });

    const { result } = renderHook(() => useEnvelopes(HOUSEHOLD, CURRENT_PERIOD));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    const ids = result.current.envelopes.map((e) => e.id);

    expect(ids).toContain('env-emergency-fund');
    expect(ids).toContain('env-current-spending');
    expect(ids).not.toContain('env-old-spending');
  });
});

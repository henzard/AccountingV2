/* eslint-disable @typescript-eslint/no-require-imports */
// Regression test (PR #136 review): `useDebts`'s query had no
// `isNull(debts.deletedAt)` filter, so a soft-deleted debt (a tombstone from
// this device, or one applied via sync from another) stayed in the live
// list/projection forever — and diverged from RolloverWizard's snapshot
// query, which DOES filter deleted debts, so the live projection and the
// stored "last month" snapshot silently used different debt sets.
//
// Exercises the REAL query against a REAL migrated better-sqlite3 database
// (the same pattern as useEnvelopes.periodScope.test.ts) rather than the
// fully-mocked `db` used by useDebts.test.ts, so it proves the SQL actually
// excludes the row rather than just the hook's JS wiring.
import { renderHook, act } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const HOUSEHOLD = 'hh-1';
const NOW = '2026-01-01T00:00:00.000Z';

let mockRawDb: Database.Database;

jest.mock('../../../data/local/db', () => {
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { openMigratedDb } = require('../../../../tests/realsql/harness/openMigratedDb');
  const schema = require('../../../data/local/schema');
  const raw = openMigratedDb();
  mockRawDb = raw;
  return { db: drizzle(raw, { schema }) };
});

import { useDebts } from '../useDebts';

function seedDebt(
  raw: Database.Database,
  args: { id: string; creditorName: string; deletedAt: string | null },
): void {
  raw
    .prepare(
      `INSERT INTO debts
         (id, household_id, creditor_name, debt_type, outstanding_balance_cents,
          interest_rate_percent, minimum_payment_cents, sort_order, is_paid_off,
          initial_balance_cents, total_paid_cents, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'credit_card', 10000, 0, 5000, 0, 0, 10000, 0, ?, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.creditorName, NOW, NOW, args.deletedAt);
}

describe('useDebts — excludes soft-deleted debts', () => {
  it('a row with deletedAt set is excluded from the returned list', async () => {
    seedDebt(mockRawDb, { id: 'd-live', creditorName: 'Live Debt', deletedAt: null });
    seedDebt(mockRawDb, {
      id: 'd-deleted',
      creditorName: 'Deleted Debt',
      deletedAt: '2026-02-01T00:00:00.000Z',
    });

    const { result } = renderHook(() => useDebts(HOUSEHOLD));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.debts.map((d) => d.id)).toEqual(['d-live']);
  });
});

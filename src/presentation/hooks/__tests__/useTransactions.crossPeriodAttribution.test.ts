/* eslint-disable @typescript-eslint/no-require-imports */
// E-2: useTransactions used to OR the date window with "booked against a
// period-scoped envelope of THIS period". A row on period A's envelope whose
// own `transaction_date` falls inside period B therefore matched BOTH
// periods' WHERE clauses — it was listed twice, once per period, and summed
// into both periods' on-screen totals. The ledger
// (`getEnvelopeSpentCents`) never does that: it attributes such a row to the
// envelope, and therefore to the envelope's period, alone.
//
// Membership must now mirror the ledger exactly:
//  - period-scoped envelope  -> the envelope's period, and only that one;
//  - persistent envelope, or no/unknown/deleted envelope -> by date.
//
// Exercises the REAL query against a REAL migrated better-sqlite3 database
// (same pattern as useTransactions.periodScope.test.ts), so it proves the
// SQL rather than the hook's JS wiring.
import { renderHook, act } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const NOW = '2026-01-01T00:00:00.000Z';
const HOUSEHOLD = 'hh-1';
const AUGUST = { start: '2026-08-01', end: '2026-08-31' };
const SEPTEMBER = { start: '2026-09-01', end: '2026-09-30' };

// Variable name must be prefixed with `mock` so babel-plugin-jest-hoist
// allows referencing it from inside the (hoisted) jest.mock factory below.
let mockRawDb: Database.Database;

jest.mock('../../../data/local/db', () => {
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { openMigratedDb } = require('../../../../tests/realsql/harness/openMigratedDb');
  const schema = require('../../../data/local/schema');
  const raw = openMigratedDb();
  mockRawDb = raw;
  return { db: drizzle(raw, { schema }) };
});

import { useTransactions } from '../useTransactions';

function seedHousehold(raw: Database.Database): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 1, ?, ?)`,
    )
    .run(HOUSEHOLD, NOW, NOW);
}

function seedEnvelope(
  raw: Database.Database,
  args: { id: string; envelopeType: string; periodStart: string; deletedAt?: string },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 50000, ?, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      HOUSEHOLD,
      args.id,
      args.envelopeType,
      args.periodStart,
      NOW,
      NOW,
      args.deletedAt ?? null,
    );
}

function seedTransaction(
  raw: Database.Database,
  args: { id: string; envelopeId: string; date: string },
): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, transaction_date,
          is_business_expense, created_at, updated_at)
       VALUES (?, ?, ?, 10000, ?, 0, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.envelopeId, args.date, NOW, NOW);
}

async function loadFor(period: { start: string; end: string }): Promise<string[]> {
  const { result } = renderHook(() =>
    useTransactions(HOUSEHOLD, { periodStart: period.start, periodEnd: period.end }),
  );
  await act(async () => {
    await result.current.reload();
  });
  return result.current.transactions.map((t) => t.id);
}

describe('useTransactions — list membership matches the ledger (E-2)', () => {
  beforeAll(() => {
    seedHousehold(mockRawDb);

    // A PERIOD-SCOPED envelope per period, each holding one transaction dated
    // inside the OTHER period — the exact shape that used to be listed twice.
    seedEnvelope(mockRawDb, {
      id: 'groceries-aug',
      envelopeType: 'spending',
      periodStart: AUGUST.start,
    });
    seedTransaction(mockRawDb, {
      id: 'tx-aug-envelope-sep-date',
      envelopeId: 'groceries-aug',
      date: '2026-09-10',
    });
    seedEnvelope(mockRawDb, {
      id: 'groceries-sep',
      envelopeType: 'spending',
      periodStart: SEPTEMBER.start,
    });
    seedTransaction(mockRawDb, {
      id: 'tx-sep-envelope-aug-date',
      envelopeId: 'groceries-sep',
      date: '2026-08-20',
    });

    // A PERSISTENT envelope has no period of its own, so its rows are
    // attributed by date — one in each period.
    seedEnvelope(mockRawDb, {
      id: 'fuel-fund',
      envelopeType: 'sinking_fund',
      periodStart: '2026-03-01',
    });
    seedTransaction(mockRawDb, { id: 'tx-fund-aug', envelopeId: 'fuel-fund', date: '2026-08-12' });
    seedTransaction(mockRawDb, { id: 'tx-fund-sep', envelopeId: 'fuel-fund', date: '2026-09-12' });

    // No envelope row at all (never synced, or purged) — nothing claims it,
    // so its own date decides.
    seedTransaction(mockRawDb, {
      id: 'tx-orphan-sep',
      envelopeId: 'envelope-that-does-not-exist',
      date: '2026-09-15',
    });

    // A soft-deleted period-scoped envelope no longer claims its rows either.
    seedEnvelope(mockRawDb, {
      id: 'deleted-aug',
      envelopeType: 'spending',
      periodStart: AUGUST.start,
      deletedAt: NOW,
    });
    seedTransaction(mockRawDb, {
      id: 'tx-deleted-envelope-sep-date',
      envelopeId: 'deleted-aug',
      date: '2026-09-18',
    });
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it('lists a cross-period-dated row once, in its PERIOD-SCOPED envelope’s period', async () => {
    const august = await loadFor(AUGUST);
    const september = await loadFor(SEPTEMBER);

    expect(august.filter((id) => id === 'tx-aug-envelope-sep-date')).toHaveLength(1);
    expect(september).not.toContain('tx-aug-envelope-sep-date');

    // ...and the same the other way round.
    expect(september.filter((id) => id === 'tx-sep-envelope-aug-date')).toHaveLength(1);
    expect(august).not.toContain('tx-sep-envelope-aug-date');
  });

  it('attributes a PERSISTENT-envelope row by its own date', async () => {
    const august = await loadFor(AUGUST);
    const september = await loadFor(SEPTEMBER);

    expect(august).toContain('tx-fund-aug');
    expect(august).not.toContain('tx-fund-sep');
    expect(september).toContain('tx-fund-sep');
    expect(september).not.toContain('tx-fund-aug');
  });

  it('attributes a row with no (or a deleted) envelope by its own date', async () => {
    const august = await loadFor(AUGUST);
    const september = await loadFor(SEPTEMBER);

    expect(september).toEqual(
      expect.arrayContaining(['tx-orphan-sep', 'tx-deleted-envelope-sep-date']),
    );
    expect(august).not.toContain('tx-orphan-sep');
    expect(august).not.toContain('tx-deleted-envelope-sep-date');
  });
});

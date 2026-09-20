/* eslint-disable @typescript-eslint/no-require-imports */
// Regression test for REG-6: useTransactions OR-ed the date window with
// `envelopeScopeCondition`, which matches PERSISTENT envelope types
// (sinking_fund, emergency_fund, savings, baby_step) unconditionally — so
// every transaction ever booked to a sinking fund appeared in, and was
// totalled into, EVERY period's list. A March fuel-fund spend showed up in
// September.
//
// Exercises the REAL query against a REAL migrated better-sqlite3 database
// (same pattern as useEnvelopes.periodScope.test.ts) rather than the fully
// mocked `db` of useTransactions.test.ts, so it proves the SQL scope rather
// than the hook's JS wiring.
import { renderHook, act } from '@testing-library/react-native';
import type Database from 'better-sqlite3';

const NOW = '2026-01-01T00:00:00.000Z';
const HOUSEHOLD = 'hh-1';
const MARCH = { start: '2026-03-01', end: '2026-03-31' };
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

function seedTransaction(
  raw: Database.Database,
  args: { id: string; envelopeId: string; date: string; amountCents: number },
): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, transaction_date,
          is_business_expense, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(args.id, HOUSEHOLD, args.envelopeId, args.amountCents, args.date, NOW, NOW);
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

describe('useTransactions — period scope against real SQLite (REG-6)', () => {
  beforeAll(() => {
    seedHousehold(mockRawDb);
    // A sinking fund lives across every period; its March spend must stay in
    // March.
    seedEnvelope(mockRawDb, {
      id: 'fuel-fund',
      envelopeType: 'sinking_fund',
      periodStart: MARCH.start,
    });
    seedTransaction(mockRawDb, {
      id: 'tx-march-fund',
      envelopeId: 'fuel-fund',
      date: '2026-03-12',
      amountCents: -25_000,
    });
    // A period-scoped envelope for September, with a transaction back-dated
    // before the window — it still counts toward that envelope's balance, so
    // it must stay visible in September's list.
    seedEnvelope(mockRawDb, {
      id: 'groceries-sep',
      envelopeType: 'spending',
      periodStart: SEPTEMBER.start,
    });
    seedTransaction(mockRawDb, {
      id: 'tx-backdated',
      envelopeId: 'groceries-sep',
      date: '2026-08-28',
      amountCents: -30_000,
    });
    seedTransaction(mockRawDb, {
      id: 'tx-september',
      envelopeId: 'groceries-sep',
      date: '2026-09-04',
      amountCents: -10_000,
    });
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it("leaves March's sinking-fund spend out of September", async () => {
    const ids = await loadFor(SEPTEMBER);
    expect(ids).not.toContain('tx-march-fund');
  });

  it('keeps a back-dated row on a current PERIOD-SCOPED envelope visible', async () => {
    const ids = await loadFor(SEPTEMBER);
    expect(ids).toEqual(expect.arrayContaining(['tx-backdated', 'tx-september']));
  });

  it('still shows the sinking-fund spend in its own period, by date', async () => {
    const ids = await loadFor(MARCH);
    expect(ids).toContain('tx-march-fund');
    expect(ids).not.toContain('tx-september');
  });
});

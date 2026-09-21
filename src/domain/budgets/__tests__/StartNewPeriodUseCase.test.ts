/**
 * `StartNewPeriodUseCase` against a REAL migrated better-sqlite3 database.
 *
 * The rollover's contract is almost entirely about rows and ids — which
 * envelopes are copied, which funds are credited, what the deterministic id
 * of each is, and whether a mid-flight failure can leave half a period behind
 * — so it is exercised against the actual driver rather than a mocked unit of
 * work, which by construction cannot roll anything back.
 *
 * `tests/realsql/startNewPeriod.test.ts` covers the copy-forward/archived and
 * M14 atomicity cases from the repository tier; this file is the use case's
 * own unit tier and adds the funding contract, the soft-delete and
 * value-based idempotency guards, and the payday-boundary period keys the
 * `BudgetPeriodEngine` feeds it. The expected behaviour is taken from the use
 * case, `PersistentContributions` and `RolloverWizard.test.tsx` (which asserts
 * the wizard hands `{ fromPeriodStart, toPeriodStart }` straight through and
 * renders `contributionCount`/`contributedCents`).
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: (): string => `random-uuid-${++counter}` };
});

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from '../../../../tests/realsql/harness/openMigratedDb';
import type * as schema from '../../../data/local/schema';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../shared/BudgetPeriodEngine';
import { periodContributionId } from '../PersistentContributions';
import { StartNewPeriodUseCase, rolloverEnvelopeId } from '../StartNewPeriodUseCase';

const HOUSEHOLD_ID = 'hh-rollover';
// After LEGACY_OPENING_BALANCE_CUTOFF, so `ensureOpeningBalances` classifies
// nothing here as legacy — a legacy fund's allocation would be moved into the
// ledger and zeroed, which is a different contract (savingsLedgerSemantics).
const NOW = '2026-10-01T00:00:00.000Z';
const FROM_PERIOD = '2026-10-01';
const TO_PERIOD = '2026-11-01';
const R500 = 50_000;
const R200 = 20_000;

const DEPS = { deviceId: 'device-1', actorUserId: 'user-1', clock: () => NOW };

function seedHousehold(raw: Database.Database, paydayDay = 1): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', ?, ?, ?)`,
    )
    .run(HOUSEHOLD_ID, paydayDay, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  name?: string;
  envelopeType: string;
  periodStart?: string;
  allocatedCents?: number;
  isArchived?: boolean;
  isSavingsLocked?: boolean;
  deletedAt?: string | null;
  targetAmountCents?: number | null;
  targetDate?: string | null;
}

function seedEnvelope(raw: Database.Database, args: SeedEnvelopeArgs): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, target_amount_cents, target_date,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      HOUSEHOLD_ID,
      args.name ?? args.id,
      args.allocatedCents ?? R500,
      args.envelopeType,
      args.isSavingsLocked ? 1 : 0,
      args.isArchived ? 1 : 0,
      args.periodStart ?? FROM_PERIOD,
      args.targetAmountCents ?? null,
      args.targetDate ?? null,
      NOW,
      NOW,
      args.deletedAt ?? null,
    );
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function rollover(
  db: ExpoSQLiteDatabase<typeof schema>,
  from = FROM_PERIOD,
  to = TO_PERIOD,
  deps: Record<string, unknown> = DEPS,
): ReturnType<StartNewPeriodUseCase['execute']> {
  return new StartNewPeriodUseCase(db, deps).execute({
    householdId: HOUSEHOLD_ID,
    fromPeriodStart: from,
    toPeriodStart: to,
  });
}

interface EnvelopeRow {
  id: string;
  name: string;
  allocated_cents: number;
  envelope_type: string;
  period_start: string;
  is_archived: number;
  is_savings_locked: number;
  target_amount_cents: number | null;
  target_date: string | null;
}

function envelopeRow(raw: Database.Database, id: string): EnvelopeRow | undefined {
  return raw.prepare('SELECT * FROM envelopes WHERE id = ?').get(id) as EnvelopeRow | undefined;
}

interface ContributionRow {
  id: string;
  envelope_id: string;
  amount_cents: number;
  period_start: string;
  source: string;
}

function contributionRows(raw: Database.Database): ContributionRow[] {
  return raw
    .prepare('SELECT * FROM envelope_contributions ORDER BY envelope_id')
    .all() as ContributionRow[];
}

function countRows(raw: Database.Database, table: string, where: string, ...params: unknown[]) {
  return (
    raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as {
      n: number;
    }
  ).n;
}

describe('StartNewPeriodUseCase', () => {
  describe('deterministic ids and idempotent replay', () => {
    it('gives every copy and contribution the id its pure-function formula predicts', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-groceries', envelopeType: 'spending', allocatedCents: R500 });
      seedEnvelope(raw, { id: 'env-roof', envelopeType: 'sinking_fund', allocatedCents: R200 });
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data).toEqual({ count: 1, contributionCount: 1, contributedCents: R200 });

      expect(
        envelopeRow(raw, rolloverEnvelopeId(HOUSEHOLD_ID, TO_PERIOD, 'env-groceries')),
      ).toBeTruthy();
      expect(contributionRows(raw)[0].id).toBe(
        periodContributionId(HOUSEHOLD_ID, 'env-roof', TO_PERIOD),
      );

      raw.close();
    });

    it('running the same rollover twice creates nothing new (rows or oplog ops)', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-groceries', envelopeType: 'spending', allocatedCents: R500 });
      seedEnvelope(raw, { id: 'env-electricity', envelopeType: 'utility', allocatedCents: R200 });
      seedEnvelope(raw, { id: 'env-roof', envelopeType: 'sinking_fund', allocatedCents: R200 });
      const db = makeDb(raw);

      const first = await rollover(db);
      expect(first.success).toBe(true);
      if (!first.success) throw new Error('unreachable');
      expect(first.data).toEqual({ count: 2, contributionCount: 1, contributedCents: R200 });

      const opsAfterFirst = countRows(raw, 'oplog', '1 = 1');
      const second = await rollover(db);

      expect(second.success).toBe(true);
      if (!second.success) throw new Error('unreachable');
      // Every deterministic id already exists — nothing copied, nothing funded.
      expect(second.data).toEqual({ count: 0, contributionCount: 0, contributedCents: 0 });
      expect(countRows(raw, 'envelopes', 'period_start = ?', TO_PERIOD)).toBe(2);
      expect(contributionRows(raw)).toHaveLength(1);
      expect(countRows(raw, 'oplog', '1 = 1')).toBe(opsAfterFirst);

      raw.close();
    });

    it('does not re-fund a period whose contribution row was RE-KEYED onto it (value guard)', async () => {
      // A payday change re-keys the current period's contribution rows onto
      // the new period key, and a re-keyed row keeps the id it was born with —
      // so the deterministic-id check alone cannot see it.
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-roof', envelopeType: 'sinking_fund', allocatedCents: R200 });
      raw
        .prepare(
          `INSERT INTO envelope_contributions
             (id, household_id, envelope_id, amount_cents, period_start, source, created_at, updated_at)
           VALUES ('rekeyed-id', ?, 'env-roof', ?, ?, 'rollover', ?, ?)`,
        )
        .run(HOUSEHOLD_ID, R200, TO_PERIOD, NOW, NOW);
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.contributionCount).toBe(0);
      expect(contributionRows(raw)).toHaveLength(1);

      raw.close();
    });

    it('returns zeros and writes nothing when the household has no eligible envelopes', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data).toEqual({ count: 0, contributionCount: 0, contributedCents: 0 });
      expect(countRows(raw, 'oplog', '1 = 1')).toBe(0);

      raw.close();
    });
  });

  describe('atomicity', () => {
    it('leaves NO partial rows when an op partway through the transaction fails', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-a', envelopeType: 'spending', allocatedCents: R500 });
      seedEnvelope(raw, { id: 'env-b', envelopeType: 'spending', allocatedCents: R500 });
      seedEnvelope(raw, { id: 'env-roof', envelopeType: 'sinking_fund', allocatedCents: R200 });
      // `op_id` is the oplog PRIMARY KEY, so this pre-seeded row makes the
      // SECOND op the rollover appends throw a real UNIQUE violation — after
      // the first envelope's INSERT has already run inside the transaction.
      raw
        .prepare(
          `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload,
                              actor_user_id, device_id, client_created_at)
           VALUES ('op-2', ?, 'envelopes', 'pre-existing-row', 'insert', '{}', NULL, 'device-x', ?)`,
        )
        .run(HOUSEHOLD_ID, NOW);
      const db = makeDb(raw);

      let opCounter = 0;
      await expect(
        rollover(db, FROM_PERIOD, TO_PERIOD, { ...DEPS, genId: () => `op-${++opCounter}` }),
      ).rejects.toBeTruthy();

      // Neither the envelope copies nor the fund's contribution survived —
      // they share one transaction, so a half-rolled-over period is impossible.
      expect(countRows(raw, 'envelopes', 'period_start = ?', TO_PERIOD)).toBe(0);
      expect(contributionRows(raw)).toHaveLength(0);
      expect(countRows(raw, 'oplog', 'row_id != ?', 'pre-existing-row')).toBe(0);

      raw.close();
    });
  });

  describe('archived and deleted envelopes are not carried forward', () => {
    it('skips an archived period envelope, a soft-deleted one, and a previous period’s row', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-live', envelopeType: 'spending', allocatedCents: R500 });
      seedEnvelope(raw, { id: 'env-archived', envelopeType: 'spending', isArchived: true });
      seedEnvelope(raw, {
        id: 'env-deleted',
        envelopeType: 'spending',
        deletedAt: '2026-10-05T00:00:00.000Z',
      });
      seedEnvelope(raw, {
        id: 'env-last-period',
        envelopeType: 'spending',
        periodStart: '2026-09-01',
      });
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.count).toBe(1);

      const copied = raw
        .prepare('SELECT * FROM envelopes WHERE period_start = ?')
        .all(TO_PERIOD) as EnvelopeRow[];
      expect(copied).toHaveLength(1);
      expect(copied[0].id).toBe(rolloverEnvelopeId(HOUSEHOLD_ID, TO_PERIOD, 'env-live'));

      raw.close();
    });

    it('does not fund an archived or soft-deleted fund', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, {
        id: 'env-archived-fund',
        envelopeType: 'emergency_fund',
        allocatedCents: R500,
        isArchived: true,
      });
      seedEnvelope(raw, {
        id: 'env-deleted-fund',
        envelopeType: 'savings',
        allocatedCents: R500,
        deletedAt: '2026-10-05T00:00:00.000Z',
      });
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data).toEqual({ count: 0, contributionCount: 0, contributedCents: 0 });
      expect(contributionRows(raw)).toHaveLength(0);

      raw.close();
    });
  });

  describe('persistent (savings-type) envelopes', () => {
    it('funds them instead of copying them: one ledger row each, the row itself untouched', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-emf', envelopeType: 'emergency_fund', allocatedCents: R500 });
      seedEnvelope(raw, { id: 'env-roof', envelopeType: 'sinking_fund', allocatedCents: R200 });
      seedEnvelope(raw, { id: 'env-step', envelopeType: 'baby_step', allocatedCents: R200 });
      seedEnvelope(raw, { id: 'env-holiday', envelopeType: 'savings', allocatedCents: R200 });
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data).toEqual({
        count: 0,
        contributionCount: 4,
        contributedCents: R500 + R200 * 3,
      });

      // Never duplicated into the new period — a persistent envelope is ONE
      // row that carries across periods.
      expect(countRows(raw, 'envelopes', 'period_start = ?', TO_PERIOD)).toBe(0);
      expect(envelopeRow(raw, 'env-emf')?.period_start).toBe(FROM_PERIOD);
      // `allocated_cents` stays the MONTHLY contribution; the rollover moves
      // money by appending to the ledger, not by editing the column.
      expect(envelopeRow(raw, 'env-emf')?.allocated_cents).toBe(R500);

      expect(contributionRows(raw).map((row) => ({ ...row, id: undefined }))).toEqual([
        {
          id: undefined,
          household_id: HOUSEHOLD_ID,
          envelope_id: 'env-emf',
          amount_cents: R500,
          period_start: TO_PERIOD,
          source: 'rollover',
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
        },
        {
          id: undefined,
          household_id: HOUSEHOLD_ID,
          envelope_id: 'env-holiday',
          amount_cents: R200,
          period_start: TO_PERIOD,
          source: 'rollover',
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
        },
        {
          id: undefined,
          household_id: HOUSEHOLD_ID,
          envelope_id: 'env-roof',
          amount_cents: R200,
          period_start: TO_PERIOD,
          source: 'rollover',
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
        },
        {
          id: undefined,
          household_id: HOUSEHOLD_ID,
          envelope_id: 'env-step',
          amount_cents: R200,
          period_start: TO_PERIOD,
          source: 'rollover',
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
        },
      ]);

      raw.close();
    });

    it('writes no row for a fund whose monthly amount is not known yet (allocation 0)', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, { id: 'env-unconfirmed', envelopeType: 'savings', allocatedCents: 0 });
      seedEnvelope(raw, { id: 'env-roof', envelopeType: 'sinking_fund', allocatedCents: R200 });
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.contributionCount).toBe(1);
      expect(contributionRows(raw).map((row) => row.envelope_id)).toEqual(['env-roof']);

      raw.close();
    });

    it('funds a fund regardless of which period its own row is filed under', async () => {
      // Persistent rows are not re-created per period, so one created three
      // periods ago must still be funded by today's rollover.
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, {
        id: 'env-roof',
        envelopeType: 'sinking_fund',
        allocatedCents: R200,
        periodStart: '2026-07-01',
      });
      const db = makeDb(raw);

      const result = await rollover(db);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.contributionCount).toBe(1);
      expect(contributionRows(raw)[0].period_start).toBe(TO_PERIOD);

      raw.close();
    });
  });

  describe('copy-forward fidelity', () => {
    it('carries name, allocation, type, savings lock and target across, un-archived', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedEnvelope(raw, {
        id: 'env-rates',
        name: 'Rates & Taxes',
        envelopeType: 'utility',
        allocatedCents: 12_345,
        isSavingsLocked: true,
        targetAmountCents: 99_000,
        targetDate: '2027-01-31',
      });
      const db = makeDb(raw);

      await rollover(db);

      const copied = envelopeRow(raw, rolloverEnvelopeId(HOUSEHOLD_ID, TO_PERIOD, 'env-rates'));
      expect(copied).toMatchObject({
        name: 'Rates & Taxes',
        allocated_cents: 12_345,
        envelope_type: 'utility',
        is_savings_locked: 1,
        is_archived: 0,
        period_start: TO_PERIOD,
        target_amount_cents: 99_000,
        target_date: '2027-01-31',
      });

      raw.close();
    });
  });

  describe('payday-day boundaries', () => {
    const engine = new BudgetPeriodEngine();

    /** The `yyyy-MM-dd` keys of the period containing `date` and the next one. */
    function periodKeys(paydayDay: number, date: Date): { from: string; to: string } {
      const current = engine.getPeriodForDate(paydayDay, date);
      const next = engine.getPeriodForDate(
        paydayDay,
        new Date(current.endDate.getTime() + 24 * 60 * 60 * 1000),
      );
      return {
        from: formatPeriodDateKey(current.startDate),
        to: formatPeriodDateKey(next.startDate),
      };
    }

    async function rollsOver(
      paydayDay: number,
      date: Date,
      expected: { from: string; to: string },
    ) {
      const { from, to } = periodKeys(paydayDay, date);
      expect({ from, to }).toEqual(expected);

      const raw = openMigratedDb();
      seedHousehold(raw, paydayDay);
      seedEnvelope(raw, {
        id: 'env-groceries',
        envelopeType: 'spending',
        allocatedCents: R500,
        periodStart: from,
      });
      const db = makeDb(raw);

      const result = await rollover(db, from, to);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.count).toBe(1);
      expect(
        envelopeRow(raw, rolloverEnvelopeId(HOUSEHOLD_ID, to, 'env-groceries'))?.period_start,
      ).toBe(to);

      raw.close();
    }

    it('payday 28: rolls January into a February period that starts on the 28th', async () => {
      await rollsOver(28, new Date(Date.UTC(2027, 0, 30)), {
        from: '2027-01-28',
        to: '2027-02-28',
      });
    });

    it('payday 31: February clamps to its last day (28 in 2027, 29 in a leap year)', async () => {
      await rollsOver(31, new Date(Date.UTC(2027, 0, 31)), {
        from: '2027-01-31',
        to: '2027-02-28',
      });
      await rollsOver(31, new Date(Date.UTC(2028, 0, 31)), {
        from: '2028-01-31',
        to: '2028-02-29',
      });
    });

    it('payday 1: rolls on the first of each month, February included', async () => {
      await rollsOver(1, new Date(Date.UTC(2027, 1, 14)), {
        from: '2027-02-01',
        to: '2027-03-01',
      });
    });
  });
});

/**
 * `AdjustSavedBalanceUseCase` against a REAL migrated better-sqlite3 database
 * (the same `openMigratedDb` harness `EnsureHouseholdUseCase.test.ts` uses
 * from `src/`), because every interesting property here is a property of the
 * actual driver: what lands in `envelope_contributions`, what the oplog op
 * carries, and — above all — whether the "cannot go below zero" guard is
 * evaluated inside the write transaction or against a snapshot taken before
 * it. A mocked `runInUnitOfWork` cannot tell those two apart.
 *
 * The household-wide ledger semantics (legacy backfill, rollover funding,
 * confirmation markers) are covered in `tests/realsql/savingsLedgerSemantics.ts`;
 * this file is the use case's own contract.
 */
jest.mock('expo-crypto', () => {
  let counter = 0;
  return { randomUUID: (): string => `random-uuid-${++counter}` };
});
// The "audit log throws" case below deliberately triggers `bestEffortAudit`'s
// error report; without this the real logger prints that stack as a failure.
jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from '../../../../tests/realsql/harness/openMigratedDb';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import { getPersistentEnvelopeSavedCents } from '../../../data/local/balances/EnvelopeBalanceQuery';
import type * as schema from '../../../data/local/schema';
import { AdjustSavedBalanceUseCase } from '../AdjustSavedBalanceUseCase';
import type { AdjustSavedBalanceInput } from '../AdjustSavedBalanceUseCase';

const HOUSEHOLD_ID = 'hh-adjust';
// After LEGACY_OPENING_BALANCE_CUTOFF, so nothing here is treated as a legacy
// envelope whose allocation would be backfilled into the ledger.
const NOW = '2026-10-01T00:00:00.000Z';
const PERIOD = '2026-10-01';
const R500 = 50_000;
const R10K = 1_000_000;

/** The column set migration 0016 froze — a new key pull-blocks 1.1.130 devices. */
const FROZEN_CONTRIBUTION_COLUMNS = [
  'amount_cents',
  'created_at',
  'deleted_at',
  'envelope_id',
  'household_id',
  'id',
  'period_start',
  'source',
  'updated_at',
];

function seedHousehold(raw: Database.Database): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 1, ?, ?)`,
    )
    .run(HOUSEHOLD_ID, NOW, NOW);
}

function seedEnvelope(
  raw: Database.Database,
  args: {
    id: string;
    envelopeType: string;
    householdId?: string;
    allocatedCents?: number;
    isArchived?: boolean;
    deletedAt?: string | null;
  },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'Emergency Fund', ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      args.householdId ?? HOUSEHOLD_ID,
      args.allocatedCents ?? 0,
      args.envelopeType,
      args.isArchived ? 1 : 0,
      PERIOD,
      NOW,
      NOW,
      args.deletedAt ?? null,
    );
}

/** Seeds a fund whose derived saved balance is `savedCents`, via a ledger row. */
function seedFundedEnvelope(raw: Database.Database, envelopeId: string, savedCents: number): void {
  seedEnvelope(raw, { id: envelopeId, envelopeType: 'emergency_fund' });
  if (savedCents === 0) return;
  raw
    .prepare(
      `INSERT INTO envelope_contributions
         (id, household_id, envelope_id, amount_cents, period_start, source, created_at, updated_at)
       VALUES ('seed-contribution', ?, ?, ?, ?, 'rollover', ?, ?)`,
    )
    .run(HOUSEHOLD_ID, envelopeId, savedCents, PERIOD, NOW, NOW);
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

/** A fresh use case whose oplog/contribution ids are predictable per test. */
function makeUseCase(db: ExpoSQLiteDatabase<typeof schema>): AdjustSavedBalanceUseCase {
  let counter = 0;
  return new AdjustSavedBalanceUseCase(db, new AuditLogger(db), {
    deviceId: 'device-1',
    actorUserId: 'user-1',
    clock: () => NOW,
    genId: () => `gen-${++counter}`,
  });
}

function input(overrides: Partial<AdjustSavedBalanceInput> = {}): AdjustSavedBalanceInput {
  return {
    householdId: HOUSEHOLD_ID,
    envelopeId: 'env-emf',
    deltaCents: R500,
    note: 'Moved in from the old savings account',
    periodStart: PERIOD,
    ...overrides,
  };
}

function countContributions(raw: Database.Database): number {
  return (raw.prepare('SELECT COUNT(*) AS n FROM envelope_contributions').get() as { n: number }).n;
}

function countOplog(raw: Database.Database): number {
  return (raw.prepare('SELECT COUNT(*) AS n FROM oplog').get() as { n: number }).n;
}

function countAuditEvents(raw: Database.Database): number {
  return (raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n;
}

describe('AdjustSavedBalanceUseCase', () => {
  describe('validation (nothing is written when the input is rejected)', () => {
    let raw: Database.Database;
    let db: ExpoSQLiteDatabase<typeof schema>;

    beforeEach(() => {
      raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', R500);
      db = makeDb(raw);
    });

    afterEach(() => raw.close());

    it('rejects a blank or whitespace-only reason', async () => {
      const result = await makeUseCase(db).execute(input({ note: '   ' }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('INVALID_NOTE');
      expect(countContributions(raw)).toBe(1); // only the seeded row
    });

    it('rejects a reason longer than 200 characters', async () => {
      const result = await makeUseCase(db).execute(input({ note: 'x'.repeat(201) }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('INVALID_NOTE');
      expect(countContributions(raw)).toBe(1);
    });

    it('accepts a reason of exactly 200 characters', async () => {
      const result = await makeUseCase(db).execute(input({ note: 'x'.repeat(200) }));

      expect(result.success).toBe(true);
    });

    it('rejects a zero delta — there is nothing to record', async () => {
      const result = await makeUseCase(db).execute(input({ deltaCents: 0 }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('INVALID_AMOUNT');
      expect(countContributions(raw)).toBe(1);
    });

    it('rejects a fractional delta — cents are whole numbers', async () => {
      const result = await makeUseCase(db).execute(input({ deltaCents: 12.5 }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('INVALID_AMOUNT');
    });

    it('returns NOT_FOUND for an envelope id that does not exist', async () => {
      const result = await makeUseCase(db).execute(input({ envelopeId: 'env-nope' }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND for an envelope belonging to another household', async () => {
      seedEnvelope(raw, {
        id: 'env-other',
        envelopeType: 'emergency_fund',
        householdId: 'hh-someone-else',
      });

      const result = await makeUseCase(db).execute(input({ envelopeId: 'env-other' }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND for a soft-deleted envelope', async () => {
      seedEnvelope(raw, {
        id: 'env-gone',
        envelopeType: 'savings',
        deletedAt: '2026-10-02T00:00:00.000Z',
      });

      const result = await makeUseCase(db).execute(input({ envelopeId: 'env-gone' }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_PERSISTENT for a period-scoped envelope, which holds no balance', async () => {
      seedEnvelope(raw, { id: 'env-groceries', envelopeType: 'spending' });

      const result = await makeUseCase(db).execute(input({ envelopeId: 'env-groceries' }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NOT_PERSISTENT');
      expect(countContributions(raw)).toBe(1);
    });

    it('returns NOT_PERSISTENT for an ARCHIVED fund', async () => {
      seedEnvelope(raw, { id: 'env-archived', envelopeType: 'sinking_fund', isArchived: true });

      const result = await makeUseCase(db).execute(input({ envelopeId: 'env-archived' }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NOT_PERSISTENT');
    });

    it('returns NEGATIVE_BALANCE when taking out more than the fund holds', async () => {
      const result = await makeUseCase(db).execute(input({ deltaCents: -(R500 + 1) }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NEGATIVE_BALANCE');
      // Not even an empty-transaction side effect: no row, no op, no audit.
      expect(countContributions(raw)).toBe(1);
      expect(countOplog(raw)).toBe(0);
      expect(countAuditEvents(raw)).toBe(0);
    });

    it('allows taking the fund to EXACTLY zero', async () => {
      const result = await makeUseCase(db).execute(input({ deltaCents: -R500 }));

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.savedCentsAfter).toBe(0);
    });

    it('counts non-deleted SPEND against the fund when deciding NEGATIVE_BALANCE', async () => {
      // The guard reads the DERIVED balance (contributions in, transactions
      // out), not a stored column — R500 contributed less R500 spent is R0.
      raw
        .prepare(
          `INSERT INTO transactions
             (id, household_id, envelope_id, amount_cents, transaction_date, created_at, updated_at)
           VALUES ('txn-1', ?, 'env-emf', ?, ?, ?, ?)`,
        )
        .run(HOUSEHOLD_ID, R500, PERIOD, NOW, NOW);

      const result = await makeUseCase(db).execute(input({ deltaCents: -1 }));

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error.code).toBe('NEGATIVE_BALANCE');
    });
  });

  describe('happy path', () => {
    it('writes exactly one contribution row, one oplog insert op and one audit event', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', 0);
      const db = makeDb(raw);

      const result = await makeUseCase(db).execute(input({ deltaCents: R10K }));

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.data.contributionId).toBe('gen-1');
      expect(result.data.savedCentsAfter).toBe(R10K);
      expect(await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID)).toEqual(
        new Map([['env-emf', R10K]]),
      );

      const rows = raw
        .prepare("SELECT * FROM envelope_contributions WHERE source = 'adjustment'")
        .all() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(FROZEN_CONTRIBUTION_COLUMNS);
      expect(rows[0]).toMatchObject({
        id: 'gen-1',
        household_id: HOUSEHOLD_ID,
        envelope_id: 'env-emf',
        amount_cents: R10K,
        period_start: PERIOD,
        source: 'adjustment',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      });

      const ops = raw.prepare('SELECT * FROM oplog').all() as {
        table_name: string;
        op_type: string;
        row_id: string;
        payload: string;
        device_id: string;
        actor_user_id: string | null;
      }[];
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        table_name: 'envelope_contributions',
        op_type: 'insert',
        row_id: 'gen-1',
        device_id: 'device-1',
        actor_user_id: 'user-1',
      });

      const audits = raw.prepare('SELECT * FROM audit_events').all() as {
        entity_type: string;
        entity_id: string;
        action: string;
        previous_value_json: string;
        new_value_json: string;
      }[];
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        entity_type: 'envelope_contribution',
        entity_id: 'gen-1',
        action: 'create',
      });
      expect(JSON.parse(audits[0].previous_value_json)).toEqual({ savedCents: 0 });
      expect(JSON.parse(audits[0].new_value_json)).toEqual({
        savedCents: R10K,
        envelopeId: 'env-emf',
        deltaCents: R10K,
        note: 'Moved in from the old savings account',
      });

      raw.close();
    });

    it('keeps the reason OUT of the synced row and its oplog payload (local audit only)', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', 0);
      const db = makeDb(raw);

      await makeUseCase(db).execute(input({ note: 'Cash under the mattress' }));

      const payload = (raw.prepare('SELECT payload AS p FROM oplog').get() as { p: string }).p;
      expect(Object.keys(JSON.parse(payload) as Record<string, unknown>).sort()).toEqual(
        FROZEN_CONTRIBUTION_COLUMNS.filter((column) => column !== 'deleted_at'),
      );
      expect(payload).not.toContain('Cash under the mattress');
      expect(payload).not.toContain('note');

      // …and it IS kept locally.
      const audited = (
        raw.prepare('SELECT new_value_json AS j FROM audit_events').get() as { j: string }
      ).j;
      expect((JSON.parse(audited) as { note: string }).note).toBe('Cash under the mattress');

      raw.close();
    });

    it('gives two identical same-day adjustments two DISTINCT random ids', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', 0);
      const db = makeDb(raw);
      const useCase = makeUseCase(db);

      const first = await useCase.execute(input());
      const second = await useCase.execute(input());

      expect(first.success && second.success).toBe(true);
      if (!first.success || !second.success) throw new Error('unreachable');
      expect(first.data.contributionId).not.toBe(second.data.contributionId);
      expect(second.data.savedCentsAfter).toBe(R500 * 2);
      expect(countContributions(raw)).toBe(2);

      raw.close();
    });

    it('still succeeds when the audit log throws — the ledger write has committed', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', 0);
      const db = makeDb(raw);
      const audit = {
        log: jest.fn().mockRejectedValue(new Error('audit table is gone')),
      } as unknown as AuditLogger;

      const result = await new AdjustSavedBalanceUseCase(db, audit, {
        deviceId: 'device-1',
        clock: () => NOW,
        genId: () => 'gen-1',
      }).execute(input());

      expect(result.success).toBe(true);
      expect(countContributions(raw)).toBe(1);

      raw.close();
    });
  });

  describe('stale-snapshot regression: the balance check runs inside the write transaction', () => {
    it('fails the second of two sequential take-outs that together exceed the balance', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', R500);
      const db = makeDb(raw);
      const useCase = makeUseCase(db);

      const first = await useCase.execute(input({ deltaCents: -(R500 - 1) }));
      const second = await useCase.execute(input({ deltaCents: -R500 }));

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      if (second.success) throw new Error('unreachable');
      expect(second.error.code).toBe('NEGATIVE_BALANCE');
      expect(await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID)).toEqual(
        new Map([['env-emf', 1]]),
      );

      raw.close();
    });

    // The bug this use case had: the derived balance was read and tested
    // BEFORE the write transaction opened, so two adjustments issued back to
    // back — a double-tapped "take out" button — both measured the same
    // pre-adjustment balance, both passed the >= 0 check, and both inserted.
    // Interleaving them here (each one's async envelope/balance reads run
    // before either transaction opens) is what reproduces that; with the read
    // moved inside the unit of work, the loser sees the winner's row.
    it('fails ONE of two CONCURRENT take-outs that together exceed the balance', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw);
      seedFundedEnvelope(raw, 'env-emf', R500);
      const db = makeDb(raw);

      const results = await Promise.all([
        makeUseCase(db).execute(input({ deltaCents: -R500, note: 'Vet bill' })),
        makeUseCase(db).execute(input({ deltaCents: -R500, note: 'Tyres' })),
      ]);

      expect(results.filter((result) => result.success)).toHaveLength(1);
      const failed = results.find((result) => !result.success);
      expect(failed).toBeDefined();
      if (!failed || failed.success) throw new Error('unreachable');
      expect(failed.error.code).toBe('NEGATIVE_BALANCE');

      // The fund is at zero, never below it, and only one adjustment row exists.
      expect(await getPersistentEnvelopeSavedCents(db, HOUSEHOLD_ID)).toEqual(
        new Map([['env-emf', 0]]),
      );
      expect(
        (
          raw
            .prepare("SELECT COUNT(*) AS n FROM envelope_contributions WHERE source = 'adjustment'")
            .get() as { n: number }
        ).n,
      ).toBe(1);

      raw.close();
    });
  });
});

/**
 * Direct unit coverage for MoveAllocationUseCase (VAL2-9, "cover it from
 * another envelope") — previously only exercised indirectly through
 * AddTransactionScreen.coverFromEnvelope.test.tsx. Uses a REAL migrated
 * better-sqlite3 db (see tests/realsql/harness/openMigratedDb.ts) because the
 * use case issues raw selects and its atomic write goes through
 * `runInUnitOfWork`/`updateRowWithinUow`, which need a real sync-mode SQLite
 * transaction to prove atomicity — a mocked `db` would hide a rollback bug.
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from '../../../../tests/realsql/harness/openMigratedDb';
import { MoveAllocationUseCase } from '../MoveAllocationUseCase';
import { AuditLogger } from '../../../data/audit/AuditLogger';
import type * as schema from '../../../data/local/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const PERIOD = '2026-01-01';
const HOUSEHOLD_ID = 'hh-1';
const OTHER_HOUSEHOLD_ID = 'hh-2';

function openDb(): { raw: Database.Database; db: ExpoSQLiteDatabase<typeof schema> } {
  const raw = openMigratedDb();
  const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
  return { raw, db };
}

function seedHousehold(raw: Database.Database, id: string): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 25, ?, ?)`,
    )
    .run(id, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  householdId: string;
  envelopeType?: string;
  periodStart?: string;
  allocatedCents?: number;
  isArchived?: boolean;
  deletedAt?: string | null;
}

function seedEnvelope(raw: Database.Database, args: SeedEnvelopeArgs): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      args.householdId,
      args.id,
      args.allocatedCents ?? 50000,
      args.envelopeType ?? 'spending',
      args.isArchived ? 1 : 0,
      args.periodStart ?? PERIOD,
      NOW,
      NOW,
      args.deletedAt ?? null,
    );
}

function seedTransaction(
  raw: Database.Database,
  args: { id: string; householdId: string; envelopeId: string; amountCents: number },
): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, description, transaction_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'test', ?, ?, ?)`,
    )
    .run(args.id, args.householdId, args.envelopeId, args.amountCents, PERIOD, NOW, NOW);
}

function envelopeRow(raw: Database.Database, id: string): { allocated_cents: number } {
  return raw.prepare('SELECT allocated_cents FROM envelopes WHERE id = ?').get(id) as {
    allocated_cents: number;
  };
}

function oplogUpdateCount(raw: Database.Database, householdId: string): number {
  return (
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM oplog WHERE table_name = 'envelopes' AND op_type = 'update' AND household_id = ?",
      )
      .get(householdId) as { n: number }
  ).n;
}

function makeUseCase(
  db: ExpoSQLiteDatabase<typeof schema>,
  overrides: Record<string, unknown> = {},
) {
  return new MoveAllocationUseCase(db, new AuditLogger(db), {
    deviceId: 'device-1',
    actorUserId: 'user-1',
    clock: () => NOW,
    ...overrides,
  });
}

describe('MoveAllocationUseCase', () => {
  it('happy path: moves allocation atomically, conserves the total, and enqueues an outbox op for both rows', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });
    const totalBefore = 50000 + 20000;

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 15000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromAllocatedCents).toBe(35000);
      expect(result.data.toAllocatedCents).toBe(35000);
    }

    const fromRow = envelopeRow(raw, 'env-from');
    const toRow = envelopeRow(raw, 'env-to');
    expect(fromRow.allocated_cents).toBe(35000);
    expect(toRow.allocated_cents).toBe(35000);
    // The move is a transfer, not a mint/burn: the household total is unchanged.
    expect(fromRow.allocated_cents + toRow.allocated_cents).toBe(totalBefore);

    // Both writes appended their own oplog (outbox) row — no batching/merging.
    expect(oplogUpdateCount(raw, HOUSEHOLD_ID)).toBe(2);
    const opRows = raw
      .prepare(
        "SELECT row_id FROM oplog WHERE table_name = 'envelopes' AND op_type = 'update' AND household_id = ? ORDER BY row_id",
      )
      .all(HOUSEHOLD_ID) as { row_id: string }[];
    expect(opRows.map((r) => r.row_id).sort()).toEqual(['env-from', 'env-to']);

    raw.close();
  });

  it('allows a move exactly equal to the source unspent balance (boundary)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });
    seedTransaction(raw, {
      id: 'txn-1',
      householdId: HOUSEHOLD_ID,
      envelopeId: 'env-from',
      amountCents: 45000,
    });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 5000,
    });

    expect(result.success).toBe(true);
    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(45000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(25000);

    raw.close();
  });

  describe('amount validation', () => {
    it.each([
      ['zero', 0],
      ['negative', -100],
      ['non-integer cents', 12.5],
      ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s amounts with INVALID_AMOUNT and moves nothing', async (_label, amountCents) => {
      const { raw, db } = openDb();
      seedHousehold(raw, HOUSEHOLD_ID);
      seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
      seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

      const result = await makeUseCase(db).execute({
        householdId: HOUSEHOLD_ID,
        periodStart: PERIOD,
        fromEnvelopeId: 'env-from',
        toEnvelopeId: 'env-to',
        amountCents,
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
      expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);
      expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(20000);
      expect(oplogUpdateCount(raw, HOUSEHOLD_ID)).toBe(0);

      raw.close();
    });
  });

  it('rejects a move larger than the source envelope UNSPENT amount (INSUFFICIENT_UNSPENT)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });
    // 50000 allocated - 45000 spent = 5000 unspent; asking for 6000 must fail.
    seedTransaction(raw, {
      id: 'txn-1',
      householdId: HOUSEHOLD_ID,
      envelopeId: 'env-from',
      amountCents: 45000,
    });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 6000,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INSUFFICIENT_UNSPENT');
      expect(result.error.context).toEqual({ fromUnspentCents: 5000 });
    }
    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(20000);

    raw.close();
  });

  it('rejects moving an envelope to itself (SAME_ENVELOPE) before touching the db', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-from',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SAME_ENVELOPE');
    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);

    raw.close();
  });

  it('rejects when the target envelope belongs to a DIFFERENT household (ENVELOPE_NOT_FOUND)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedHousehold(raw, OTHER_HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    // Same id namespace, wrong household — the query filters on
    // `householdId`, so this row must not be reachable from HOUSEHOLD_ID.
    seedEnvelope(raw, { id: 'env-to', householdId: OTHER_HOUSEHOLD_ID, allocatedCents: 20000 });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(20000);

    raw.close();
  });

  it('rejects when either envelope does not exist in the household (ENVELOPE_NOT_FOUND)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-missing',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');

    raw.close();
  });

  it('rejects when the target envelope is SOFT-DELETED (treated as not found, not resurrected)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, {
      id: 'env-to',
      householdId: HOUSEHOLD_ID,
      allocatedCents: 20000,
      deletedAt: '2026-02-01T00:00:00.000Z',
    });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(20000);

    raw.close();
  });

  it('rejects when either envelope is ARCHIVED (ENVELOPE_ARCHIVED)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, {
      id: 'env-to',
      householdId: HOUSEHOLD_ID,
      allocatedCents: 20000,
      isArchived: true,
    });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_ARCHIVED');

    raw.close();
  });

  it('rejects when either envelope is an INCOME envelope (INVALID_ENVELOPE_TYPE)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-from',
      householdId: HOUSEHOLD_ID,
      allocatedCents: 50000,
      envelopeType: 'income',
    });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_ENVELOPE_TYPE');

    raw.close();
  });

  it('rejects when either envelope is PERSISTENT-scoped, e.g. a sinking fund (INVALID_ENVELOPE_SCOPE)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-from',
      householdId: HOUSEHOLD_ID,
      allocatedCents: 50000,
      envelopeType: 'sinking_fund',
    });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_ENVELOPE_SCOPE');

    raw.close();
  });

  it('rejects when either envelope belongs to a DIFFERENT budget period (PERIOD_MISMATCH)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-from',
      householdId: HOUSEHOLD_ID,
      allocatedCents: 50000,
      periodStart: '2025-12-01',
    });
    seedEnvelope(raw, {
      id: 'env-to',
      householdId: HOUSEHOLD_ID,
      allocatedCents: 20000,
      periodStart: PERIOD,
    });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 100,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('PERIOD_MISMATCH');

    raw.close();
  });

  // Proves the two `allocated_cents` UPDATEs are ONE atomic transaction: a
  // failure on the second write (here, a duplicate oplog op_id primary-key
  // collision — the same fault shape confirmSlipAtomicity.test.ts uses for
  // ConfirmSlipUseCase) must roll back the first write too, leaving neither
  // envelope's allocation moved.
  it('rolls back BOTH allocation writes when the second write fails mid-transaction', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

    // Pre-seed an oplog row occupying the op_id the second update's append
    // will reuse, so its `INSERT INTO oplog` hits a PRIMARY KEY conflict
    // AFTER the first update already ran inside the SAME still-open
    // transaction.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
         VALUES ('dup-op', 'hh-other', 'envelopes', 'other-row', 'update', '{}', 'device-0', ?)`,
      )
      .run(NOW);

    let genIdCalls = 0;
    const useCase = makeUseCase(db, {
      genId: () => {
        genIdCalls += 1;
        return genIdCalls === 1 ? 'op-from' : 'dup-op';
      },
    });

    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 15000,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('MOVE_FAILED');

    // Neither envelope's allocation moved — true all-or-nothing rollback.
    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(20000);

    // The first update's oplog append was rolled back along with the second's.
    expect(raw.prepare("SELECT * FROM oplog WHERE op_id = 'op-from'").get()).toBeUndefined();
    const preSeeded = raw.prepare("SELECT * FROM oplog WHERE op_id = 'dup-op'").get() as {
      row_id: string;
    };
    expect(preSeeded.row_id).toBe('other-row');

    raw.close();
  });

  it('writes a bestEffortAudit entry recording both before/after allocation values', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

    const result = await makeUseCase(db).execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 15000,
    });
    expect(result.success).toBe(true);

    const auditRow = raw
      .prepare("SELECT * FROM audit_events WHERE household_id = ? AND action = 'move_allocation'")
      .get(HOUSEHOLD_ID) as { previous_value_json: string; new_value_json: string };
    expect(auditRow).toBeDefined();
    const previous = JSON.parse(auditRow.previous_value_json);
    const next = JSON.parse(auditRow.new_value_json);
    expect(previous).toEqual({
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      fromAllocatedCents: 50000,
      toAllocatedCents: 20000,
    });
    expect(next).toEqual({
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      fromAllocatedCents: 35000,
      toAllocatedCents: 35000,
      amountCents: 15000,
    });

    raw.close();
  });
});

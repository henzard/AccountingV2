/**
 * Real-driver proof for MoveAllocationUseCase (VAL2-9, "cover it from another
 * envelope"): two absolute-value `envelopes.allocated_cents` updates must
 * commit or roll back together, exactly like ConfirmSlipUseCase's N-item
 * write (see tests/realsql/confirmSlipAtomicity.test.ts, the model this file
 * follows) — a mocked `db.transaction` would hide a non-atomic bug because
 * expo-sqlite's real driver runs its transaction callback in SYNC mode.
 */
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { MoveAllocationUseCase } from '../../src/domain/envelopes/MoveAllocationUseCase';
import { AuditLogger } from '../../src/data/audit/AuditLogger';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-01-01T00:00:00.000Z';
const PERIOD = '2026-01-01';
const HOUSEHOLD_ID = 'hh-1';

function openDb(): { raw: Database.Database; db: ExpoSQLiteDatabase<typeof schema> } {
  const raw = openMigratedDb();
  const db = drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
  return { raw, db };
}

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  householdId: string;
  envelopeType?: string;
  periodStart?: string;
  allocatedCents?: number;
  isArchived?: boolean;
}

function seedEnvelope(db: Database.Database, args: SeedEnvelopeArgs): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(
    args.id,
    args.householdId,
    args.id,
    args.allocatedCents ?? 50000,
    args.envelopeType ?? 'spending',
    args.isArchived ? 1 : 0,
    args.periodStart ?? PERIOD,
    NOW,
    NOW,
  );
}

function seedTransaction(
  db: Database.Database,
  args: { id: string; householdId: string; envelopeId: string; amountCents: number },
): void {
  db.prepare(
    `INSERT INTO transactions
       (id, household_id, envelope_id, amount_cents, description, transaction_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?)`,
  ).run(args.id, args.householdId, args.envelopeId, args.amountCents, PERIOD, NOW, NOW);
}

function envelopeRow(raw: Database.Database, id: string): { allocated_cents: number } {
  return raw.prepare('SELECT allocated_cents FROM envelopes WHERE id = ?').get(id) as {
    allocated_cents: number;
  };
}

function count(raw: Database.Database, sql: string, ...params: unknown[]): number {
  return (raw.prepare(sql).get(...params) as { n: number }).n;
}

describe('MoveAllocationUseCase (real SQLite, VAL2-9)', () => {
  it('happy path: moves the shortfall from one envelope to another in one transaction', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    const result = await useCase.execute({
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

    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(35000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(35000);

    expect(
      count(
        raw,
        "SELECT COUNT(*) AS n FROM oplog WHERE table_name = 'envelopes' AND op_type = 'update' AND household_id = ?",
        HOUSEHOLD_ID,
      ),
    ).toBe(2);

    raw.close();
  });

  it('rolls back BOTH writes when the second update fails mid-transaction', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });

    // Pre-seed an oplog row occupying the op_id the second update's append
    // will reuse, so the second `INSERT INTO oplog` hits a PRIMARY KEY
    // conflict — AFTER the first update has already run inside the SAME
    // still-open transaction. Exactly the shape confirmSlipAtomicity.test.ts
    // uses to prove ConfirmSlipUseCase's all-or-nothing guarantee.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, device_id, client_created_at)
         VALUES ('dup-op', 'hh-other', 'envelopes', 'other-row', 'update', '{}', 'device-0', ?)`,
      )
      .run(NOW);

    let genIdCalls = 0;
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
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

  it("rejects a move larger than the source envelope's UNSPENT amount", async () => {
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

    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    // Unspent is only 5000 (50000 allocated - 45000 spent); asking for 6000 must fail.
    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-to',
      amountCents: 6000,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INSUFFICIENT_UNSPENT');

    expect(envelopeRow(raw, 'env-from').allocated_cents).toBe(50000);
    expect(envelopeRow(raw, 'env-to').allocated_cents).toBe(20000);

    raw.close();
  });

  it('allows a move exactly equal to UNSPENT (boundary) and balances correctly', async () => {
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

    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    const result = await useCase.execute({
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

  it('rejects a non-positive or non-integer amount', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    for (const amountCents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await useCase.execute({
        householdId: HOUSEHOLD_ID,
        periodStart: PERIOD,
        fromEnvelopeId: 'env-from',
        toEnvelopeId: 'env-to',
        amountCents,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('INVALID_AMOUNT');
    }

    raw.close();
  });

  it('rejects moving to the same envelope', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      periodStart: PERIOD,
      fromEnvelopeId: 'env-from',
      toEnvelopeId: 'env-from',
      amountCents: 100,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('SAME_ENVELOPE');

    raw.close();
  });

  it('rejects when either envelope does not exist in the household', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    const result = await useCase.execute({
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

  it('rejects when either envelope is archived', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, isArchived: true });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    const result = await useCase.execute({
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

  it('rejects when either envelope is an income envelope', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, envelopeType: 'income' });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    const result = await useCase.execute({
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

  it('rejects when either envelope is persistent-scoped (sinking fund / savings / etc.)', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, envelopeType: 'sinking_fund' });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    const result = await useCase.execute({
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

  it('rejects when either envelope belongs to a different period', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, periodStart: '2025-12-01' });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, periodStart: PERIOD });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), { clock: () => NOW });

    const result = await useCase.execute({
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

  it('writes a bestEffortAudit entry with both before/after allocation values', async () => {
    const { raw, db } = openDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, { id: 'env-from', householdId: HOUSEHOLD_ID, allocatedCents: 50000 });
    seedEnvelope(raw, { id: 'env-to', householdId: HOUSEHOLD_ID, allocatedCents: 20000 });
    const useCase = new MoveAllocationUseCase(db, new AuditLogger(db), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      clock: () => NOW,
    });

    const result = await useCase.execute({
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
    expect(previous.fromAllocatedCents).toBe(50000);
    expect(previous.toAllocatedCents).toBe(20000);
    expect(next.fromAllocatedCents).toBe(35000);
    expect(next.toAllocatedCents).toBe(35000);

    raw.close();
  });
});

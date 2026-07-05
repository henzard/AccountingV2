import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { StartNewPeriodUseCase } from '../../src/domain/budgets/StartNewPeriodUseCase';
import { DrizzleEnvelopeRepository } from '../../src/data/repositories/DrizzleEnvelopeRepository';
import { uuidv5, APP_NAMESPACE } from '../../src/infrastructure/crypto/uuidv5';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-07-01T00:00:00.000Z';
const FROM_PERIOD = '2026-07-01';
const TO_PERIOD = '2026-08-01';
const HOUSEHOLD_ID = 'hh-1';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  householdId: string;
  name: string;
  envelopeType: string;
  periodStart: string;
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
    args.name,
    args.allocatedCents ?? 50000,
    args.envelopeType,
    args.isArchived ? 1 : 0,
    args.periodStart,
    NOW,
    NOW,
  );
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

interface EnvelopeRow {
  id: string;
  name: string;
  allocated_cents: number;
  envelope_type: string;
  period_start: string;
  is_archived: number;
}

describe('StartNewPeriodUseCase (real SQLite)', () => {
  it('copies period-scoped envelopes forward, skips persistent and archived envelopes', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-groceries',
      householdId: HOUSEHOLD_ID,
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      allocatedCents: 45000,
    });
    seedEnvelope(raw, {
      id: 'env-sinking',
      householdId: HOUSEHOLD_ID,
      name: 'Roof Fund',
      envelopeType: 'sinking_fund',
      periodStart: FROM_PERIOD,
      allocatedCents: 100000,
    });
    seedEnvelope(raw, {
      id: 'env-archived',
      householdId: HOUSEHOLD_ID,
      name: 'Old Gym Membership',
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      isArchived: true,
    });

    const db = makeDb(raw);
    const useCase = new StartNewPeriodUseCase(db, { deviceId: 'device-1', actorUserId: 'user-1' });

    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.count).toBe(1);

    const expectedId = uuidv5(`${HOUSEHOLD_ID}:${TO_PERIOD}:env-groceries`, APP_NAMESPACE);
    const copied = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get(expectedId) as
      | EnvelopeRow
      | undefined;
    expect(copied).toBeTruthy();
    expect(copied?.name).toBe('Groceries');
    expect(copied?.allocated_cents).toBe(45000);
    expect(copied?.envelope_type).toBe('spending');
    expect(copied?.period_start).toBe(TO_PERIOD);
    expect(copied?.is_archived).toBe(0);

    // Derived spend is 0 — no transactions exist yet in the new period.
    const repo = new DrizzleEnvelopeRepository(db);
    const newPeriodEnvelopes = await repo.listByHousehold(HOUSEHOLD_ID, TO_PERIOD);
    const copiedEntity = newPeriodEnvelopes.find((e) => e.id === expectedId);
    expect(copiedEntity?.spentCents).toBe(0);

    // The persistent envelope was never duplicated — still exactly one row.
    const sinkingRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'sinking_fund'")
      .all() as EnvelopeRow[];
    expect(sinkingRows).toHaveLength(1);
    expect(sinkingRows[0].id).toBe('env-sinking');

    // The archived envelope was not copied into the new period.
    const toPeriodRows = raw
      .prepare('SELECT * FROM envelopes WHERE period_start = ?')
      .all(TO_PERIOD) as EnvelopeRow[];
    expect(toPeriodRows).toHaveLength(1);
    expect(toPeriodRows.some((r) => r.name === 'Old Gym Membership')).toBe(false);

    // Exactly one oplog insert op was appended for the one envelope copied.
    const insertOps = raw
      .prepare("SELECT * FROM oplog WHERE table_name = 'envelopes' AND op_type = 'insert'")
      .all() as { row_id: string }[];
    expect(insertOps).toHaveLength(1);
    expect(insertOps[0].row_id).toBe(expectedId);

    raw.close();
  });

  it('is idempotent: running execute twice yields the same target id and no duplicate rows/ops', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-groceries',
      householdId: HOUSEHOLD_ID,
      name: 'Groceries',
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      allocatedCents: 45000,
    });
    seedEnvelope(raw, {
      id: 'env-utility',
      householdId: HOUSEHOLD_ID,
      name: 'Electricity',
      envelopeType: 'utility',
      periodStart: FROM_PERIOD,
      allocatedCents: 8000,
    });

    const db = makeDb(raw);
    const useCase = new StartNewPeriodUseCase(db, { deviceId: 'device-1', actorUserId: 'user-1' });

    const firstRun = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });
    expect(firstRun.success).toBe(true);
    if (!firstRun.success) throw new Error('unreachable');
    expect(firstRun.data.count).toBe(2);

    const secondRun = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });
    expect(secondRun.success).toBe(true);
    if (!secondRun.success) throw new Error('unreachable');
    // Every target id already exists from the first run — nothing new to copy.
    expect(secondRun.data.count).toBe(0);

    const groceriesId = uuidv5(`${HOUSEHOLD_ID}:${TO_PERIOD}:env-groceries`, APP_NAMESPACE);
    const utilityId = uuidv5(`${HOUSEHOLD_ID}:${TO_PERIOD}:env-utility`, APP_NAMESPACE);

    const groceriesRows = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .all(groceriesId) as EnvelopeRow[];
    expect(groceriesRows).toHaveLength(1);

    const utilityRows = raw
      .prepare('SELECT * FROM envelopes WHERE id = ?')
      .all(utilityId) as EnvelopeRow[];
    expect(utilityRows).toHaveLength(1);

    const totalToPeriodRows = raw
      .prepare('SELECT COUNT(*) AS n FROM envelopes WHERE period_start = ?')
      .get(TO_PERIOD) as { n: number };
    expect(totalToPeriodRows.n).toBe(2);

    // Still exactly one insert op per envelope — the second run appended none.
    const insertOps = raw
      .prepare("SELECT * FROM oplog WHERE table_name = 'envelopes' AND op_type = 'insert'")
      .all() as { row_id: string }[];
    expect(insertOps).toHaveLength(2);

    raw.close();
  });

  it('returns count 0 and copies nothing when there are no period-scoped envelopes to roll over', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-sinking-only',
      householdId: HOUSEHOLD_ID,
      name: 'Roof Fund',
      envelopeType: 'sinking_fund',
      periodStart: FROM_PERIOD,
    });

    const db = makeDb(raw);
    const useCase = new StartNewPeriodUseCase(db, { deviceId: 'device-1', actorUserId: 'user-1' });

    const result = await useCase.execute({
      householdId: HOUSEHOLD_ID,
      fromPeriodStart: FROM_PERIOD,
      toPeriodStart: TO_PERIOD,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    expect(result.data.count).toBe(0);

    const toPeriodRows = raw
      .prepare('SELECT COUNT(*) AS n FROM envelopes WHERE period_start = ?')
      .get(TO_PERIOD) as { n: number };
    expect(toPeriodRows.n).toBe(0);

    raw.close();
  });

  // M14 (2026-07-05 audit) real-driver proof: the old implementation called
  // `repo.insert(row, ctx)` per envelope inside a `forEach`, and
  // `createSyncedRepo.insert` opens its OWN `runInUnitOfWork` per call — N
  // envelopes meant N independent SQLite transactions, so a throw partway
  // through left the earlier envelopes permanently committed (a partial
  // rollover). The fix batches every copy into ONE `runInUnitOfWork` call
  // using `insertRowWithinUow`, mirroring `ConfirmSlipUseCase`. This test
  // forces a real mid-transaction failure against the ACTUAL better-sqlite3
  // driver (not a mock) by making the copy's own oplog op_id generator
  // collide with a pre-seeded oplog row, and asserts NOTHING from the whole
  // rollover persisted.
  it('rolls back ALL copies when a later insert fails mid-transaction (all-or-nothing, M14)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw, {
      id: 'env-a',
      householdId: HOUSEHOLD_ID,
      name: 'Envelope A',
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      allocatedCents: 10000,
    });
    seedEnvelope(raw, {
      id: 'env-b',
      householdId: HOUSEHOLD_ID,
      name: 'Envelope B',
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      allocatedCents: 20000,
    });
    seedEnvelope(raw, {
      id: 'env-c',
      householdId: HOUSEHOLD_ID,
      name: 'Envelope C',
      envelopeType: 'spending',
      periodStart: FROM_PERIOD,
      allocatedCents: 30000,
    });

    // Pre-seed an oplog row whose op_id ('op-2') collides with the SECOND
    // op id the use case will generate below — that envelope's row INSERT
    // succeeds, but the immediately-following `appendOp` throws a real
    // UNIQUE-constraint violation (op_id is the oplog PRIMARY KEY), partway
    // through the single transaction.
    raw
      .prepare(
        `INSERT INTO oplog (op_id, household_id, table_name, row_id, op_type, payload, actor_user_id, device_id, client_created_at)
         VALUES ('op-2', ?, 'envelopes', 'pre-existing-row', 'insert', '{}', NULL, 'device-x', ?)`,
      )
      .run(HOUSEHOLD_ID, NOW);

    const db = makeDb(raw);
    let opCounter = 0;
    const useCase = new StartNewPeriodUseCase(db, {
      deviceId: 'device-1',
      actorUserId: 'user-1',
      genId: () => `op-${++opCounter}`,
    });

    await expect(
      useCase.execute({
        householdId: HOUSEHOLD_ID,
        fromPeriodStart: FROM_PERIOD,
        toPeriodStart: TO_PERIOD,
      }),
    ).rejects.toBeTruthy();

    // NONE of the three envelopes were copied forward — all-or-nothing, not
    // "the first one or two committed before the throw".
    const toPeriodRows = raw
      .prepare('SELECT COUNT(*) AS n FROM envelopes WHERE period_start = ?')
      .get(TO_PERIOD) as { n: number };
    expect(toPeriodRows.n).toBe(0);

    // No oplog insert op for any of the three copies leaked either — the
    // entity rows and their oplog ops share one rolled-back transaction.
    const idA = uuidv5(`${HOUSEHOLD_ID}:${TO_PERIOD}:env-a`, APP_NAMESPACE);
    const idB = uuidv5(`${HOUSEHOLD_ID}:${TO_PERIOD}:env-b`, APP_NAMESPACE);
    const idC = uuidv5(`${HOUSEHOLD_ID}:${TO_PERIOD}:env-c`, APP_NAMESPACE);
    const leaked = raw.prepare('SELECT * FROM oplog WHERE row_id IN (?, ?, ?)').all(idA, idB, idC);
    expect(leaked).toHaveLength(0);

    raw.close();
  });
});

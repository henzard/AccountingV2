import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { CreateEnvelopeUseCase } from '../../src/domain/envelopes/CreateEnvelopeUseCase';
import { AuditLogger } from '../../src/data/audit/AuditLogger';
import type * as schema from '../../src/data/local/schema';

const NOW = '2026-07-01T00:00:00.000Z';
const PERIOD_START = '2026-07-01';
const HOUSEHOLD_A = 'hh-a';
const HOUSEHOLD_B = 'hh-b';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface SeedEnvelopeArgs {
  id: string;
  householdId: string;
  envelopeType: string;
  isArchived?: boolean;
  deletedAt?: string | null;
}

function seedEnvelope(db: Database.Database, args: SeedEnvelopeArgs): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'Emergency Fund', 500000, ?, 1, ?, ?, ?, ?, ?)`,
  ).run(
    args.id,
    args.householdId,
    args.envelopeType,
    args.isArchived ? 1 : 0,
    PERIOD_START,
    NOW,
    NOW,
    args.deletedAt ?? null,
  );
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

interface EnvelopeRow {
  id: string;
  envelope_type: string;
  is_archived: number;
  deleted_at: string | null;
}

interface OplogRow {
  row_id: string;
  op_type: string;
  table_name: string;
}

describe('CreateEnvelopeUseCase — emergency_fund create-time duplicate guard (real SQLite)', () => {
  it('fails with DUPLICATE_EMERGENCY_FUND and does not insert or append an oplog op when an active EMF already exists', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_A);
    seedEnvelope(raw, {
      id: 'env-emf-existing',
      householdId: HOUSEHOLD_A,
      envelopeType: 'emergency_fund',
    });

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        name: 'Emergency Fund (dup)',
        allocatedCents: 250000,
        envelopeType: 'emergency_fund',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-2', actorUserId: 'user-2' },
    );

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('DUPLICATE_EMERGENCY_FUND');

    const emfRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
      .all() as EnvelopeRow[];
    expect(emfRows).toHaveLength(1);
    expect(emfRows[0].id).toBe('env-emf-existing');

    const insertOps = raw
      .prepare("SELECT * FROM oplog WHERE table_name = 'envelopes' AND op_type = 'insert'")
      .all() as OplogRow[];
    expect(insertOps).toHaveLength(0);

    const auditRows = raw.prepare('SELECT * FROM audit_events').all();
    expect(auditRows).toHaveLength(0);

    raw.close();
  });

  it('succeeds creating an emergency_fund in a different household even when one exists elsewhere', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_A);
    seedHousehold(raw, HOUSEHOLD_B);
    seedEnvelope(raw, {
      id: 'env-emf-a',
      householdId: HOUSEHOLD_A,
      envelopeType: 'emergency_fund',
    });

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_B,
        name: 'Emergency Fund',
        allocatedCents: 300000,
        envelopeType: 'emergency_fund',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);

    const emfRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
      .all() as EnvelopeRow[];
    expect(emfRows).toHaveLength(2);
    expect(emfRows.some((r) => r.id === 'env-emf-a')).toBe(true);

    raw.close();
  });

  it('does not block on an archived existing EMF', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_A);
    seedEnvelope(raw, {
      id: 'env-emf-archived',
      householdId: HOUSEHOLD_A,
      envelopeType: 'emergency_fund',
      isArchived: true,
    });

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        name: 'New Emergency Fund',
        allocatedCents: 300000,
        envelopeType: 'emergency_fund',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);

    const emfRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
      .all() as EnvelopeRow[];
    expect(emfRows).toHaveLength(2);

    raw.close();
  });

  it('does not block on a soft-deleted existing EMF (deleted_at set)', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_A);
    seedEnvelope(raw, {
      id: 'env-emf-deleted',
      householdId: HOUSEHOLD_A,
      envelopeType: 'emergency_fund',
      deletedAt: NOW,
    });

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        name: 'New Emergency Fund',
        allocatedCents: 300000,
        envelopeType: 'emergency_fund',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    );

    const result = await uc.execute();

    expect(result.success).toBe(true);

    const emfRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
      .all() as EnvelopeRow[];
    expect(emfRows).toHaveLength(2);

    raw.close();
  });

  it('allows creating multiple non-EMF envelopes (spending, sinking_fund) unaffected by the guard', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_A);
    seedEnvelope(raw, {
      id: 'env-emf-existing',
      householdId: HOUSEHOLD_A,
      envelopeType: 'emergency_fund',
    });

    const db = makeDb(raw);
    const audit = new AuditLogger(db);

    const spendingResult = await new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        name: 'Groceries',
        allocatedCents: 100000,
        envelopeType: 'spending',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    ).execute();

    const sinking1 = await new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        name: 'Roof Fund',
        allocatedCents: 100000,
        envelopeType: 'sinking_fund',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    ).execute();

    const sinking2 = await new CreateEnvelopeUseCase(
      db,
      audit,
      {
        householdId: HOUSEHOLD_A,
        name: 'Car Fund',
        allocatedCents: 100000,
        envelopeType: 'sinking_fund',
        periodStart: PERIOD_START,
      },
      { deviceId: 'device-1', actorUserId: 'user-1' },
    ).execute();

    expect(spendingResult.success).toBe(true);
    expect(sinking1.success).toBe(true);
    expect(sinking2.success).toBe(true);

    const sinkingRows = raw
      .prepare("SELECT * FROM envelopes WHERE envelope_type = 'sinking_fund'")
      .all() as EnvelopeRow[];
    expect(sinkingRows).toHaveLength(2);

    raw.close();
  });

  describe('same-device race — partial unique index backstop (0013_emf_unique.sql)', () => {
    it('the DB itself rejects a second active emergency_fund row for one household with a UNIQUE constraint violation', () => {
      const raw = openMigratedDb();
      seedHousehold(raw, HOUSEHOLD_A);
      seedEnvelope(raw, {
        id: 'env-emf-first',
        householdId: HOUSEHOLD_A,
        envelopeType: 'emergency_fund',
      });

      // Proves the index, independent of any application code: a second
      // raw INSERT of an active emergency_fund for the SAME household is
      // rejected at the DB layer, not merely by CreateEnvelopeUseCase's
      // pre-check.
      expect(() =>
        seedEnvelope(raw, {
          id: 'env-emf-second',
          householdId: HOUSEHOLD_A,
          envelopeType: 'emergency_fund',
        }),
      ).toThrow(/UNIQUE constraint failed/);

      const emfRows = raw
        .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
        .all() as EnvelopeRow[];
      expect(emfRows).toHaveLength(1);

      raw.close();
    });

    it('CreateEnvelopeUseCase returns DUPLICATE_EMERGENCY_FUND (not a throw) when its pre-check races past a concurrent insert and the DB rejects the INSERT', async () => {
      const raw = openMigratedDb();
      seedHousehold(raw, HOUSEHOLD_A);
      // Simulates the winner of the race: an active EMF already landed in
      // the real DB before this execute() call's own pre-check ran.
      seedEnvelope(raw, {
        id: 'env-emf-race-winner',
        householdId: HOUSEHOLD_A,
        envelopeType: 'emergency_fund',
      });

      const db = makeDb(raw);
      const audit = new AuditLogger(db);

      // Stubs out just the pre-check's `select` chain to return NO existing
      // rows — standing in for the TOCTOU window where this call's SELECT
      // executed before the winner's INSERT committed. `repo.insert` below
      // still goes through the REAL db/transaction, so it hits the REAL
      // partial unique index seeded above.
      const staleReadDb = db as unknown as { select: unknown };
      const originalSelect = db.select.bind(db);
      staleReadDb.select = () => ({ from: () => ({ where: async () => [] }) });

      const uc = new CreateEnvelopeUseCase(
        db,
        audit,
        {
          householdId: HOUSEHOLD_A,
          name: 'Race Emergency Fund',
          allocatedCents: 250000,
          envelopeType: 'emergency_fund',
          periodStart: PERIOD_START,
        },
        { deviceId: 'device-2', actorUserId: 'user-2' },
      );

      const result = await uc.execute();

      // Restore in case anything below (or a future addition) needs a real select.
      staleReadDb.select = originalSelect;

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('DUPLICATE_EMERGENCY_FUND');

      const emfRows = raw
        .prepare("SELECT * FROM envelopes WHERE envelope_type = 'emergency_fund'")
        .all() as EnvelopeRow[];
      // Only the race winner's row exists — the loser's INSERT was rejected
      // by the DB and never landed.
      expect(emfRows).toHaveLength(1);
      expect(emfRows[0].id).toBe('env-emf-race-winner');

      const insertOps = raw
        .prepare("SELECT * FROM oplog WHERE table_name = 'envelopes' AND op_type = 'insert'")
        .all() as OplogRow[];
      // No oplog op for the rejected insert (the failed statement rolled
      // back within its own transaction before appendOp ran).
      expect(insertOps).toHaveLength(0);

      raw.close();
    });
  });
});

import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openMigratedDb } from './harness/openMigratedDb';
import { ArchiveEnvelopeUseCase } from '../../src/domain/envelopes/ArchiveEnvelopeUseCase';
import { AuditLogger } from '../../src/data/audit/AuditLogger';
import type { EnvelopeEntity } from '../../src/domain/envelopes/EnvelopeEntity';
import type * as schema from '../../src/data/local/schema';

// Regression test for the real-device bug: ArchiveEnvelopeUseCase passed a
// raw JS boolean (`is_archived: true`) to `repo.update`, which binds values
// directly to the SQLite driver. Mocked-repo unit tests never caught this
// because the fake repo happily accepts a JS boolean — only the REAL
// better-sqlite3/expo-sqlite driver rejects it ("SQLite3 can only bind
// numbers, strings, bigints, buffers, and null"), and the resulting throw
// was silently mis-reported as ENVELOPE_NOT_FOUND. This test runs the use
// case against a real migrated SQLite DB (like production) instead of a
// mock, so it fails the way a real device does.

const NOW = '2026-07-01T00:00:00.000Z';
const PERIOD_START = '2026-07-01';
const HOUSEHOLD_ID = 'hh-archive-1';
const ENVELOPE_ID = 'env-archive-1';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

function seedEnvelope(db: Database.Database): void {
  db.prepare(
    `INSERT INTO envelopes
       (id, household_id, name, allocated_cents, envelope_type,
        is_savings_locked, is_archived, period_start, created_at, updated_at)
     VALUES (?, ?, 'Groceries', 50000, 'spending', 0, 0, ?, ?, ?)`,
  ).run(ENVELOPE_ID, HOUSEHOLD_ID, PERIOD_START, NOW, NOW);
}

function makeDb(raw: Database.Database): ExpoSQLiteDatabase<typeof schema> {
  return drizzle(raw, { schema: {} }) as unknown as ExpoSQLiteDatabase<typeof schema>;
}

function makeEnvelopeEntity(): EnvelopeEntity {
  return {
    id: ENVELOPE_ID,
    householdId: HOUSEHOLD_ID,
    name: 'Groceries',
    allocatedCents: 50000,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: PERIOD_START,
    targetAmountCents: null,
    targetDate: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface EnvelopeRow {
  id: string;
  is_archived: number;
}

interface OplogRow {
  row_id: string;
  op_type: string;
  table_name: string;
  payload: string;
}

describe('ArchiveEnvelopeUseCase — real SQLite (device bug regression)', () => {
  it('archives the envelope (is_archived becomes 1), returns success, and appends one update oplog op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    seedEnvelope(raw);

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new ArchiveEnvelopeUseCase(db, audit, makeEnvelopeEntity(), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    });

    const result = await uc.execute();

    // Would previously be a silent false-negative: the raw JS boolean throws
    // in the real driver, and the use case mis-reports it as
    // ENVELOPE_NOT_FOUND instead of succeeding.
    expect(result.success).toBe(true);

    const [row] = raw
      .prepare('SELECT id, is_archived FROM envelopes WHERE id = ?')
      .all(ENVELOPE_ID) as EnvelopeRow[];
    expect(row).toBeDefined();
    expect(row.is_archived).toBe(1);

    const updateOps = raw
      .prepare("SELECT * FROM oplog WHERE table_name = 'envelopes' AND op_type = 'update'")
      .all() as OplogRow[];
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].row_id).toBe(ENVELOPE_ID);
    const payload = JSON.parse(updateOps[0].payload) as Record<string, unknown>;
    expect(payload.is_archived).toBe(1);

    raw.close();
  });

  it('fails with ENVELOPE_NOT_FOUND (not a throw) when the envelope no longer exists', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, HOUSEHOLD_ID);
    // Envelope intentionally not seeded — simulates already-deleted/missing.

    const db = makeDb(raw);
    const audit = new AuditLogger(db);
    const uc = new ArchiveEnvelopeUseCase(db, audit, makeEnvelopeEntity(), {
      deviceId: 'device-1',
      actorUserId: 'user-1',
    });

    const result = await uc.execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('ENVELOPE_NOT_FOUND');

    const updateOps = raw
      .prepare("SELECT * FROM oplog WHERE table_name = 'envelopes' AND op_type = 'update'")
      .all() as OplogRow[];
    expect(updateOps).toHaveLength(0);

    raw.close();
  });
});

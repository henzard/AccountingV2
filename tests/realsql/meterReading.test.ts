import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { LogMeterReadingUseCase } from '../../src/domain/meterReadings/LogMeterReadingUseCase';
import { DeleteMeterReadingUseCase } from '../../src/domain/meterReadings/DeleteMeterReadingUseCase';
import { DrizzleMeterReadingRepository } from '../../src/data/repositories/DrizzleMeterReadingRepository';
import type { MeterReadingEntity } from '../../src/domain/meterReadings/MeterReadingEntity';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface MeterReadingRow {
  id: string;
  household_id: string;
  meter_type: string;
  reading_value: number;
  reading_date: string;
  cost_cents: number | null;
}

interface OplogRow {
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string;
}

const noopAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

describe('LogMeterReadingUseCase (real SQLite)', () => {
  it('inserts the reading row and appends exactly one oplog op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    const uc = new LogMeterReadingUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      meterType: 'electricity',
      readingValue: 1500,
      readingDate: '2026-04-01',
      costCents: 52500,
      vehicleId: null,
      notes: null,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);

    const rows = raw.prepare('SELECT * FROM meter_readings').all() as MeterReadingRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].household_id).toBe('hh-1');
    expect(rows[0].meter_type).toBe('electricity');
    expect(rows[0].reading_value).toBe(1500);
    expect(rows[0].cost_cents).toBe(52500);

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all(rows[0].id) as OplogRow[];
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe('insert');
    expect(ops[0].table_name).toBe('meter_readings');
    expect(ops[0].household_id).toBe('hh-1');
    expect(JSON.parse(ops[0].payload).reading_value).toBe(1500);

    raw.close();
  });

  it('rejects a duplicate reading for the same meter type + date and appends no op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    const input = {
      householdId: 'hh-1',
      meterType: 'water' as const,
      readingValue: 10,
      readingDate: '2026-04-01',
      costCents: null,
      vehicleId: null,
      notes: null,
    };
    const first = await new LogMeterReadingUseCase(db as any, noopAudit, input).execute();
    expect(first.success).toBe(true);

    const second = await new LogMeterReadingUseCase(db as any, noopAudit, input).execute();
    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.code).toBe('DUPLICATE_READING');

    const opCount = (raw.prepare('SELECT COUNT(*) AS n FROM oplog').get() as { n: number }).n;
    expect(opCount).toBe(1); // only the first insert's op

    raw.close();
  });
});

describe('DeleteMeterReadingUseCase (real SQLite)', () => {
  // F3: a typo'd reading (e.g. 18000 instead of 1800) passes
  // LogMeterReadingUseCase's validation and permanently corrupts consumption
  // history unless it can be deleted. These tests prove the soft-delete path
  // through the synced repo actually tombstones the row and emits exactly
  // one `delete` op — they fail without DeleteMeterReadingUseCase's fix
  // (there is no other way to remove a bad reading).
  function insertReading(
    raw: Database.Database,
    overrides: Partial<MeterReadingEntity> = {},
  ): MeterReadingEntity {
    const reading: MeterReadingEntity = {
      id: overrides.id ?? 'reading-1',
      householdId: overrides.householdId ?? 'hh-1',
      meterType: overrides.meterType ?? 'electricity',
      readingValue: overrides.readingValue ?? 1800,
      readingDate: overrides.readingDate ?? '2026-04-01',
      costCents: overrides.costCents ?? null,
      vehicleId: overrides.vehicleId ?? null,
      notes: overrides.notes ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    raw
      .prepare(
        `INSERT INTO meter_readings
           (id, household_id, meter_type, reading_value, reading_date, cost_cents, vehicle_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reading.id,
        reading.householdId,
        reading.meterType,
        reading.readingValue,
        reading.readingDate,
        reading.costCents,
        reading.vehicleId,
        reading.notes,
        reading.createdAt,
        reading.updatedAt,
      );
    return reading;
  }

  it('soft-deletes the row (sets deleted_at) and appends exactly one delete op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const reading = insertReading(raw);
    const db = drizzle(raw);

    const result = await new DeleteMeterReadingUseCase(db as any, noopAudit, reading).execute();
    expect(result.success).toBe(true);

    const row = raw
      .prepare('SELECT deleted_at FROM meter_readings WHERE id = ?')
      .get(reading.id) as { deleted_at: string | null };
    expect(row.deleted_at).not.toBeNull();

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all(reading.id) as OplogRow[];
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe('delete');
    expect(ops[0].table_name).toBe('meter_readings');
    expect(ops[0].household_id).toBe('hh-1');

    raw.close();
  });

  it('returns METER_READING_NOT_FOUND and writes nothing for a reading belonging to a different household', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    seedHousehold(raw, 'hh-2');
    const reading = insertReading(raw, { id: 'reading-2', householdId: 'hh-1' });
    const db = drizzle(raw);

    // Attacker/bug scenario: the use case is invoked with the right id but
    // the WRONG household id — the synced repo's WHERE clause must refuse
    // to match hh-1's row under hh-2's scope.
    const otherHouseholdReading: MeterReadingEntity = { ...reading, householdId: 'hh-2' };
    const result = await new DeleteMeterReadingUseCase(
      db as any,
      noopAudit,
      otherHouseholdReading,
    ).execute();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('METER_READING_NOT_FOUND');

    const row = raw
      .prepare('SELECT deleted_at FROM meter_readings WHERE id = ?')
      .get(reading.id) as { deleted_at: string | null };
    expect(row.deleted_at).toBeNull(); // untouched

    const opCount = (raw.prepare('SELECT COUNT(*) AS n FROM oplog').get() as { n: number }).n;
    expect(opCount).toBe(0);

    raw.close();
  });

  it('returns METER_READING_NOT_FOUND and appends no second op for an already-deleted reading', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const reading = insertReading(raw, { id: 'reading-3' });
    const db = drizzle(raw);

    const first = await new DeleteMeterReadingUseCase(db as any, noopAudit, reading).execute();
    expect(first.success).toBe(true);

    const second = await new DeleteMeterReadingUseCase(db as any, noopAudit, reading).execute();
    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.code).toBe('METER_READING_NOT_FOUND');

    const opCount = (raw.prepare('SELECT COUNT(*) AS n FROM oplog').get() as { n: number }).n;
    expect(opCount).toBe(1); // only the first delete's op

    raw.close();
  });

  it('recomputes consumption from the remaining readings after a middle reading is deleted', async () => {
    // F3 scenario: r1 (1000) -> r2 (1800, a typo for 1080) -> r3 (1200) would
    // be REJECTED by LogMeterReadingUseCase's guards (1200 < 1800 fails
    // READING_ABOVE_NEXT's mirror), so seed the rows directly to reproduce
    // the corrupted state a typo produces once it's already logged, then
    // prove deleting the bad middle reading restores a sane consumption
    // figure between the true neighbours (r1 -> r3).
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const r1 = insertReading(raw, { id: 'r1', readingDate: '2026-01-01', readingValue: 1000 });
    const bad = insertReading(raw, { id: 'bad', readingDate: '2026-02-01', readingValue: 18000 });
    const r3 = insertReading(raw, { id: 'r3', readingDate: '2026-03-01', readingValue: 1200 });
    const db = drizzle(raw);

    const result = await new DeleteMeterReadingUseCase(db as any, noopAudit, bad).execute();
    expect(result.success).toBe(true);

    const remaining = raw
      .prepare(
        'SELECT id, reading_value FROM meter_readings WHERE household_id = ? AND deleted_at IS NULL ORDER BY reading_date ASC',
      )
      .all('hh-1') as { id: string; reading_value: number }[];
    expect(remaining.map((r) => r.id)).toEqual(['r1', 'r3']);

    const { UnitRateCalculator } =
      await import('../../src/domain/meterReadings/UnitRateCalculator');
    const calculator = new UnitRateCalculator();
    const rate = calculator.calculate(
      { ...r3, readingValue: remaining[1].reading_value },
      { ...r1, readingValue: remaining[0].reading_value },
    );
    expect(rate.success).toBe(true);
    if (rate.success) {
      // 1200 - 1000 = 200, computed from the true remaining neighbours —
      // not against the deleted 18000 typo.
      expect(rate.data.consumptionUnits).toBe(200);
    }

    raw.close();
  });
});

describe('DrizzleMeterReadingRepository — soft-deleted rows are excluded (real SQLite)', () => {
  // Round-6 follow-up: once DeleteMeterReadingUseCase can tombstone a row,
  // every reader of meter_readings must exclude deleted_at rows or the
  // "delete" is cosmetic — the bad reading keeps counting toward
  // LogMeterReadingUseCase's neighbour/duplicate guards via findByHousehold.
  // These fail without the `isNull(meterReadings.deletedAt)` filter added to
  // findById / findByHousehold / findByDate.
  function insertReading(
    raw: Database.Database,
    overrides: Partial<MeterReadingEntity> = {},
  ): MeterReadingEntity {
    const reading: MeterReadingEntity = {
      id: overrides.id ?? 'r1',
      householdId: overrides.householdId ?? 'hh-1',
      meterType: overrides.meterType ?? 'electricity',
      readingValue: overrides.readingValue ?? 1000,
      readingDate: overrides.readingDate ?? '2026-01-01',
      costCents: overrides.costCents ?? null,
      vehicleId: overrides.vehicleId ?? null,
      notes: overrides.notes ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    raw
      .prepare(
        `INSERT INTO meter_readings
           (id, household_id, meter_type, reading_value, reading_date, cost_cents, vehicle_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reading.id,
        reading.householdId,
        reading.meterType,
        reading.readingValue,
        reading.readingDate,
        reading.costCents,
        reading.vehicleId,
        reading.notes,
        reading.createdAt,
        reading.updatedAt,
      );
    return reading;
  }

  it('findById returns null for a soft-deleted reading', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const reading = insertReading(raw);
    const db = drizzle(raw);
    await new DeleteMeterReadingUseCase(db as any, noopAudit, reading).execute();

    const repo = new DrizzleMeterReadingRepository(db as any);
    const found = await repo.findById(reading.id, reading.householdId);
    expect(found).toBeNull();

    raw.close();
  });

  it('findByHousehold omits a soft-deleted reading from the list', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const kept = insertReading(raw, { id: 'kept', readingDate: '2026-01-01', readingValue: 1000 });
    const deleted = insertReading(raw, {
      id: 'deleted',
      readingDate: '2026-02-01',
      readingValue: 18000,
    });
    const db = drizzle(raw);
    await new DeleteMeterReadingUseCase(db as any, noopAudit, deleted).execute();

    const repo = new DrizzleMeterReadingRepository(db as any);
    const found = await repo.findByHousehold('hh-1', 'electricity');
    expect(found.map((r) => r.id)).toEqual([kept.id]);

    raw.close();
  });

  it('findByDate does not return a soft-deleted reading for that date', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const reading = insertReading(raw, { readingDate: '2026-03-01' });
    const db = drizzle(raw);
    await new DeleteMeterReadingUseCase(db as any, noopAudit, reading).execute();

    const repo = new DrizzleMeterReadingRepository(db as any);
    const found = await repo.findByDate('hh-1', 'electricity', '2026-03-01');
    expect(found).toBeNull();

    raw.close();
  });
});

describe('LogMeterReadingUseCase after a delete (real SQLite, end to end)', () => {
  // F3 end-to-end: deleting the 18000 typo must actually unblock logging a
  // sane reading in its place — both the "below previous"/"above next"
  // guards and the duplicate-date guard read through
  // DrizzleMeterReadingRepository.findByHousehold, so this fails unless that
  // repo excludes the deleted row.
  it('allows logging 1200 (below the deleted 18000, above the true previous 1000) after deleting the typo', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    raw
      .prepare(
        `INSERT INTO meter_readings
           (id, household_id, meter_type, reading_value, reading_date, cost_cents, vehicle_id, notes, created_at, updated_at)
         VALUES ('r1', 'hh-1', 'electricity', 1000, '2026-01-01', NULL, NULL, NULL, ?, ?)`,
      )
      .run(NOW, NOW);
    const bad: MeterReadingEntity = {
      id: 'bad',
      householdId: 'hh-1',
      meterType: 'electricity',
      readingValue: 18000,
      readingDate: '2026-02-01',
      costCents: null,
      vehicleId: null,
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    raw
      .prepare(
        `INSERT INTO meter_readings
           (id, household_id, meter_type, reading_value, reading_date, cost_cents, vehicle_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bad.id,
        bad.householdId,
        bad.meterType,
        bad.readingValue,
        bad.readingDate,
        bad.costCents,
        bad.vehicleId,
        bad.notes,
        bad.createdAt,
        bad.updatedAt,
      );
    const db = drizzle(raw);

    const deleteResult = await new DeleteMeterReadingUseCase(db as any, noopAudit, bad).execute();
    expect(deleteResult.success).toBe(true);

    // Logging 1200 on the SAME date as the deleted 18000 row must not be
    // rejected as a duplicate, and 1200 (which sits below 18000 but above
    // the true previous of 1000) must not be rejected as
    // READING_BELOW_PREVIOUS either — both guards read findByHousehold,
    // which must no longer see the deleted row.
    const logResult = await new LogMeterReadingUseCase(db as any, noopAudit, {
      householdId: 'hh-1',
      meterType: 'electricity',
      readingValue: 1200,
      readingDate: '2026-02-01',
      costCents: null,
      vehicleId: null,
      notes: null,
    }).execute();

    expect(logResult.success).toBe(true);
    if (logResult.success) {
      expect(logResult.data.readingValue).toBe(1200);
      expect(logResult.data.readingDate).toBe('2026-02-01');
    }

    raw.close();
  });
});

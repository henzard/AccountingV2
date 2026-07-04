import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { LogMeterReadingUseCase } from '../../src/domain/meterReadings/LogMeterReadingUseCase';

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

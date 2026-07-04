import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { SeedBabyStepsUseCase } from '../../src/domain/babySteps/SeedBabyStepsUseCase';
import { ToggleManualStepUseCase } from '../../src/domain/babySteps/ToggleManualStepUseCase';
import { StampCelebratedUseCase } from '../../src/domain/babySteps/StampCelebratedUseCase';
import { ReconcileEmergencyFundTypeUseCase } from '../../src/domain/babySteps/ReconcileEmergencyFundTypeUseCase';

const NOW = '2026-01-01T00:00:00.000Z';

function seedHousehold(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO households (id, name, payday_day, created_at, updated_at)
     VALUES (?, 'Test Household', 25, ?, ?)`,
  ).run(id, NOW, NOW);
}

interface BabyStepRow {
  id: string;
  household_id: string;
  step_number: number;
  is_completed: number;
  completed_at: string | null;
  celebrated_at: string | null;
}

interface OplogRow {
  op_id: string;
  household_id: string;
  table_name: string;
  row_id: string;
  op_type: string;
  payload: string;
}

describe('SeedBabyStepsUseCase (real SQLite)', () => {
  it('inserts all 7 rows and appends exactly 7 oplog ops', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    const result = await new SeedBabyStepsUseCase(db as any).execute('hh-1');
    expect(result.success).toBe(true);

    const rows = raw
      .prepare('SELECT * FROM baby_steps WHERE household_id = ? ORDER BY step_number')
      .all('hh-1') as BabyStepRow[];
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.step_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const ops = raw.prepare('SELECT * FROM oplog WHERE household_id = ?').all('hh-1') as OplogRow[];
    expect(ops).toHaveLength(7);
    expect(ops.every((o) => o.op_type === 'insert' && o.table_name === 'baby_steps')).toBe(true);

    // Slice 5 task 6 drops the `pending_sync` table entirely (migration
    // 0014) — its non-existence is a stronger guarantee than the old
    // "count is 0" assertion this replaces; a query against it would now
    // throw "no such table" instead.
    const tableExists = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_sync'")
      .get();
    expect(tableExists).toBeUndefined();

    raw.close();
  });

  it('re-running the seeder is idempotent — no duplicate rows or ops', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    await new SeedBabyStepsUseCase(db as any).execute('hh-1');
    const result = await new SeedBabyStepsUseCase(db as any).execute('hh-1');
    expect(result.success).toBe(true);

    const rows = raw.prepare('SELECT * FROM baby_steps WHERE household_id = ?').all('hh-1');
    expect(rows).toHaveLength(7);

    const opCount = (
      raw.prepare('SELECT COUNT(*) AS n FROM oplog WHERE household_id = ?').get('hh-1') as {
        n: number;
      }
    ).n;
    expect(opCount).toBe(7); // second run appended no new ops

    raw.close();
  });
});

describe('ToggleManualStepUseCase (real SQLite)', () => {
  it('toggles a manual step and appends exactly one oplog op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    await new SeedBabyStepsUseCase(db as any).execute('hh-1');
    const result = await new ToggleManualStepUseCase(db as any).execute('hh-1', 4, true);
    expect(result.success).toBe(true);

    const row = raw
      .prepare('SELECT * FROM baby_steps WHERE household_id = ? AND step_number = 4')
      .get('hh-1') as BabyStepRow;
    expect(row.is_completed).toBe(1);
    expect(row.completed_at).toBeTruthy();

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all(row.id) as OplogRow[];
    // 1 insert (from seeding) + 1 update (from the toggle)
    expect(ops).toHaveLength(2);
    expect(ops[1].op_type).toBe('update');

    raw.close();
  });
});

describe('StampCelebratedUseCase (real SQLite)', () => {
  it('stamps celebrated_at and appends exactly one oplog op; idempotent on re-stamp', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    const db = drizzle(raw);

    await new SeedBabyStepsUseCase(db as any).execute('hh-1');
    const result = await new StampCelebratedUseCase(db as any).execute('hh-1', 1);
    expect(result.success).toBe(true);

    const row = raw
      .prepare('SELECT * FROM baby_steps WHERE household_id = ? AND step_number = 1')
      .get('hh-1') as BabyStepRow;
    expect(row.celebrated_at).toBeTruthy();

    const opsAfterFirst = raw
      .prepare('SELECT COUNT(*) AS n FROM oplog WHERE row_id = ?')
      .get(row.id) as { n: number };
    expect(opsAfterFirst.n).toBe(2); // seed insert + stamp update

    // Idempotent: re-stamping is a no-op, no new oplog row.
    const second = await new StampCelebratedUseCase(db as any).execute('hh-1', 1);
    expect(second.success).toBe(true);
    const opsAfterSecond = raw
      .prepare('SELECT COUNT(*) AS n FROM oplog WHERE row_id = ?')
      .get(row.id) as { n: number };
    expect(opsAfterSecond.n).toBe(2);

    raw.close();
  });
});

describe('ReconcileEmergencyFundTypeUseCase (real SQLite)', () => {
  function seedEnvelope(
    db: Database.Database,
    id: string,
    householdId: string,
    createdAt: string,
  ): void {
    db.prepare(
      `INSERT INTO envelopes (id, household_id, name, envelope_type, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, 'Emergency Fund', 'emergency_fund', 0, '2026-01-01', ?, ?)`,
    ).run(id, householdId, createdAt, createdAt);
  }

  it('flips the non-oldest EMF to savings and appends exactly one oplog op', async () => {
    const raw = openMigratedDb();
    seedHousehold(raw, 'hh-1');
    // `envelopes_one_active_emf_per_household` (0013_emf_unique.sql) blocks
    // two active EMF rows for the same household under normal writes — this
    // reconcile mechanism exists precisely to fix up the narrow pre-existing
    // race windows that can still produce duplicates despite that index
    // (see docs/superpowers/plans/2026-07-03-slice3... Task 6 note). Drop it
    // for this test only, to reproduce that already-duplicated precondition
    // directly rather than trying to race the real guard.
    raw.exec('DROP INDEX envelopes_one_active_emf_per_household');
    seedEnvelope(raw, 'env-older', 'hh-1', '2025-01-01T00:00:00.000Z');
    seedEnvelope(raw, 'env-newer', 'hh-1', '2026-01-01T00:00:00.000Z');
    const db = drizzle(raw);

    const result = await new ReconcileEmergencyFundTypeUseCase(db as any).execute('hh-1');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flipped).toBe(1);

    const newer = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-newer') as {
      envelope_type: string;
    };
    expect(newer.envelope_type).toBe('savings');
    const older = raw.prepare('SELECT * FROM envelopes WHERE id = ?').get('env-older') as {
      envelope_type: string;
    };
    expect(older.envelope_type).toBe('emergency_fund');

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('env-newer') as OplogRow[];
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe('update');
    expect(JSON.parse(ops[0].payload)).toEqual(
      expect.objectContaining({ envelope_type: 'savings' }),
    );

    const oldOps = raw
      .prepare('SELECT COUNT(*) AS n FROM oplog WHERE row_id = ?')
      .get('env-older') as {
      n: number;
    };
    expect(oldOps.n).toBe(0);

    raw.close();
  });
});

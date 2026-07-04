import { drizzle } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { CreateHouseholdUseCase } from '../../src/domain/households/CreateHouseholdUseCase';
import { UpdateHouseholdPaydayDayUseCase } from '../../src/domain/households/UpdateHouseholdPaydayDayUseCase';
import { EnsureHouseholdUseCase } from '../../src/domain/households/EnsureHouseholdUseCase';

interface HouseholdRow {
  id: string;
  name: string;
  payday_day: number;
  updated_at: string;
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

describe('CreateHouseholdUseCase (real SQLite)', () => {
  it('inserts households + household_members rows and appends one oplog op each', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw);

    const uc = new CreateHouseholdUseCase(db as any, noopAudit, {
      userId: 'user-1',
      name: 'Kruger Household',
      paydayDay: 25,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const householdId = result.data.id;
    const hh = raw
      .prepare('SELECT * FROM households WHERE id = ?')
      .get(householdId) as HouseholdRow;
    expect(hh.name).toBe('Kruger Household');
    expect(hh.payday_day).toBe(25);

    const memberRows = raw
      .prepare('SELECT * FROM household_members WHERE household_id = ?')
      .all(householdId) as { user_id: string; role: string }[];
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].user_id).toBe('user-1');
    expect(memberRows[0].role).toBe('owner');

    const babyStepRows = raw
      .prepare('SELECT * FROM baby_steps WHERE household_id = ?')
      .all(householdId);
    expect(babyStepRows).toHaveLength(7);

    // households (1) + household_members (1) + baby_steps (7) = 9 oplog ops
    const ops = raw
      .prepare('SELECT * FROM oplog WHERE household_id = ?')
      .all(householdId) as OplogRow[];
    expect(ops).toHaveLength(9);
    expect(ops.filter((o) => o.table_name === 'households')).toHaveLength(1);
    expect(ops.filter((o) => o.table_name === 'household_members')).toHaveLength(1);
    expect(ops.filter((o) => o.table_name === 'baby_steps')).toHaveLength(7);
    expect(ops.every((o) => o.op_type === 'insert')).toBe(true);

    raw.close();
  });
});

describe('UpdateHouseholdPaydayDayUseCase (real SQLite)', () => {
  it('updates payday_day and appends exactly one oplog op', async () => {
    const raw = openMigratedDb();
    const NOW = '2026-01-01T00:00:00.000Z';
    raw
      .prepare(
        `INSERT INTO households (id, name, payday_day, created_at, updated_at)
         VALUES ('hh-1', 'Test', 1, ?, ?)`,
      )
      .run(NOW, NOW);
    const db = drizzle(raw);

    const uc = new UpdateHouseholdPaydayDayUseCase(db as any, 'hh-1', 20);
    const result = await uc.execute();
    expect(result.success).toBe(true);

    const hh = raw.prepare('SELECT * FROM households WHERE id = ?').get('hh-1') as HouseholdRow;
    expect(hh.payday_day).toBe(20);

    const ops = raw.prepare('SELECT * FROM oplog WHERE row_id = ?').all('hh-1') as OplogRow[];
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe('update');
    expect(ops[0].household_id).toBe('hh-1');
    expect(JSON.parse(ops[0].payload)).toEqual(expect.objectContaining({ payday_day: 20 }));

    raw.close();
  });
});

describe('EnsureHouseholdUseCase — legacy household catch-up (real SQLite)', () => {
  function seedLegacyHousehold(db: Database.Database, userId: string): void {
    const now = '2025-01-01T00:00:00.000Z';
    // Legacy scheme: households.id === userId, no household_members row yet.
    db.prepare(
      `INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
       VALUES (?, 'Legacy House', 25, 1, ?, ?)`,
    ).run(userId, now, now);
  }

  it('adopts the legacy household, inserts a membership row, and appends a households catch-up op without re-inserting the row', async () => {
    const raw = openMigratedDb();
    seedLegacyHousehold(raw, 'user-legacy');
    const db = drizzle(raw);

    const uc = new EnsureHouseholdUseCase(db as any, 'user-legacy');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe('user-legacy');

    // Still exactly one households row (no duplicate insert attempted).
    const householdRows = raw.prepare('SELECT * FROM households WHERE id = ?').all('user-legacy');
    expect(householdRows).toHaveLength(1);

    const memberRows = raw
      .prepare('SELECT * FROM household_members WHERE household_id = ?')
      .all('user-legacy') as { user_id: string; role: string }[];
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].user_id).toBe('user-legacy');

    const ops = raw
      .prepare('SELECT * FROM oplog WHERE household_id = ? ORDER BY table_name')
      .all('user-legacy') as OplogRow[];
    // One catch-up insert op for `households` (no duplicate — see below) +
    // one insert op for the new `household_members` row + 7 baby_steps
    // seed ops (this legacy household never had any) = 9 total.
    expect(ops).toHaveLength(9);
    const householdsOps = ops.filter((o) => o.table_name === 'households');
    expect(householdsOps).toHaveLength(1); // exactly one catch-up op, not a duplicate
    expect(householdsOps[0].op_type).toBe('insert');
    expect(householdsOps[0].row_id).toBe('user-legacy');
    const membersOp = ops.find((o) => o.table_name === 'household_members');
    expect(membersOp?.op_type).toBe('insert');
    expect(ops.filter((o) => o.table_name === 'baby_steps')).toHaveLength(7);

    raw.close();
  });
});

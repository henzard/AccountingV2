// tests/realsql/householdCreateAtomicity.test.ts
//
// Proves the CreateHouseholdUseCase atomicity fix: the household row + the
// owner household_members row (and both their oplog ops) commit inside ONE
// unit-of-work transaction, so a failure of the SECOND insert rolls the FIRST
// back too — never leaving a household with no owner (which post-0002 would be
// un-bootstrappable through sync_push).
//
// Deterministic, counter-based UUIDs let the test pre-seed a colliding
// household_members primary key so the owner-membership insert fails mid
// transaction; we then assert NOTHING from the use case persisted.

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  // Unique + deterministic: `id-1`, `id-2`, ... so we can predict the
  // memberId the use case generates and force a primary-key collision on it.
  randomUUID: () => `id-${++mockUuidCounter}`,
}));

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openMigratedDb } from './harness/openMigratedDb';
import { CreateHouseholdUseCase } from '../../src/domain/households/CreateHouseholdUseCase';

const noopAudit = { log: jest.fn().mockResolvedValue(undefined) } as any;

describe('CreateHouseholdUseCase atomicity (real SQLite)', () => {
  beforeEach(() => {
    mockUuidCounter = 0;
  });

  it('rolls back the household insert when the owner-membership insert fails (all-or-nothing)', async () => {
    const raw = openMigratedDb();
    const NOW = '2026-01-01T00:00:00.000Z';

    // The use case will generate: householdId = 'id-1', memberId = 'id-2'
    // (randomUUID calls 1 and 2). Pre-seed a household_members row whose PK is
    // 'id-2' so the owner-membership INSERT collides and throws INSIDE the
    // unit-of-work transaction, AFTER the household row was already inserted.
    raw
      .prepare(
        `INSERT INTO households (id, name, payday_day, user_level, created_at, updated_at)
         VALUES ('pre-hh', 'Pre', 1, 1, ?, ?)`,
      )
      .run(NOW, NOW);
    raw
      .prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, joined_at, updated_at)
         VALUES ('id-2', 'pre-hh', 'someone', 'member', ?, ?)`,
      )
      .run(NOW, NOW);

    const db = drizzle(raw);
    const uc = new CreateHouseholdUseCase(db as any, noopAudit, {
      userId: 'user-1',
      name: 'Atomic Household',
      paydayDay: 25,
    });

    // The colliding membership insert propagates out of runInUnitOfWork.
    await expect(uc.execute()).rejects.toBeTruthy();

    // The household row that was inserted first must have been rolled back:
    // only the pre-seeded household remains.
    const households = raw.prepare('SELECT id FROM households').all() as { id: string }[];
    expect(households.map((h) => h.id).sort()).toEqual(['pre-hh']);

    // No household ('id-1') row leaked.
    expect(raw.prepare('SELECT * FROM households WHERE id = ?').get('id-1')).toBeUndefined();

    // No oplog ops for the new household leaked — the households insert op and
    // the membership insert op were in the same rolled-back transaction.
    const ops = raw.prepare('SELECT * FROM oplog WHERE household_id = ?').all('id-1');
    expect(ops).toHaveLength(0);

    raw.close();
  });

  it('commits the household op BEFORE the owner-membership op (bootstrap order)', async () => {
    const raw = openMigratedDb();
    const db = drizzle(raw);
    const uc = new CreateHouseholdUseCase(db as any, noopAudit, {
      userId: 'user-1',
      name: 'Ordered Household',
      paydayDay: 25,
    });
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const householdId = result.data.id;

    // Local oplog insertion order (rowid) must place the households insert op
    // before the owner household_members insert op — the exact order the
    // server's bootstrap authorization + deferred FK rely on.
    const ops = raw
      .prepare(
        `SELECT table_name FROM oplog
         WHERE household_id = ? AND table_name IN ('households','household_members')
         ORDER BY rowid`,
      )
      .all(householdId) as { table_name: string }[];
    expect(ops.map((o) => o.table_name)).toEqual(['households', 'household_members']);

    raw.close();
  });
});

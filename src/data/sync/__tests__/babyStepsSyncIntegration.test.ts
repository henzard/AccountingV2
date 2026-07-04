/**
 * Phase 6 integration tests — Baby Steps sync + restore verification.
 *
 * Tasks covered:
 *   6.2 — RestoreService + SeedBabyStepsUseCase: backfill without timestamp mutation
 *   6.7 — Seeder race: RestoreService + concurrent SeedBabyStepsUseCase (cross-reference)
 *
 * Mock pattern: hand-rolled mocks; no in-memory Drizzle — pure mock DB objects.
 *
 * Domain use cases are exercised as real instances (not mocked) where possible,
 * receiving mock persistence.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { RestoreService } from '../RestoreService';
import { SeedBabyStepsUseCase } from '../../../domain/babySteps/SeedBabyStepsUseCase';

// ---------------------------------------------------------------------------
// 6.2 — RestoreService: restores rows then seeds missing steps without mutation
// ---------------------------------------------------------------------------

describe('6.2 — RestoreService + SeedBabyStepsUseCase: backfill without timestamp mutation', () => {
  const BASE_HH = {
    id: 'hh-restore',
    name: 'Restore Test HH',
    payday_day: 1,
    user_level: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  /**
   * Build a Supabase mock that returns a specific set of baby_steps rows for
   * the given household, and empty for all other entity tables.
   */
  function makeRestoreSupabase(babyStepRows: Record<string, unknown>[]) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, _val: unknown) => {
            if (table === 'households') {
              return { single: () => Promise.resolve({ data: BASE_HH, error: null }) };
            }
            if (table === 'household_members') {
              return Promise.resolve({ data: [], error: null });
            }
            if (table === 'baby_steps') {
              return Promise.resolve({ data: babyStepRows, error: null });
            }
            // envelopes, transactions, debts, meter_readings
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    };
  }

  it('restores existing baby_steps rows and backfills missing ones via SeedBabyStepsUseCase', async () => {
    // Supabase returns only steps 1, 2, 3 (steps 4-7 missing on remote)
    const remoteRows = [1, 2, 3].map((n) => ({
      id: `bs-${n}`,
      household_id: 'hh-restore',
      step_number: n,
      is_completed: false,
      completed_at: null,
      is_manual: false,
      celebrated_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }));

    const insertedRows: Record<string, unknown>[] = [];

    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            insertedRows.push(row);
            return Promise.resolve();
          }),
        }),
      }),
      // The seeder's existence check reads whatever restoreTable already
      // pulled (via onConflictDoUpdate above) for baby_steps.
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve(
              insertedRows
                .filter((r) => 'stepNumber' in r)
                .map((r) => ({ stepNumber: r.stepNumber })),
            ),
        }),
      }),
    } as any;

    // SeedBabyStepsUseCase now writes via the oplog synced repo rather than
    // a raw onConflictDoNothing insert — inject a fake repo (via
    // RestoreService's seedDeps) that also records into `insertedRows` so
    // the assertions below see the backfilled steps.
    const fakeRepo = {
      insert: jest.fn((row: Record<string, unknown>) => {
        insertedRows.push({ stepNumber: row.step_number });
      }),
      update: jest.fn(),
      softDelete: jest.fn(),
      increment: jest.fn(),
    };

    const supabase = makeRestoreSupabase(remoteRows);
    const svc = new RestoreService(db, supabase as any, { repo: fakeRepo as any });
    await svc.restoreHousehold('hh-restore', 'owner', 'user-1');

    // At minimum 7 distinct (householdId, stepNumber) pairs must be present
    const stepNumbersInserted = insertedRows
      .filter((r) => 'stepNumber' in r)
      .map((r) => (r as any).stepNumber);

    const uniqueSteps = new Set(stepNumbersInserted);
    expect(uniqueSteps.size).toBe(7);
    // All 7 steps must be represented
    for (let n = 1; n <= 7; n++) {
      expect(uniqueSteps.has(n)).toBe(true);
    }
  });

  it('existing row timestamps are not mutated by the seeder backfill (all 7 present → seeder is no-op)', async () => {
    // All 7 steps already present on remote — seeder should not create new rows.
    // We verify this by tracking the first write per (householdId, stepNumber) pair
    // and confirming no step's createdAt/updatedAt changes from the restored value.
    const remoteCreatedAt = '2026-01-01T00:00:00Z';
    const remoteRows = Array.from({ length: 7 }, (_, i) => ({
      id: `bs-${i + 1}`,
      household_id: 'hh-restore',
      step_number: i + 1,
      is_completed: false,
      completed_at: null,
      is_manual: [4, 5, 7].includes(i + 1),
      celebrated_at: i + 1 === 1 ? '2026-02-01T00:00:00Z' : null,
      created_at: remoteCreatedAt,
      updated_at: remoteCreatedAt,
    }));

    // Track the first write for each (householdId, stepNumber) pair.
    // onConflictDoUpdate is called by restoreTable (remote authoritative);
    // onConflictDoNothing is called by the seeder (idempotent backfill).
    const firstWriteByKey = new Map<string, Record<string, unknown>>();

    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            if ('stepNumber' in row) {
              const key = `${row.householdId}:${row.stepNumber}`;
              // Only record the first write from restoreTable
              if (!firstWriteByKey.has(key)) {
                firstWriteByKey.set(key, { ...row });
              }
            }
            return Promise.resolve();
          }),
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const supabase = makeRestoreSupabase(remoteRows);
    const svc = new RestoreService(db, supabase as any);
    await svc.restoreHousehold('hh-restore', 'owner', 'user-1');

    // All 7 steps must have been written
    expect(firstWriteByKey.size).toBe(7);

    // The first write for each step must originate from restoreTable (which has
    // createdAt = remoteCreatedAt), NOT from the seeder (which would use new Date()).
    // In production the seeder's INSERT OR IGNORE is a no-op when the row exists;
    // here we verify the first write carries the Supabase data.
    for (let n = 1; n <= 7; n++) {
      const key = `hh-restore:${n}`;
      const written = firstWriteByKey.get(key) as Record<string, unknown>;
      expect(written).toBeDefined();
      // createdAt from Supabase row — if seeder wrote first, this would be a new timestamp
      expect(written.createdAt).toBe(remoteCreatedAt);
    }
  });

  it('celebrated_at from restored row is preserved (not overwritten by seeder INSERT OR IGNORE)', async () => {
    // Step 1 has a celebrated_at stamp from Supabase.
    // RestoreService writes it first (from restoreTable). Seeder runs INSERT OR IGNORE
    // for all 7 steps; since step 1 is already present, the seeder's insert is a no-op.
    // The celebrated_at from the first (restoreTable) write is the canonical value.
    const celebratedAt = '2026-04-12T10:05:00Z';
    const remoteCreatedAt = '2026-01-01T00:00:00Z';
    const remoteRows = [
      {
        id: 'bs-1',
        household_id: 'hh-restore',
        step_number: 1,
        is_completed: true,
        completed_at: '2026-04-12T10:00:00Z',
        is_manual: false,
        celebrated_at: celebratedAt,
        created_at: remoteCreatedAt,
        updated_at: '2026-04-12T10:00:00Z',
      },
    ];

    // Track the first write for each step (via onConflictDoUpdate from restoreTable)
    const firstWriteByKey = new Map<string, Record<string, unknown>>();

    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            if ('stepNumber' in row) {
              const key = `${row.householdId}:${row.stepNumber}`;
              if (!firstWriteByKey.has(key)) {
                firstWriteByKey.set(key, { ...row });
              }
            }
            return Promise.resolve();
          }),
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const supabase = makeRestoreSupabase(remoteRows);
    const svc = new RestoreService(db, supabase as any);
    await svc.restoreHousehold('hh-restore', 'owner', 'user-1');

    // Step 1's first write (from restoreTable) must have the Supabase celebrated_at
    const step1 = firstWriteByKey.get('hh-restore:1') as Record<string, unknown>;
    expect(step1).toBeDefined();
    expect(step1.celebratedAt).toBe(celebratedAt);
    expect(step1.createdAt).toBe(remoteCreatedAt);
  });
});

// ---------------------------------------------------------------------------
// 6.7 — Seeder race cross-reference: RestoreService + concurrent seed()
//
// Spec §Testing — seeder race: already covered as unit test in SeedBabyStepsUseCase.test.ts.
// This test adds orchestrator-context coverage: RestoreService internally calls seed once;
// a concurrent external seed() call for the same household must not cause conflicts or
// double-insert rows.
// ---------------------------------------------------------------------------

describe('6.7 — Seeder race cross-reference: RestoreService + concurrent SeedBabyStepsUseCase', () => {
  it('concurrent RestoreService.restoreHousehold + SeedBabyStepsUseCase.execute → final count = 7, no rejection', async () => {
    const BASE_HH_CONCURRENT = {
      id: 'hh-race',
      name: 'Race HH',
      payday_day: 1,
      user_level: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, _val: unknown) => {
            if (table === 'households') {
              return { single: () => Promise.resolve({ data: BASE_HH_CONCURRENT, error: null }) };
            }
            if (table === 'household_members') {
              return Promise.resolve({ data: [], error: null });
            }
            // All entity tables return empty — RestoreService's restoreTable finds nothing,
            // so only the seeder call within restoreHousehold writes rows.
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    // Shared state simulating a real DB: tracks rows by (householdId, stepNumber)
    const rows = new Map<string, unknown>();

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            // onConflictDoUpdate is used for household upsert
            return Promise.resolve();
          }),
        }),
      }),
      // SeedBabyStepsUseCase's existence pre-check reads from the same
      // shared `rows` map both seeder invocations write into.
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve(
              Array.from(rows.keys())
                .filter((k) => k.startsWith('hh-race:'))
                .map((k) => ({ stepNumber: Number(k.split(':')[1]) })),
            ),
        }),
      }),
    } as any;

    // SeedBabyStepsUseCase now writes via the oplog synced repo. This fake
    // reproduces the real `createSyncedRepo`'s race behavior: a second
    // writer for the same (household_id, step_number) hits the same
    // UNIQUE-constraint-shaped error, which the use case's own catch treats
    // as an idempotent no-op (see SeedBabyStepsUseCase.ts).
    const fakeRepo = {
      insert: jest.fn((row: Record<string, unknown>) => {
        const key = `${row.household_id}:${row.step_number}`;
        if (rows.has(key)) {
          throw new Error(
            'UNIQUE constraint failed: baby_steps.household_id, baby_steps.step_number',
          );
        }
        rows.set(key, row);
      }),
      update: jest.fn(),
      softDelete: jest.fn(),
      increment: jest.fn(),
    };

    const svc = new RestoreService(db, supabase, { repo: fakeRepo as any });
    const externalSeeder = new SeedBabyStepsUseCase(db as any, { repo: fakeRepo as any });

    // Fire both concurrently: RestoreService (which internally calls seed once)
    // and an external seed() call for the same household.
    await expect(
      Promise.all([
        svc.restoreHousehold('hh-race', 'owner', 'user-1'),
        externalSeeder.execute('hh-race'),
      ]),
    ).resolves.not.toThrow();

    // Final state: exactly 7 unique (householdId, stepNumber) rows
    const stepKeys = Array.from(rows.keys()).filter((k) => k.startsWith('hh-race:'));
    expect(stepKeys).toHaveLength(7);
  });
});

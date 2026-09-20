/**
 * Phase 6 integration tests — Baby Steps sync + restore verification.
 *
 * Tasks covered:
 *   6.2 — RestoreService + SeedBabyStepsUseCase: backfill without timestamp mutation
 *   6.7 — Seeder race: RestoreService + concurrent SeedBabyStepsUseCase (cross-reference)
 *
 * Mock pattern: the shared Supabase/local-db doubles in
 * tests/support/fakeRestoreDb.ts; no in-memory Drizzle.
 *
 * Domain use cases are exercised as real instances (not mocked) where possible,
 * receiving mock persistence.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { RestoreService } from '../RestoreService';
import { SeedBabyStepsUseCase } from '../../../domain/babySteps/SeedBabyStepsUseCase';
import { makeFakeSupabase, makeFakeLocalDb } from '../../../../tests/support/fakeRestoreDb';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../local/schema';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncedRepo } from '../../uow/createSyncedRepo';

type LocalDb = ExpoSQLiteDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// 6.2 — RestoreService: restores rows then seeds missing steps without mutation
// ---------------------------------------------------------------------------

describe('6.2 — RestoreService + SeedBabyStepsUseCase: backfill without timestamp mutation', () => {
  const HH = 'hh-restore';
  const BASE_HH = {
    id: HH,
    name: 'Restore Test HH',
    payday_day: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  function babyStepRow(
    n: number,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: `bs-${n}`,
      household_id: HH,
      step_number: n,
      is_completed: false,
      completed_at: null,
      is_manual: false,
      celebrated_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('restores existing baby_steps rows and backfills missing ones via SeedBabyStepsUseCase', async () => {
    // Supabase returns only steps 1, 2, 3 (steps 4-7 missing on remote)
    const remoteRows = [1, 2, 3].map((n) => babyStepRow(n));
    const { supabase } = makeFakeSupabase({
      households: { [HH]: BASE_HH },
      tables: { baby_steps: remoteRows },
      maxSeq: 0,
    });
    const local = makeFakeLocalDb({
      // What the seeder's existence pre-check sees after the restore wrote 1-3.
      existingBabySteps: [{ stepNumber: 1 }, { stepNumber: 2 }, { stepNumber: 3 }],
    });

    // SeedBabyStepsUseCase writes via the oplog synced repo rather than a raw
    // insert — inject a fake repo (via RestoreService's seedDeps) so the
    // backfilled steps are observable.
    const seeded: number[] = [];
    const fakeRepo: SyncedRepo = {
      insert: (row) => {
        seeded.push(row.step_number as number);
      },
      update: jest.fn(),
      softDelete: jest.fn(),
      increment: jest.fn(),
    };

    const svc = new RestoreService(local.db as LocalDb, supabase as SupabaseClient, {
      repo: fakeRepo,
    });
    await svc.restoreHousehold(HH, 'owner', 'user-1');

    const restored = local.written
      .filter((w) => w.table === 'baby_steps')
      .map((w) => w.row.stepNumber as number);
    expect(restored).toEqual([1, 2, 3]);
    // Every step 1-7 ends up present: 1-3 from the snapshot, 4-7 backfilled.
    expect(new Set([...restored, ...seeded])).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
  });

  it('existing row timestamps are not mutated by the seeder backfill (all 7 present → seeder is no-op)', async () => {
    const remoteCreatedAt = '2026-01-01T00:00:00Z';
    const remoteRows = Array.from({ length: 7 }, (_, i) =>
      babyStepRow(i + 1, {
        is_manual: [4, 5, 7].includes(i + 1),
        celebrated_at: i + 1 === 1 ? '2026-02-01T00:00:00Z' : null,
      }),
    );
    const { supabase } = makeFakeSupabase({
      households: { [HH]: BASE_HH },
      tables: { baby_steps: remoteRows },
      maxSeq: 0,
    });
    const local = makeFakeLocalDb({
      existingBabySteps: Array.from({ length: 7 }, (_, i) => ({ stepNumber: i + 1 })),
    });

    const fakeRepo: SyncedRepo = {
      insert: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      increment: jest.fn(),
    };

    const svc = new RestoreService(local.db as LocalDb, supabase as SupabaseClient, {
      repo: fakeRepo,
    });
    await svc.restoreHousehold(HH, 'owner', 'user-1');

    const written = local.written.filter((w) => w.table === 'baby_steps');
    expect(written).toHaveLength(7);
    // Every restored row carries the SERVER's timestamps — if the seeder had
    // written first, createdAt would be a fresh `new Date()`.
    for (const w of written) {
      expect(w.row.createdAt).toBe(remoteCreatedAt);
    }
    // All 7 already exist, so the seeder inserts nothing.
    expect(fakeRepo.insert).not.toHaveBeenCalled();
  });

  it('celebrated_at from restored row is preserved (not overwritten by seeder INSERT OR IGNORE)', async () => {
    const celebratedAt = '2026-04-12T10:05:00Z';
    const remoteCreatedAt = '2026-01-01T00:00:00Z';
    const { supabase } = makeFakeSupabase({
      households: { [HH]: BASE_HH },
      tables: {
        baby_steps: [
          babyStepRow(1, {
            is_completed: true,
            completed_at: '2026-04-12T10:00:00Z',
            celebrated_at: celebratedAt,
            updated_at: '2026-04-12T10:00:00Z',
          }),
        ],
      },
      maxSeq: 0,
    });
    const local = makeFakeLocalDb({ existingBabySteps: [{ stepNumber: 1 }] });

    const seeded: number[] = [];
    const fakeRepo: SyncedRepo = {
      insert: (row) => {
        seeded.push(row.step_number as number);
      },
      update: jest.fn(),
      softDelete: jest.fn(),
      increment: jest.fn(),
    };

    const svc = new RestoreService(local.db as LocalDb, supabase as SupabaseClient, {
      repo: fakeRepo,
    });
    await svc.restoreHousehold(HH, 'owner', 'user-1');

    const step1 = local.written.find((w) => w.table === 'baby_steps')?.row;
    expect(step1).toMatchObject({ celebratedAt, createdAt: remoteCreatedAt });
    // The seeder only backfills the steps that were missing — never step 1.
    expect(seeded).not.toContain(1);
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
    const HH = 'hh-race';
    const { supabase } = makeFakeSupabase({
      households: {
        [HH]: {
          id: HH,
          name: 'Race HH',
          payday_day: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
      // All entity tables empty — only the seeder writes baby_steps rows.
      maxSeq: 0,
    });

    // Shared state simulating a real DB: rows keyed by (householdId, stepNumber).
    const rows = new Map<string, unknown>();
    const local = makeFakeLocalDb({
      // SeedBabyStepsUseCase's existence pre-check reads the same shared map
      // both seeder invocations write into.
      existingBabySteps: () =>
        Array.from(rows.keys())
          .filter((k) => k.startsWith(`${HH}:`))
          .map((k) => ({ stepNumber: Number(k.split(':')[1]) })),
    });

    // Reproduces the real `createSyncedRepo`'s race behavior: a second writer
    // for the same (household_id, step_number) hits the same
    // UNIQUE-constraint-shaped error, which the use case's own catch treats
    // as an idempotent no-op (see SeedBabyStepsUseCase.ts).
    const fakeRepo: SyncedRepo = {
      insert: (row) => {
        const key = `${row.household_id as string}:${row.step_number as number}`;
        if (rows.has(key)) {
          throw new Error(
            'UNIQUE constraint failed: baby_steps.household_id, baby_steps.step_number',
          );
        }
        rows.set(key, row);
      },
      update: jest.fn(),
      softDelete: jest.fn(),
      increment: jest.fn(),
    };

    const svc = new RestoreService(local.db as LocalDb, supabase as SupabaseClient, {
      repo: fakeRepo,
    });
    const externalSeeder = new SeedBabyStepsUseCase(local.db as LocalDb, { repo: fakeRepo });

    await expect(
      Promise.all([svc.restoreHousehold(HH, 'owner', 'user-1'), externalSeeder.execute(HH)]),
    ).resolves.not.toThrow();

    expect(Array.from(rows.keys()).filter((k) => k.startsWith(`${HH}:`))).toHaveLength(7);
  });
});

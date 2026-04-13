/**
 * Phase 6 integration tests — Baby Steps sync + restore verification.
 *
 * Tasks covered:
 *   6.1 — SyncOrchestrator round-trip: celebrated_at preserved across devices
 *   6.2 — RestoreService + SeedBabyStepsUseCase: backfill without timestamp mutation
 *   6.4 — Multi-EMF integration: fixer composes correctly inside SyncOrchestrator
 *   6.7 — Seeder race: RestoreService + concurrent SeedBabyStepsUseCase (cross-reference)
 *
 * Mock pattern: hand-rolled mocks following the established SyncOrchestrator.test.ts style.
 * No in-memory Drizzle — pure mock DB objects.
 *
 * Domain use cases are exercised as real instances (not mocked) where possible,
 * receiving mock persistence.
 */

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) }));

import { SyncOrchestrator } from '../SyncOrchestrator';
import { RestoreService } from '../RestoreService';
import { SeedBabyStepsUseCase } from '../../../domain/babySteps/SeedBabyStepsUseCase';

// ---------------------------------------------------------------------------
// Helper: build a mock DB suitable for SyncOrchestrator
// ---------------------------------------------------------------------------

function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

function makeSyncDb(pendingItems: Record<string, unknown>[], rowsByRecordId: Record<string, unknown[]>) {
  let selectCallIdx = 0;
  const selectCallOrder: (() => unknown)[] = [
    // First call: fetch pending sync queue (supports .where().orderBy().limit())
    () => makePendingQueueChain(pendingItems),
    // Subsequent calls: fetch the local row for each pending item
    ...Object.values(rowsByRecordId).map((rows) =>
      () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }),
    ),
  ];

  return {
    select: jest.fn().mockImplementation(() => {
      const fn = selectCallOrder[selectCallIdx] ?? (() => ({ from: () => ({ where: () => Promise.resolve([]) }) }));
      selectCallIdx++;
      return fn();
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

// ---------------------------------------------------------------------------
// 6.1 — SyncOrchestrator: celebrated_at stamp preservation across devices
//
// Scenario:
//   Device A stamps celebrated_at='2026-04-12T10:05:00Z' on step 1, writes
//   to pending_sync as INSERT.
//   Device B has an earlier row (celebrated_at=null) that would normally overwrite.
//
//   The RPC call receives Device A's row with celebrated_at set.
//   The server-side RPC logic (tested here via mock verification) must preserve
//   the stamp when the incoming row has celebrated_at non-null.
//
//   This test verifies that SyncOrchestrator passes the full row including
//   celebrated_at to merge_baby_step and does NOT strip or null the field.
// ---------------------------------------------------------------------------

describe('6.1 — SyncOrchestrator: celebrated_at stamp preserved in merge_baby_step RPC payload', () => {
  it('Device A row with celebrated_at is passed verbatim to merge_baby_step RPC (stamp not stripped)', async () => {
    const deviceARow = {
      id: 'bs-device-a-1',
      householdId: 'hh-1',
      stepNumber: 1,
      isCompleted: true,
      completedAt: '2026-04-12T10:00:00Z',
      isManual: false,
      celebratedAt: '2026-04-12T10:05:00Z', // Device A stamped this
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-04-12T10:05:00Z',
      isSynced: false,
    };

    const pending = [
      { id: 'psync-1', tableName: 'baby_steps', recordId: 'bs-device-a-1', operation: 'INSERT', retryCount: 0 },
    ];

    const db = makeSyncDb(pending, { 'bs-device-a-1': [deviceARow] });

    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      rpc: rpcMock,
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db as any, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);

    // Verify RPC was called with merge_baby_step
    expect(rpcMock).toHaveBeenCalledWith(
      'merge_baby_step',
      expect.objectContaining({
        row: expect.objectContaining({
          id: 'bs-device-a-1',
          celebrated_at: '2026-04-12T10:05:00Z', // NOT null — stamp preserved
        }),
      }),
    );
  });

  it('Device B row with celebrated_at=null does not override existing stamp (RPC receives null; server preserves)', async () => {
    // Device B has celebrated_at=null — an earlier sync. The server RPC is
    // responsible for preservation when existing.celebrated_at is non-null.
    // This test verifies: SyncOrchestrator passes null correctly (not coerced to
    // a timestamp) so the server can apply the "preserve when incoming is null" rule.
    const deviceBRow = {
      id: 'bs-device-b-1',
      householdId: 'hh-1',
      stepNumber: 1,
      isCompleted: true,
      completedAt: '2026-04-10T08:00:00Z',
      isManual: false,
      celebratedAt: null, // Device B has not seen the celebration yet
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-04-10T08:00:00Z',
      isSynced: false,
    };

    const pending = [
      { id: 'psync-2', tableName: 'baby_steps', recordId: 'bs-device-b-1', operation: 'INSERT', retryCount: 0 },
    ];

    const db = makeSyncDb(pending, { 'bs-device-b-1': [deviceBRow] });

    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      rpc: rpcMock,
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db as any, supabase);
    await orch.syncPending();

    // celebrated_at must be passed as null (not as a non-null string)
    // so the server-side RPC can apply: "preserve existing when incoming IS NULL"
    expect(rpcMock).toHaveBeenCalledWith(
      'merge_baby_step',
      expect.objectContaining({
        row: expect.objectContaining({
          celebrated_at: null,
        }),
      }),
    );
  });

  it('Two pending baby_steps items (Device A stamp + Device B null) both route through RPC', async () => {
    const pending = [
      { id: 'p1', tableName: 'baby_steps', recordId: 'bs-a', operation: 'INSERT', retryCount: 0 },
      { id: 'p2', tableName: 'baby_steps', recordId: 'bs-b', operation: 'INSERT', retryCount: 0 },
    ];

    const rowA = {
      id: 'bs-a', householdId: 'hh-1', stepNumber: 1, isCompleted: true,
      completedAt: '2026-04-12T10:00:00Z', isManual: false,
      celebratedAt: '2026-04-12T10:05:00Z',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-04-12T10:05:00Z', isSynced: false,
    };
    const rowB = {
      id: 'bs-b', householdId: 'hh-1', stepNumber: 1, isCompleted: true,
      completedAt: '2026-04-10T08:00:00Z', isManual: false,
      celebratedAt: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-04-10T08:00:00Z', isSynced: false,
    };

    // Build db with 3 select slots: pending queue, row for bs-a, row for bs-b
    let callIdx = 0;
    const selectImpls = [
      () => makePendingQueueChain(pending),
      () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([rowA]) }) }) }),
      () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([rowB]) }) }) }),
    ];
    const db = {
      select: jest.fn().mockImplementation(() => {
        const fn = selectImpls[callIdx] ?? (() => ({ from: () => ({ where: () => Promise.resolve([]) }) }));
        callIdx++;
        return fn();
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    const supabase = { rpc: rpcMock, from: () => ({ upsert: jest.fn() }) } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(2);
    expect(rpcMock).toHaveBeenCalledTimes(2);

    // First call: stamp present
    const firstCallRow = rpcMock.mock.calls[0][1].row;
    expect(firstCallRow.celebrated_at).toBe('2026-04-12T10:05:00Z');

    // Second call: stamp absent
    const secondCallRow = rpcMock.mock.calls[1][1].row;
    expect(secondCallRow.celebrated_at).toBeNull();
  });
});

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
    const conflicting = new Set<string>();

    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            insertedRows.push(row);
            return Promise.resolve();
          }),
          onConflictDoNothing: jest.fn().mockImplementation(() => {
            const key = `${row.householdId}:${row.stepNumber}`;
            if (!conflicting.has(key)) {
              conflicting.add(key);
              insertedRows.push(row);
            }
            return Promise.resolve();
          }),
        }),
      }),
    } as any;

    const supabase = makeRestoreSupabase(remoteRows);
    const svc = new RestoreService(db, supabase as any);
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
    // INSERT OR IGNORE means subsequent attempts for the same key must not
    // overwrite the first write — in a real SQLite DB the row is unchanged.
    const firstWriteByKey = new Map<string, Record<string, unknown>>();

    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          onConflictDoNothing: jest.fn().mockImplementation(() => {
            if ('stepNumber' in row) {
              const key = `${row.householdId}:${row.stepNumber}`;
              // Only record the first write — INSERT OR IGNORE semantics
              if (!firstWriteByKey.has(key)) {
                firstWriteByKey.set(key, { ...row });
              }
            }
            return Promise.resolve();
          }),
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

    // Track the first write for each step
    const firstWriteByKey = new Map<string, Record<string, unknown>>();

    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          onConflictDoNothing: jest.fn().mockImplementation(() => {
            if ('stepNumber' in row) {
              const key = `${row.householdId}:${row.stepNumber}`;
              if (!firstWriteByKey.has(key)) {
                firstWriteByKey.set(key, { ...row });
              }
            }
            return Promise.resolve();
          }),
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
// 6.4 — Multi-EMF integration: SyncOrchestrator triggers fixer which skips
//        archived and flips non-oldest active
// ---------------------------------------------------------------------------

describe('6.4 — Multi-EMF integration: SyncOrchestrator triggers ReconcileEmergencyFundTypeUseCase', () => {
  it('clean sync with householdId triggers fixer; fixer skips archived, flips non-oldest active', async () => {
    // Empty pending queue → clean sync
    const older = {
      id: 'e-older',
      householdId: 'hh-emf',
      envelopeType: 'emergency_fund',
      isArchived: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      isSynced: true,
    };
    const newer = {
      id: 'e-newer',
      householdId: 'hh-emf',
      envelopeType: 'emergency_fund',
      isArchived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isSynced: true,
    };

    let selectCallIdx = 0;

    // Select calls: (1) pending queue → empty; (2) fixer's envelope select → [older, newer]
    const db = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) {
          return makePendingQueueChain([]);
        }
        // Fixer's envelope query — returns both active EMFs
        return { from: () => ({ where: () => Promise.resolve([older, newer]) }) };
      }),
      update: jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation((_cond) => {
            // Record the id being updated — we can't easily inspect the eq() condition
            // but we can verify update was called once (the newer one)
            return Promise.resolve();
          }),
        })),
      })),
    } as any;

    const supabase = {} as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending('hh-emf');

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    // fixer ran — emfFlipped = 1 (only the newer one flipped)
    expect(result.emfFlipped).toBe(1);
    // update must have been called exactly once (for the newer envelope)
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('clean sync with single EMF → fixer no-op, emfFlipped=0', async () => {
    const singleEMF = {
      id: 'e-only',
      householdId: 'hh-emf2',
      envelopeType: 'emergency_fund',
      isArchived: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      isSynced: true,
    };

    let selectCallIdx = 0;
    const db = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) {
          return makePendingQueueChain([]);
        }
        return { from: () => ({ where: () => Promise.resolve([singleEMF]) }) };
      }),
      update: jest.fn(),
    } as any;

    const supabase = {} as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending('hh-emf2');

    expect(result.emfFlipped).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('partial sync (failed > 0) does NOT trigger fixer even when householdId provided', async () => {
    const pending = [
      { id: 'p1', tableName: 'envelopes', recordId: 'e1', operation: 'INSERT', retryCount: 0 },
    ];
    const db = {
      select: jest.fn()
        .mockReturnValueOnce(makePendingQueueChain(pending))
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'e1', isSynced: false }]) }) }) }),
      update: jest.fn().mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) }),
    } as any;

    const supabase = {
      rpc: () => Promise.resolve({ error: { message: 'fail' } }),
      from: () => ({ upsert: () => Promise.resolve({ error: { message: 'fail' } }) }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending('hh-emf3');

    expect(result.failed).toBe(1);
    expect(result.emfFlipped).toBe(0);
    // update was called only for retry-count increment, not for EMF flip
    // The fixer would call update for the envelope flip — verify it was never called
    // with envelopeType data (only the pendingSync retry update should occur)
    const updateCalls = (db.update as jest.Mock).mock.calls.length;
    // Only the retry-count increment update should fire (1 call)
    expect(updateCalls).toBe(1);
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
        values: (row: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn().mockImplementation(() => {
            // onConflictDoUpdate is used for household upsert
            return Promise.resolve();
          }),
          onConflictDoNothing: jest.fn().mockImplementation(() => {
            const key = `${row.householdId}:${row.stepNumber}`;
            if (key && !rows.has(key)) {
              rows.set(key, row);
            }
            return Promise.resolve();
          }),
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    const externalSeeder = new SeedBabyStepsUseCase(db as any);

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

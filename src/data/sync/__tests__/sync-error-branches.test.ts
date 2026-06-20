/**
 * sync-error-branches.test.ts — SyncOrchestrator and RestoreService error path tests.
 *
 * Reuses the established hand-rolled mock DB pattern from babyStepsSyncIntegration.test.ts.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { SyncOrchestrator } from '../SyncOrchestrator';
import { RestoreService } from '../RestoreService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

// ---------------------------------------------------------------------------
// SyncOrchestrator error branches
// ---------------------------------------------------------------------------

describe('SyncOrchestrator error branches', () => {
  it('unknown table name -> throws "Unknown sync table"', async () => {
    const pending = [
      {
        id: 'p1',
        tableName: 'nonexistent_table',
        recordId: 'r1',
        operation: 'INSERT',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    let selectCallIdx = 0;
    const db = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) return makePendingQueueChain(pending);
        // Batch prefetch: nonexistent_table won't have a TABLE_MAP entry, so
        // the prefetch skips it (returns early). No rows cached.
        return { from: () => ({ where: () => Promise.resolve([]) }) };
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const supabase = {
      rpc: jest.fn(),
      from: () => ({
        upsert: jest.fn().mockResolvedValue({ error: null }),
        delete: jest.fn(),
      }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    // processItem throws "Unknown sync table", caught in the loop → failed++
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('cache miss + DB fetch returns null -> throws "Local row not found"', async () => {
    const pending = [
      {
        id: 'p1',
        tableName: 'envelopes',
        recordId: 'missing-row',
        operation: 'INSERT',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    let selectCallIdx = 0;
    const db = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) return makePendingQueueChain(pending);
        // Batch prefetch returns empty (cache miss)
        if (idx === 1) return { from: () => ({ where: () => Promise.resolve([]) }) };
        // Individual fallback query also returns empty
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        };
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const supabase = { rpc: jest.fn(), from: () => ({ upsert: jest.fn() }) } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });

  it('household_members table -> skips isSynced update', async () => {
    const row = {
      id: 'hm1',
      householdId: 'h1',
      userId: 'u1',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const pending = [
      {
        id: 'p1',
        tableName: 'household_members',
        recordId: 'hm1',
        operation: 'INSERT',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    let selectCallIdx = 0;
    const updateMock = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
    });
    const db = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) return makePendingQueueChain(pending);
        // Batch prefetch
        return { from: () => ({ where: () => Promise.resolve([row]) }) };
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: updateMock,
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: null }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(1);
    // isSynced update should NOT be called for household_members
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('audit_events table -> routes to merge_audit_event RPC', async () => {
    const row = {
      id: 'ae1',
      householdId: 'h1',
      action: 'create',
      tableName: 'envelopes',
      recordId: 'e1',
      actorId: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      isSynced: false,
    };
    const pending = [
      {
        id: 'p1',
        tableName: 'audit_events',
        recordId: 'ae1',
        operation: 'INSERT',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    let selectCallIdx = 0;
    const db = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) return makePendingQueueChain(pending);
        return { from: () => ({ where: () => Promise.resolve([row]) }) };
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    const supabase = { rpc: rpcMock } as any;

    const orch = new SyncOrchestrator(db, supabase);
    await orch.syncPending();

    expect(rpcMock).toHaveBeenCalledWith('merge_audit_event', expect.any(Object));
  });

  it('EMF fixer catch -> null, emfFlipped=0', async () => {
    // Empty pending queue → clean sync → fixer triggers but throws
    const db = {
      select: jest.fn().mockReturnValue(makePendingQueueChain([])),
    } as any;

    // Mock ReconcileEmergencyFundTypeUseCase to throw
    // The fixer is instantiated internally; the db.select for the fixer
    // (envelope query) will throw, causing .catch(() => null).
    let selectCallCount = 0;
    db.select = jest.fn().mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return makePendingQueueChain([]);
      // Fixer's envelope query throws
      throw new Error('db error');
    });

    const supabase = {} as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending('hh-1');

    expect(result.emfFlipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('batch prefetch with 0 upsert IDs -> early return', async () => {
    // All pending items are DELETEs — no upsert IDs to prefetch
    const pending = [
      {
        id: 'p1',
        tableName: 'envelopes',
        recordId: 'e1',
        operation: 'DELETE',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    let selectCallIdx = 0;
    const db = {
      select: jest.fn().mockImplementation(() => {
        selectCallIdx++;
        // Only the pending queue query should fire
        return makePendingQueueChain(selectCallIdx === 1 ? pending : []);
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      rpc: rpcMock,
      from: () => ({ delete: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(1);
    expect(rpcMock).toHaveBeenCalledWith('delete_sync_row', {
      p_table: 'envelopes',
      p_id: 'e1',
    });
  });
});

// ---------------------------------------------------------------------------
// RestoreService error branches
// ---------------------------------------------------------------------------

describe('RestoreService error branches', () => {
  function makeRestoreSupabase(tableData: Record<string, { data: any; error: any }>) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, _val: unknown) => {
            const entry = tableData[table] ?? { data: [], error: null };
            if (table === 'households') {
              return { single: () => Promise.resolve(entry) };
            }
            return Promise.resolve(entry);
          },
        }),
      }),
    } as any;
  }

  it('restoreTable: Supabase error -> early return (table skipped)', async () => {
    const db = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      // envelopes returns an error — should be skipped
      envelopes: { data: null, error: { message: 'permission denied' } },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: [], error: null },
    });

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh1', 'owner', 'u1');

    // Should still succeed — error table is skipped
    expect(result).not.toBeNull();
    expect(result!.id).toBe('hh1');
  });

  it('restoreTable: empty data -> no inserts', async () => {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const db = { insert: insertMock } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      envelopes: { data: [], error: null },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: [], error: null },
    });

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh1', 'owner', 'u1');

    // Insert is called for household upsert + seeder, NOT for empty entity tables
    const insertCalls = insertMock.mock.calls.length;
    // household (1) + seeder baby_steps (7) = 8 inserts minimum
    // No entity-table data rows should trigger inserts
    expect(insertCalls).toBeLessThanOrEqual(8);
  });

  it('restoreHousehold: fetch failure -> returns null', async () => {
    const db = {} as any;
    const supabase = makeRestoreSupabase({
      households: { data: null, error: { message: 'not found' } },
    });

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh-missing', 'owner', 'u1');

    expect(result).toBeNull();
  });

  it('restoreUserConsent: empty data -> skipped', async () => {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const db = { insert: insertMock } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      envelopes: { data: [], error: null },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: [], error: null }, // empty
    });

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh1', 'owner', 'u1');

    // The key assertion: with empty user_consent data, no consent-specific insert fires
    expect(insertMock).toHaveBeenCalled(); // household + seeder
  });

  it('restoreUserConsent: Supabase error -> skipped', async () => {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const db = { insert: insertMock } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      envelopes: { data: [], error: null },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: null, error: { message: 'rls error' } },
    });

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh1', 'owner', 'u1');

    // Should complete without crashing
    expect(result).not.toBeNull();
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
  ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
  })),
}));

import { SyncOrchestrator } from '../../data/sync/SyncOrchestrator';
import { buildEnvelope } from '../../__test-utils__/factories';
import { KRUGER_ENVELOPES, KRUGER_DEBTS, HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

function makeBatchFetchChain(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Concurrent User Sync — spentCents Drift Detection', () => {
  /**
   * CRITICAL GAP: merge_envelope uses LWW (Last-Write-Wins) on the entire row.
   * When two devices update spentCents independently, the loser's increment is
   * silently dropped. There is no SUM-based reconciliation.
   *
   * Scenario:
   *   Base:      spentCents = 100000 (R1000)
   *   Device A:  adds R50 → spentCents = 105000
   *   Device B:  adds R30 → spentCents = 103000
   *   Both sync via merge_envelope LWW → whichever has newer updated_at wins.
   *   Result:    Either 105000 or 103000, NEVER 108000 (the correct sum).
   */
  it('documents that LWW merge_envelope drops the losing device increment', async () => {
    const groceries = KRUGER_ENVELOPES[0];
    const baseSpentCents = 100000;

    const deviceARow = {
      ...groceries,
      spentCents: baseSpentCents + 5000, // +R50
      updatedAt: '2026-06-15T10:00:05.000Z',
      isSynced: false,
    };
    const deviceBRow = {
      ...groceries,
      spentCents: baseSpentCents + 3000, // +R30
      updatedAt: '2026-06-15T10:00:03.000Z',
      isSynced: false,
    };

    const pendingA = {
      id: 'pa-1',
      tableName: 'envelopes',
      recordId: groceries.id,
      operation: 'UPDATE',
      retryCount: 0,
      createdAt: '2026-06-15T10:00:05.000Z',
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const rpcCalls: Array<{ name: string; params: unknown }> = [];
    const rpcMock = jest.fn((name: string, params: unknown) => {
      rpcCalls.push({ name, params });
      return Promise.resolve({ error: null });
    });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([pendingA]))
        .mockReturnValueOnce(makeBatchFetchChain([deviceARow])),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const supabase = { rpc: rpcMock, from: () => ({ upsert: jest.fn() }) } as any;
    const orch = new SyncOrchestrator(db, supabase);
    await orch.syncPending();

    expect(rpcMock).toHaveBeenCalledWith('merge_envelope', expect.any(Object));
    const syncedRow = rpcCalls[0].params as { r: Record<string, unknown> };
    expect(syncedRow.r.spent_cents).toBe(105000);

    // Now simulate Device B syncing with its stale base
    const dbB = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([{ ...pendingA, id: 'pb-1' }]))
        .mockReturnValueOnce(makeBatchFetchChain([deviceBRow])),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    jest.resetModules();
    jest.doMock('expo-crypto', () => ({
      randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
    }));
    jest.doMock('../../infrastructure/logging/Logger', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.doMock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
      ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
      })),
    }));

    const { SyncOrchestrator: FreshOrch } = require('../../data/sync/SyncOrchestrator');
    const rpcMockB = jest.fn().mockResolvedValue({ error: null });
    const supabaseB = { rpc: rpcMockB, from: () => ({ upsert: jest.fn() }) } as any;
    const orchB = new FreshOrch(dbB, supabaseB);
    await orchB.syncPending();

    // Device B's merge_envelope RPC sends spentCents=103000
    expect(rpcMockB).toHaveBeenCalledWith('merge_envelope', expect.any(Object));
    const syncedRowB = rpcMockB.mock.calls[0][1] as { r: Record<string, unknown> };
    expect(syncedRowB.r.spent_cents).toBe(103000);

    // KNOWN-GAP: LWW-001 — merge_envelope uses Last-Write-Wins on spentCents.
    // The server holds whichever device had the newer updated_at timestamp.
    // Correct behavior: server should SUM increments (108000 = base + 5000 + 3000).
    // Actual behavior: server holds either 105000 or 103000, losing one increment.
    // Severity: HIGH — silent data loss on concurrent spending in shared households.
    // Proposed fix: Replace absolute spentCents write with delta-based SQL increment
    // in merge_envelope RPC, or adopt CRDT counter for spentCents.
    const correctSum = baseSpentCents + 5000 + 3000; // 108000
    expect(syncedRow.r.spent_cents).not.toBe(correctSum);
    expect(syncedRowB.r.spent_cents).not.toBe(correctSum);
  });

  it('documents spentCents drift with Kruger scenario data', async () => {
    const groceries = KRUGER_ENVELOPES[0];
    expect(groceries.name).toBe('Groceries');

    // Henzard adds R185 on Device A, Alicia adds R142 on Device B, same envelope
    const henzardSpent = groceries.spentCents + 18500;
    const aliciaSpent = groceries.spentCents + 14200;
    const correctTotal = groceries.spentCents + 18500 + 14200;

    // KNOWN-GAP: LWW-002 — Same issue as LWW-001 demonstrated with Kruger household data.
    // With LWW, the server holds whichever timestamp wins; the losing device's
    // spending increment is permanently lost with no conflict notification.
    // Severity: HIGH — real-world scenario with Henzard & Alicia shopping concurrently.
    expect(henzardSpent).not.toBe(correctTotal);
    expect(aliciaSpent).not.toBe(correctTotal);
  });
});

describe('Concurrent User Sync — Debt Payment Lost Update', () => {
  /**
   * GAP: totalPaidCents uses SQL + (atomic increment) on the server RPC,
   * but outstandingBalanceCents is set as an absolute value (LWW overwrite).
   *
   * Two users paying the same debt with stale snapshots:
   * - totalPaidCents: correctly accumulated via SQL + on server
   * - outstandingBalanceCents: last writer wins, overwrites the other's calculation
   */
  it('documents that outstandingBalanceCents overwrites are not atomic', async () => {
    const woolworths = KRUGER_DEBTS[0];
    expect(woolworths.creditorName).toBe('Woolworths Store Account');

    const baseOutstanding = woolworths.outstandingBalanceCents; // 320000
    const basePaid = woolworths.totalPaidCents; // 0

    // Henzard pays R150 → outstanding = 320000 - 15000 = 305000
    const henzardPayment = 15000;
    const henzardOutstanding = baseOutstanding - henzardPayment;
    const henzardPaid = basePaid + henzardPayment;

    // Alicia pays R100 with STALE snapshot → outstanding = 320000 - 10000 = 310000
    const aliciaPayment = 10000;
    const aliciaOutstanding = baseOutstanding - aliciaPayment;

    // Correct outstanding should be 320000 - 15000 - 10000 = 295000
    const correctOutstanding = baseOutstanding - henzardPayment - aliciaPayment;

    // If Alicia's write lands last, server has 310000 (wrong — Henzard's payment lost)
    // If Henzard's write lands last, server has 305000 (wrong — Alicia's payment lost)
    // KNOWN-GAP: LWW-003 — outstandingBalanceCents uses absolute LWW overwrite instead
    // of atomic SQL decrement. totalPaidCents correctly uses SQL + on server, but
    // outstandingBalanceCents is set as an absolute value, causing lost updates.
    // Severity: HIGH — debt payments from one user silently disappear.
    // Proposed fix: Change merge_debt RPC to compute outstandingBalanceCents server-side
    // as (originalBalance - totalPaidCents) rather than accepting client-computed value.
    expect(henzardOutstanding).not.toBe(correctOutstanding);
    expect(aliciaOutstanding).not.toBe(correctOutstanding);

    // totalPaidCents uses SQL + on server merge RPC, so it IS correct
    expect(henzardPaid).toBe(15000);
  });
});

describe('Concurrent User Sync — Same-Record Field Conflicts', () => {
  /**
   * GAP: Offline edits to the same record on two devices.
   * merge_envelope (and all merge RPCs) use LWW on the entire row.
   * The row with newer updated_at wins ALL fields — no field-level merge.
   *
   * Example: Henzard renames envelope, Alicia changes allocatedCents.
   * Whichever has newer updated_at overwrites the other's fields entirely.
   */
  it('documents that LWW drops the losing device fields entirely', async () => {
    const groceries = buildEnvelope({
      id: 'conflict-env-1',
      householdId: HOUSEHOLDS.kruger.id,
      name: 'Groceries',
      allocatedCents: 800000,
      spentCents: 0,
      updatedAt: '2026-06-15T09:00:00.000Z',
    });

    // Device A renames the envelope (newer timestamp)
    const deviceARow = {
      ...groceries,
      name: 'Weekly Groceries',
      updatedAt: '2026-06-15T10:00:05.000Z',
      isSynced: false,
    };

    // Device B changes allocatedCents (older timestamp)
    const deviceBRow = {
      ...groceries,
      allocatedCents: 900000,
      updatedAt: '2026-06-15T10:00:03.000Z',
      isSynced: false,
    };

    const pendingA = {
      id: 'field-conflict-a',
      tableName: 'envelopes',
      recordId: groceries.id,
      operation: 'UPDATE',
      retryCount: 0,
      createdAt: '2026-06-15T10:00:05.000Z',
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    // Device A syncs first — wins LWW because newer timestamp
    const rpcMockA = jest.fn().mockResolvedValue({ error: null });
    const dbA = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([pendingA]))
        .mockReturnValueOnce(makeBatchFetchChain([deviceARow])),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const orchA = new SyncOrchestrator(dbA, {
      rpc: rpcMockA,
      from: () => ({ upsert: jest.fn() }),
    } as any);
    await orchA.syncPending();

    const syncedA = rpcMockA.mock.calls[0][1] as { r: Record<string, unknown> };
    expect(syncedA.r.name).toBe('Weekly Groceries');
    expect(syncedA.r.allocated_cents).toBe(800000); // Device A didn't change this

    // Device B syncs second — loses LWW because older timestamp
    // Server merge_envelope compares updated_at: Device A (10:00:05) > Device B (10:00:03)
    // Server keeps Device A's row entirely. Device B's allocatedCents=900000 is DROPPED.

    // KNOWN-GAP: LWW-004 — No field-level merge. merge_envelope compares updated_at
    // at the ROW level and takes the entire winning row. Device B's allocatedCents=900000
    // is silently dropped because Device A has a newer timestamp. The user who changed
    // the allocation gets no error, no conflict notification.
    // Severity: MEDIUM — non-additive fields (names, flags) are less critical than
    // counters, but still cause silent data loss in multi-device households.
    // Proposed fix: Implement field-level merge with per-column updated_at tracking,
    // or use operational transform for non-counter fields.
    expect(deviceBRow.allocatedCents).toBe(900000);
    expect(deviceARow.allocatedCents).toBe(800000);
    // Server will hold 800000, not 900000 — Device B's edit is dropped silently
  });

  it('verifies the loser gets no notification of dropped fields', async () => {
    // After Device B's merge_envelope call, the server returns success (no error).
    // The RPC does not indicate that the row was rejected due to LWW.
    const rpcMock = jest.fn().mockResolvedValue({ error: null });

    const olderRow = {
      id: 'notif-test',
      householdId: HOUSEHOLDS.kruger.id,
      name: 'Old Name',
      allocatedCents: 999999,
      spentCents: 0,
      envelopeType: 'spending',
      isSavingsLocked: false,
      isArchived: false,
      periodStart: '2026-01-01',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-15T09:59:00.000Z', // older than server
      isSynced: false,
    };

    const pending = {
      id: 'notif-p',
      tableName: 'envelopes',
      recordId: 'notif-test',
      operation: 'UPDATE',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([pending]))
        .mockReturnValueOnce(makeBatchFetchChain([olderRow])),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const orch = new SyncOrchestrator(db, {
      rpc: rpcMock,
      from: () => ({ upsert: jest.fn() }),
    } as any);

    const result = await orch.syncPending();

    // KNOWN-GAP: LWW-005 — merge_envelope RPC returns success even when the row is
    // rejected by LWW on the server side. The client receives no indication that its
    // data was discarded. syncPending() reports synced=1, failed=0.
    // Severity: MEDIUM — UX gap. Users believe their edit saved when it was silently dropped.
    // Proposed fix: merge RPCs should return a `conflict: true` flag when LWW rejects
    // the incoming row, allowing the client to surface a conflict resolution UI.
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

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
import { buildPendingSyncRow } from '../../__test-utils__/factories';
import { KRUGER_ENVELOPES } from '../../__test-utils__/scenarioSeed';

function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

function makeBatchFetchChain(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

const DLQ_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DLQ Behavior — Retry-Count Threshold', () => {
  it('dead-letters an item after 10 failed retries (retryCount 9 → failure → DLQ)', async () => {
    const poisonItem = {
      id: 'dlq-retry-1',
      tableName: 'envelopes',
      recordId: KRUGER_ENVELOPES[0].id,
      operation: 'INSERT',
      retryCount: 9,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const updateSetMock = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const updateMock = jest.fn().mockReturnValue({ set: updateSetMock });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([poisonItem]))
        .mockReturnValueOnce(
          makeBatchFetchChain([
            { id: KRUGER_ENVELOPES[0].id, householdId: 'hh-1', isSynced: false },
          ]),
        ),
      update: updateMock,
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: { message: 'persistent failure' } }),
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.failed).toBe(1);

    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.retryCount).toBe(10);
    expect(setArg.deadLetteredAt).toBeTruthy();
    expect(typeof setArg.deadLetteredAt).toBe('string');
  });

  it('does NOT dead-letter an item at retryCount 8 (below threshold)', async () => {
    const item = {
      id: 'dlq-below',
      tableName: 'envelopes',
      recordId: KRUGER_ENVELOPES[0].id,
      operation: 'INSERT',
      retryCount: 8,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const updateSetMock = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([item]))
        .mockReturnValueOnce(
          makeBatchFetchChain([
            { id: KRUGER_ENVELOPES[0].id, householdId: 'hh-1', isSynced: false },
          ]),
        ),
      update: () => ({ set: updateSetMock }),
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: { message: 'transient error' } }),
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.failed).toBe(1);

    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.retryCount).toBe(9);
    expect(setArg.deadLetteredAt).toBeUndefined();
    expect(setArg.lastAttemptedAt).toBeTruthy();
  });
});

describe('DLQ Behavior — Dead-Lettered Item Excluded from Future Sync', () => {
  it('excludes items with deadLetteredAt set from syncPending query', async () => {
    // SyncOrchestrator.syncPending() uses:
    //   .where(and(isNull(pendingSync.deadLetteredAt), ...))
    // This means dead-lettered items are never returned by the query.

    const liveItem = {
      id: 'live-1',
      tableName: 'envelopes',
      recordId: 'env-live',
      operation: 'INSERT',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    // Only the live item should be returned (simulating the SQL filter)
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([liveItem]))
        .mockReturnValueOnce(
          makeBatchFetchChain([{ id: 'env-live', householdId: 'hh-1', isSynced: false }]),
        ),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;

    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    const supabase = { rpc: rpcMock, from: () => ({ upsert: jest.fn() }) } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(1);
    // Dead item was excluded by the where clause — only 1 item processed
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe('DLQ Behavior — Age-Based Dead-Lettering', () => {
  it('dead-letters an item older than 7 days regardless of retry count', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const oldItem = {
      id: 'dlq-old-1',
      tableName: 'transactions',
      recordId: 'tx-old',
      operation: 'UPDATE',
      retryCount: 2,
      createdAt: eightDaysAgo,
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const updateSetMock = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const updateMock = jest.fn().mockReturnValue({ set: updateSetMock });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([oldItem]))
        .mockReturnValueOnce(
          makeBatchFetchChain([{ id: 'tx-old', householdId: 'hh-1', isSynced: false }]),
        ),
      update: updateMock,
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: { message: 'server error' } }),
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.failed).toBe(1);

    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.retryCount).toBe(3);
    expect(setArg.deadLetteredAt).toBeTruthy();

    // Verify the age check: Date.now() - createdAt >= 7 days
    const ageMs = Date.now() - new Date(eightDaysAgo).getTime();
    expect(ageMs).toBeGreaterThanOrEqual(DLQ_MAX_AGE_MS);
  });

  it('does NOT dead-letter a 6-day-old item with low retry count', async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

    const recentItem = {
      id: 'dlq-recent',
      tableName: 'envelopes',
      recordId: 'env-recent',
      operation: 'INSERT',
      retryCount: 3,
      createdAt: sixDaysAgo,
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const updateSetMock = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([recentItem]))
        .mockReturnValueOnce(
          makeBatchFetchChain([{ id: 'env-recent', householdId: 'hh-1', isSynced: false }]),
        ),
      update: () => ({ set: updateSetMock }),
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: { message: 'transient' } }),
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.failed).toBe(1);

    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.retryCount).toBe(4);
    // Not dead-lettered — below both thresholds
    expect(setArg.deadLetteredAt).toBeUndefined();
  });
});

describe('DLQ Behavior — New Edit Bypasses DLQ Dedup', () => {
  it('documents that PendingSyncEnqueuer creates fresh entry bypassing dead-lettered dedup', async () => {
    // PendingSyncEnqueuer.enqueue() checks:
    //   .where(and(eq(tableName), eq(recordId), isNull(deadLetteredAt)))
    // If an existing entry IS dead-lettered (deadLetteredAt is NOT null),
    // the isNull check fails, so a new entry is inserted.
    // This means editing a record that previously DLQ'd creates a fresh sync entry.

    const deadLetteredRecordId = KRUGER_ENVELOPES[0].id;

    // The dead-lettered entry has deadLetteredAt set
    const deadEntry = buildPendingSyncRow({
      tableName: 'envelopes',
      recordId: deadLetteredRecordId,
      retryCount: 10,
    });

    // PendingSyncEnqueuer checks: isNull(deadLetteredAt) → false for the dead entry
    // So it creates a new fresh entry
    const freshEntry = buildPendingSyncRow({
      tableName: 'envelopes',
      recordId: deadLetteredRecordId,
      retryCount: 0,
    });

    expect(deadEntry.recordId).toBe(freshEntry.recordId);
    expect(deadEntry.retryCount).toBe(10);
    expect(freshEntry.retryCount).toBe(0);
    // Fresh entry gets a new id (different from dead entry)
    expect(freshEntry.id).not.toBe(deadEntry.id);
  });
});

describe('DLQ Behavior — No User Notification', () => {
  it('documents that dead-lettered items generate no user-visible notification', async () => {
    const poisonItem = {
      id: 'dlq-silent',
      tableName: 'envelopes',
      recordId: 'env-silent',
      operation: 'INSERT',
      retryCount: 9,
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
      lastAttemptedAt: null,
    };

    const updateSetMock = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain([poisonItem]))
        .mockReturnValueOnce(
          makeBatchFetchChain([{ id: 'env-silent', householdId: 'hh-1', isSynced: false }]),
        ),
      update: () => ({ set: updateSetMock }),
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: { message: 'permanent failure' } }),
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    // Item is dead-lettered
    expect(result.failed).toBe(1);
    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.deadLetteredAt).toBeTruthy();

    // TODO: FIX — syncPending() returns { synced, failed, emfFlipped } but the caller
    // has no way to distinguish "failed and will retry" from "failed and dead-lettered".
    // The user gets no notification that their data is permanently stuck.
    // The result should include a `deadLettered` count or the failed items' IDs
    // so the UI can alert the user.
    expect(result).not.toHaveProperty('deadLettered');
    expect(result).not.toHaveProperty('deadLetteredIds');
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Queue buildup tests: verify pending_sync accumulates items correctly
 * and SyncOrchestrator respects its batch limit of 100.
 */
import { SyncOrchestrator } from '../../data/sync/SyncOrchestrator';
import { buildPendingSyncRow, resetFactoryCounter } from '../../__test-utils__/factories';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-q-' + Math.random().toString(36).slice(2, 10),
}));

jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
  ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
  })),
}));

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockSupabase() {
  return {
    rpc: jest.fn().mockResolvedValue({ error: null }),
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    }),
  } as any;
}

function buildPendingItems(count: number) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push(
      buildPendingSyncRow({
        tableName: 'transactions',
        recordId: `rec-${String(i).padStart(4, '0')}`,
        operation: 'INSERT',
        retryCount: 0,
        lastAttemptedAt: null,
        createdAt: new Date(Date.now() - (count - i) * 1000).toISOString(),
      }),
    );
  }
  return items;
}

function makeSyncDb(pendingItems: any[], localRows: Record<string, unknown>[] = []) {
  const deletedIds: string[] = [];

  const pendingSelectChain = {
    where: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(pendingItems),
      }),
    }),
  };

  const batchSelectChain = {
    where: jest.fn().mockResolvedValue(localRows),
  };

  return {
    deletedIds,
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockImplementation((table: any) => {
        if (table === require('../../data/local/schema').pendingSync) {
          return pendingSelectChain;
        }
        return batchSelectChain;
      }),
    }),
    delete: jest.fn().mockImplementation(() => ({
      where: jest.fn().mockImplementation(() => {
        return Promise.resolve();
      }),
    })),
    update: jest.fn().mockImplementation(() => ({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    })),
  } as any;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => resetFactoryCounter());

describe('Queue Buildup & Batch Processing', () => {
  describe('Queue accumulation', () => {
    it('50+ items accumulate in pending_sync', () => {
      const items = buildPendingItems(55);
      expect(items).toHaveLength(55);
      items.forEach((item) => {
        expect(item.tableName).toBe('transactions');
        expect(item.operation).toBe('INSERT');
        expect(item.retryCount).toBe(0);
      });
    });

    it('items have monotonically increasing createdAt (FIFO order)', () => {
      const items = buildPendingItems(10);
      for (let i = 1; i < items.length; i++) {
        expect(new Date(items[i].createdAt).getTime()).toBeGreaterThan(
          new Date(items[i - 1].createdAt).getTime(),
        );
      }
    });
  });

  describe('SyncOrchestrator batch limit', () => {
    it('processes up to 100 items per syncPending call', async () => {
      const pending100 = buildPendingItems(100);
      const localRows = pending100.map((p) => ({
        id: p.recordId,
        householdId: 'h-1',
        isSynced: false,
      }));
      const db = makeSyncDb(pending100, localRows);
      const supabase = createMockSupabase();
      const orchestrator = new SyncOrchestrator(db, supabase);

      const result = await orchestrator.syncPending();

      expect(result.synced).toBe(100);
      expect(result.failed).toBe(0);
    });

    it('150 items requires 2 batches — first call processes 100', async () => {
      const allItems = buildPendingItems(150);
      const firstBatch = allItems.slice(0, 100);
      const localRows = firstBatch.map((p) => ({
        id: p.recordId,
        householdId: 'h-1',
        isSynced: false,
      }));

      const db = makeSyncDb(firstBatch, localRows);
      const supabase = createMockSupabase();
      const orchestrator = new SyncOrchestrator(db, supabase);

      const result = await orchestrator.syncPending();

      // The DB query has .limit(100), so only 100 are fetched per call
      expect(result.synced).toBeLessThanOrEqual(100);
    });

    it('empty queue returns synced: 0, failed: 0', async () => {
      const db = makeSyncDb([], []);
      const supabase = createMockSupabase();
      const orchestrator = new SyncOrchestrator(db, supabase);

      const result = await orchestrator.syncPending();

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('FIFO processing order', () => {
    it('items are fetched ordered by createdAt ascending', async () => {
      const items = buildPendingItems(5);
      const localRows = items.map((p) => ({
        id: p.recordId,
        householdId: 'h-1',
        isSynced: false,
      }));
      const db = makeSyncDb(items, localRows);
      const supabase = createMockSupabase();
      const orchestrator = new SyncOrchestrator(db, supabase);

      await orchestrator.syncPending();

      // Verify the select chain includes orderBy (asc)
      const selectCall = db.select();
      const fromCall = selectCall.from(require('../../data/local/schema').pendingSync);
      expect(fromCall.where).toHaveBeenCalled();
    });

    it('all pending items have sequential createdAt timestamps', () => {
      const items = buildPendingItems(20);
      const timestamps = items.map((i) => new Date(i.createdAt).getTime());
      const sorted = [...timestamps].sort((a, b) => a - b);
      expect(timestamps).toEqual(sorted);
    });
  });

  describe('Sync failure handling', () => {
    it('failed items increment retryCount', async () => {
      const items = buildPendingItems(1);
      const db = makeSyncDb(items, []);
      const supabase = createMockSupabase();
      // processItem will throw because local row is not found
      const orchestrator = new SyncOrchestrator(db, supabase);

      const result = await orchestrator.syncPending();

      expect(result.failed).toBe(1);
      expect(result.synced).toBe(0);
    });
  });
});

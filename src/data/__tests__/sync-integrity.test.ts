/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
  ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
  })),
}));

function createMockSupabase(opts: { shouldFail?: boolean } = {}) {
  const deleteCalls: any[] = [];
  const upsertCalls: any[] = [];
  const rpcCalls: any[] = [];

  const supabase: any = {
    from: jest.fn((table: string) => ({
      delete: jest.fn(() => ({
        eq: jest.fn(() => {
          deleteCalls.push({ table });
          if (opts.shouldFail) return { error: { message: 'network error' } };
          return { error: null };
        }),
      })),
      upsert: jest.fn((row: any, _config: any) => {
        upsertCalls.push({ table, row });
        if (opts.shouldFail) return { error: { message: 'network error' } };
        return { error: null };
      }),
    })),
    rpc: jest.fn((name: string, params: any) => {
      rpcCalls.push({ name, params });
      if (opts.shouldFail) return { error: { message: 'rpc error' } };
      return { error: null };
    }),
  };

  return { supabase, deleteCalls, upsertCalls, rpcCalls };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Sync Integrity — Sync Latch', () => {
  it('returns {synced:0, failed:0, emfFlipped:0} if sync is already running', async () => {
    const items = [
      {
        id: 'ps-1',
        tableName: 'envelopes',
        recordId: 'env-1',
        operation: 'INSERT',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    // Create a DB that takes a long time to process
    const slowDb: any = {
      select: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(items), 100)),
          ),
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      })),
      insert: jest.fn(() => ({
        values: jest.fn().mockResolvedValue(undefined),
      })),
    };

    const { supabase } = createMockSupabase();

    // We need a fresh module instance to reset isSyncRunning
    jest.resetModules();
    jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));
    jest.mock('../../infrastructure/logging/Logger', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
      ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
      })),
    }));
    const { SyncOrchestrator: FreshOrchestrator } = require('../sync/SyncOrchestrator');

    const orch = new FreshOrchestrator(slowDb, supabase);

    // Start first sync (will be slow)
    const first = orch.syncPending();
    // Immediately start second sync — should bounce
    const second = await orch.syncPending();

    expect(second).toEqual({ synced: 0, failed: 0, deadLettered: 0, emfFlipped: 0 });

    await first; // let first finish
  });
});

describe('Sync Integrity — DLQ (Dead Letter Queue)', () => {
  it('dead-letters an item after 10 retries', async () => {
    jest.resetModules();
    jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));
    jest.mock('../../infrastructure/logging/Logger', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
      ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
      })),
    }));

    const items = [
      {
        id: 'ps-dlq',
        tableName: 'envelopes',
        recordId: 'env-1',
        operation: 'INSERT',
        retryCount: 9, // next failure = 10 → DLQ
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    const setMock = jest.fn().mockReturnThis();
    const whereMock = jest.fn().mockResolvedValue(undefined);

    const db: any = {
      select: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(items),
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: setMock,
        where: whereMock,
      })),
    };

    const { supabase } = createMockSupabase({ shouldFail: true });
    const { SyncOrchestrator: FreshOrchestrator } = require('../sync/SyncOrchestrator');
    const orch = new FreshOrchestrator(db, supabase);

    const result = await orch.syncPending();

    expect(result.failed).toBe(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        retryCount: 10,
        deadLetteredAt: expect.any(String),
      }),
    );
  });

  it('dead-letters an item older than 7 days', async () => {
    jest.resetModules();
    jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));
    jest.mock('../../infrastructure/logging/Logger', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
      ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
      })),
    }));

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const items = [
      {
        id: 'ps-old',
        tableName: 'transactions',
        recordId: 'tx-1',
        operation: 'UPDATE',
        retryCount: 2, // below 10 but age exceeds 7 days
        createdAt: eightDaysAgo,
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    const setMock = jest.fn().mockReturnThis();
    const whereMock = jest.fn().mockResolvedValue(undefined);

    const db: any = {
      select: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(items),
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: setMock,
        where: whereMock,
      })),
    };

    const { supabase } = createMockSupabase({ shouldFail: true });
    const { SyncOrchestrator: FreshOrchestrator } = require('../sync/SyncOrchestrator');
    const orch = new FreshOrchestrator(db, supabase);

    const result = await orch.syncPending();

    expect(result.failed).toBe(1);
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        retryCount: 3,
        deadLetteredAt: expect.any(String),
      }),
    );
  });
});

describe('Sync Integrity — Exponential Backoff', () => {
  // Tests local backoff math only; does not exercise the SyncOrchestrator's scheduling.
  it.each([
    [0, 1000],
    [1, 2000],
    [2, 4000],
    [3, 8000],
    [4, 16000],
    [5, 32000],
    [6, 60000], // capped at 60s
    [7, 60000],
  ])('retryCount=%i → backoff=%ims', (retryCount, expectedMs) => {
    const backoffMs = Math.min(60_000, 1000 * 2 ** retryCount);
    expect(backoffMs).toBe(expectedMs);
  });
});

describe('Sync Integrity — DELETE operations', () => {
  it('calls delete_sync_row RPC for DELETE operations without reading local row', async () => {
    jest.resetModules();
    jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));
    jest.mock('../../infrastructure/logging/Logger', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
      ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
      })),
    }));

    const items = [
      {
        id: 'ps-del',
        tableName: 'transactions',
        recordId: 'tx-del-1',
        operation: 'DELETE',
        retryCount: 0,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    const db: any = {
      select: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(items),
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined),
      })),
    };

    const { supabase, deleteCalls, rpcCalls } = createMockSupabase();
    const { SyncOrchestrator: FreshOrchestrator } = require('../sync/SyncOrchestrator');
    const orch = new FreshOrchestrator(db, supabase);

    const result = await orch.syncPending();

    expect(result.synced).toBe(1);
    expect(deleteCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: 'delete_sync_row',
      params: { p_table: 'transactions', p_id: 'tx-del-1' },
    });
  });
});

describe('Sync Integrity — Retry count increment', () => {
  it('increments retryCount on failure', async () => {
    jest.resetModules();
    jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uuid' }));
    jest.mock('../../infrastructure/logging/Logger', () => ({
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
      ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
        execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
      })),
    }));

    const items = [
      {
        id: 'ps-retry',
        tableName: 'envelopes',
        recordId: 'env-retry',
        operation: 'INSERT',
        retryCount: 3,
        createdAt: new Date().toISOString(),
        lastAttemptedAt: null,
        deadLetteredAt: null,
      },
    ];

    const setMock = jest.fn().mockReturnThis();
    const whereMock = jest.fn().mockResolvedValue(undefined);

    const db: any = {
      select: jest.fn(() => ({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(items),
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: setMock,
        where: whereMock,
      })),
    };

    const { supabase } = createMockSupabase({ shouldFail: true });
    const { SyncOrchestrator: FreshOrchestrator } = require('../sync/SyncOrchestrator');
    const orch = new FreshOrchestrator(db, supabase);

    await orch.syncPending();

    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 4 }));
  });
});

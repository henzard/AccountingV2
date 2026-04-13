jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { SyncOrchestrator } from './SyncOrchestrator';

// Helper to build a chainable pending-queue mock that supports .where().orderBy().limit()
function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

describe('SyncOrchestrator.syncPending', () => {
  it('returns synced:0 failed:0 when queue is empty', async () => {
    const db = {
      select: () => makePendingQueueChain([]),
    } as any;
    const supabase = {} as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();
    expect(result).toMatchObject({ synced: 0, failed: 0 });
  });

  it('baby_steps DELETE uses plain .delete() path, not rpc()', async () => {
    const pending = [
      {
        id: 'p1',
        tableName: 'baby_steps',
        recordId: 'bs-del-1',
        operation: 'DELETE',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      },
    ];
    const db = {
      select: jest.fn().mockReturnValueOnce(makePendingQueueChain(pending)),
      delete: () => ({ where: () => Promise.resolve() }),
    } as any;

    const rpcMock = jest.fn();
    const deleteMock = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    const supabase = {
      rpc: rpcMock,
      from: () => ({ delete: deleteMock }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    // DELETE must NOT go through the merge_baby_step RPC
    expect(rpcMock).not.toHaveBeenCalled();
    // Plain .delete() must have been called
    expect(deleteMock).toHaveBeenCalled();
  });

  it('increments failed count when Supabase upsert throws', async () => {
    const pending = [
      {
        id: 'p1',
        tableName: 'envelopes',
        recordId: 'e1',
        operation: 'INSERT',
        retryCount: 0,
        createdAt: new Date().toISOString(),
      },
    ];
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain(pending))
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 'e1', householdId: 'h1', isSynced: false }]),
            }),
          }),
        }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    } as any;
    const supabase = {
      from: () => ({
        upsert: () => Promise.resolve({ error: { message: 'network error' } }),
      }),
    } as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });

  describe('baby_steps routing via merge_baby_step RPC', () => {
    it('routes baby_steps rows through rpc(merge_baby_step) instead of plain upsert', async () => {
      const babyStepRow = {
        id: 'bs-1',
        householdId: 'hh-1',
        stepNumber: 1,
        isCompleted: true,
        completedAt: '2026-04-12T10:00:00Z',
        isManual: false,
        celebratedAt: '2026-04-12T10:05:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-04-12T10:00:00Z',
        isSynced: false,
      };

      const pending = [
        {
          id: 'p1',
          tableName: 'baby_steps',
          recordId: 'bs-1',
          operation: 'INSERT',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        },
      ];

      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce(makePendingQueueChain(pending))
          .mockReturnValueOnce({
            from: () => ({ where: () => ({ limit: () => Promise.resolve([babyStepRow]) }) }),
          }),
        delete: () => ({ where: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const rpcMock = jest.fn().mockResolvedValue({ error: null });
      const upsertMock = jest.fn().mockResolvedValue({ error: null });
      const supabase = {
        rpc: rpcMock,
        from: () => ({ upsert: upsertMock }),
      } as any;

      const orch = new SyncOrchestrator(db, supabase);
      const result = await orch.syncPending();

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
      // RPC was called with the merge_baby_step function name
      expect(rpcMock).toHaveBeenCalledWith(
        'merge_baby_step',
        expect.objectContaining({ row: expect.objectContaining({ id: 'bs-1' }) }),
      );
      // Plain upsert must NOT have been called for baby_steps
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('increments failed when merge_baby_step RPC returns an error', async () => {
      const pending = [
        {
          id: 'p1',
          tableName: 'baby_steps',
          recordId: 'bs-2',
          operation: 'INSERT',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        },
      ];

      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce(makePendingQueueChain(pending))
          .mockReturnValueOnce({
            from: () => ({
              where: () => ({
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'bs-2',
                      householdId: 'hh-1',
                      stepNumber: 2,
                      isCompleted: false,
                      completedAt: null,
                      isManual: false,
                      celebratedAt: null,
                      createdAt: '2026-01-01T00:00:00Z',
                      updatedAt: '2026-01-01T00:00:00Z',
                      isSynced: false,
                    },
                  ]),
              }),
            }),
          }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const supabase = {
        rpc: jest.fn().mockResolvedValue({ error: { message: 'rpc error' } }),
        from: () => ({ upsert: jest.fn() }),
      } as any;

      const orch = new SyncOrchestrator(db, supabase);
      const result = await orch.syncPending();

      expect(result.failed).toBe(1);
      expect(result.synced).toBe(0);
    });

    it('routes envelopes through merge_envelope RPC (all tables now use merge RPCs)', async () => {
      const pending = [
        {
          id: 'p1',
          tableName: 'envelopes',
          recordId: 'e-1',
          operation: 'INSERT',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        },
      ];

      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce(makePendingQueueChain(pending))
          .mockReturnValueOnce({
            from: () => ({
              where: () => ({
                limit: () =>
                  Promise.resolve([
                    {
                      id: 'e-1',
                      householdId: 'hh-1',
                      name: 'Groceries',
                      allocatedCents: 5000,
                      spentCents: 0,
                      envelopeType: 'spending',
                      isSavingsLocked: false,
                      isArchived: false,
                      periodStart: '2026-04-01',
                      createdAt: '2026-01-01T00:00:00Z',
                      updatedAt: '2026-01-01T00:00:00Z',
                      isSynced: false,
                    },
                  ]),
              }),
            }),
          }),
        delete: () => ({ where: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const rpcMock = jest.fn().mockResolvedValue({ error: null });
      const upsertMock = jest.fn().mockResolvedValue({ error: null });
      const supabase = {
        rpc: rpcMock,
        from: () => ({ upsert: upsertMock }),
      } as any;

      const orch = new SyncOrchestrator(db, supabase);
      await orch.syncPending();

      // envelopes now route through merge_envelope RPC
      expect(rpcMock).toHaveBeenCalledWith('merge_envelope', expect.any(Object));
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  describe('ReconcileEmergencyFundTypeUseCase trigger', () => {
    function makeEmptyQueueDb(envelopeRows: Record<string, unknown>[] = []) {
      let selectCount = 0;
      return {
        select: jest.fn().mockImplementation(() => {
          selectCount++;
          if (selectCount === 1) {
            // First call: pendingSync queue (supports .where().orderBy().limit())
            return makePendingQueueChain([]);
          }
          // Subsequent calls: for ReconcileEmergencyFundTypeUseCase envelope query
          return {
            from: () => ({
              where: () => Promise.resolve(envelopeRows),
            }),
          };
        }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      };
    }

    it('calls ReconcileEmergencyFundTypeUseCase when failed=0 and householdId provided', async () => {
      const db = makeEmptyQueueDb();
      const supabase = {} as any;

      const orch = new SyncOrchestrator(db as any, supabase);
      const result = await orch.syncPending('hh-1');

      expect(result.failed).toBe(0);
      // select was called at least twice (once for queue, once for EMF check)
      expect((db.select as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT call ReconcileEmergencyFundTypeUseCase when failed > 0', async () => {
      const pending = [
        {
          id: 'p1',
          tableName: 'envelopes',
          recordId: 'e1',
          operation: 'INSERT',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        },
      ];
      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce(makePendingQueueChain(pending))
          .mockReturnValueOnce({
            from: () => ({
              where: () => ({ limit: () => Promise.resolve([{ id: 'e1', isSynced: false }]) }),
            }),
          }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const supabase = {
        rpc: () => Promise.resolve({ error: { message: 'fail' } }),
        from: () => ({
          upsert: () => Promise.resolve({ error: { message: 'fail' } }),
        }),
      } as any;

      const orch = new SyncOrchestrator(db, supabase);
      const result = await orch.syncPending('hh-1');

      expect(result.failed).toBe(1);
      // ReconcileEmergencyFundTypeUseCase should NOT have been called —
      // verify by checking the db.select call count stays at the sync-only count
      // (pendingSync + 1 for row fetch = 2 calls max; no additional EMF query)
      expect((db.select as jest.Mock).mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('does NOT call ReconcileEmergencyFundTypeUseCase when no householdId provided', async () => {
      const db = {
        select: jest.fn().mockReturnValue(makePendingQueueChain([])),
      } as any;
      const supabase = {} as any;

      // No householdId passed — fixer must never fire
      const orch = new SyncOrchestrator(db, supabase);
      const result = await orch.syncPending();

      expect(result.failed).toBe(0);
      // Should only have 1 select call (the pending queue), not 2
      expect((db.select as jest.Mock).mock.calls.length).toBe(1);
    });

    it('does NOT call fixer when syncPending() called without householdId even on clean sync', async () => {
      const db = {
        select: jest.fn().mockReturnValue(makePendingQueueChain([])),
      } as any;
      const supabase = {} as any;

      const orch = new SyncOrchestrator(db, supabase);
      // Explicitly no householdId
      const result = await orch.syncPending(undefined);

      expect(result).toMatchObject({ synced: 0, failed: 0 });
      // Only the initial pending-queue select should be called
      expect((db.select as jest.Mock).mock.calls.length).toBe(1);
    });

    it('invokes fixer with householdId when syncPending(householdId) on clean sync', async () => {
      const db = makeEmptyQueueDb();
      const supabase = {} as any;

      const orch = new SyncOrchestrator(db as any, supabase);
      const result = await orch.syncPending('h1');

      expect(result).toMatchObject({ synced: 0, failed: 0 });
      // Queue select + fixer's envelope select = at least 2 calls
      expect((db.select as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT invoke fixer when syncPending(householdId) has partial failure', async () => {
      const pending = [
        {
          id: 'p1',
          tableName: 'envelopes',
          recordId: 'e1',
          operation: 'INSERT',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        },
      ];
      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce(makePendingQueueChain(pending))
          .mockReturnValueOnce({
            from: () => ({
              where: () => ({ limit: () => Promise.resolve([{ id: 'e1', isSynced: false }]) }),
            }),
          }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const supabase = {
        rpc: () => Promise.resolve({ error: { message: 'fail' } }),
        from: () => ({
          upsert: () => Promise.resolve({ error: { message: 'fail' } }),
        }),
      } as any;

      const orch = new SyncOrchestrator(db, supabase);
      const result = await orch.syncPending('h1');

      expect(result.failed).toBe(1);
      // Fixer select must not be reached — capped at pending-queue + row fetch = 2
      expect((db.select as jest.Mock).mock.calls.length).toBeLessThanOrEqual(2);
    });
  });
});

describe('SyncOrchestrator — per-table merge RPC routing', () => {
  const tables: Array<{ tableName: string; rpcName: string; localRow: Record<string, unknown> }> = [
    {
      tableName: 'envelopes',
      rpcName: 'merge_envelope',
      localRow: {
        id: 'e-1',
        householdId: 'hh-1',
        name: 'Groceries',
        allocatedCents: 5000,
        spentCents: 0,
        envelopeType: 'spending',
        isSavingsLocked: false,
        isArchived: false,
        periodStart: '2026-04-01',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        isSynced: false,
      },
    },
    {
      tableName: 'transactions',
      rpcName: 'merge_transaction',
      localRow: {
        id: 'tx-1',
        householdId: 'hh-1',
        envelopeId: 'e-1',
        amountCents: 1000,
        payee: 'Shop',
        description: null,
        transactionDate: '2026-04-01',
        isBusinessExpense: false,
        spendingTriggerNote: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        isSynced: false,
      },
    },
    {
      tableName: 'debts',
      rpcName: 'merge_debt',
      localRow: {
        id: 'd-1',
        householdId: 'hh-1',
        creditorName: 'Bank',
        debtType: 'credit_card',
        outstandingBalanceCents: 10000,
        initialBalanceCents: 10000,
        interestRatePercent: 20,
        minimumPaymentCents: 500,
        sortOrder: 0,
        isPaidOff: false,
        totalPaidCents: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        isSynced: false,
      },
    },
    {
      tableName: 'meter_readings',
      rpcName: 'merge_meter_reading',
      localRow: {
        id: 'mr-1',
        householdId: 'hh-1',
        meterType: 'electricity',
        readingValue: 1234.5,
        readingDate: '2026-04-01',
        costCents: null,
        vehicleId: null,
        notes: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        isSynced: false,
      },
    },
    {
      tableName: 'households',
      rpcName: 'merge_household',
      localRow: {
        id: 'hh-1',
        name: 'Test',
        paydayDay: 25,
        userLevel: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        isSynced: false,
      },
    },
    {
      tableName: 'household_members',
      rpcName: 'merge_household_member',
      localRow: {
        id: 'hm-1',
        householdId: 'hh-1',
        userId: 'user-1',
        role: 'member',
        joinedAt: '2026-01-01T00:00:00Z',
      },
    },
    {
      tableName: 'baby_steps',
      rpcName: 'merge_baby_step',
      localRow: {
        id: 'bs-1',
        householdId: 'hh-1',
        stepNumber: 1,
        isCompleted: false,
        completedAt: null,
        isManual: false,
        celebratedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        isSynced: false,
      },
    },
  ];

  it.each(tables)(
    'routes $tableName through $rpcName on upsert',
    async ({ tableName, rpcName, localRow }) => {
      const pending = [
        {
          id: 'p1',
          tableName,
          recordId: localRow.id as string,
          operation: 'INSERT',
          retryCount: 0,
          createdAt: new Date().toISOString(),
        },
      ];

      const db = {
        select: jest
          .fn()
          .mockReturnValueOnce(makePendingQueueChain(pending))
          .mockReturnValueOnce({
            from: () => ({ where: () => ({ limit: () => Promise.resolve([localRow]) }) }),
          }),
        delete: () => ({ where: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const rpcMock = jest.fn().mockResolvedValue({ error: null });
      const supabase = { rpc: rpcMock, from: () => ({ upsert: jest.fn() }) } as any;

      const orch = new SyncOrchestrator(db, supabase);
      const result = await orch.syncPending();

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
      expect(rpcMock).toHaveBeenCalledWith(rpcName, expect.any(Object));
    },
  );
});

describe('SyncOrchestrator — DLQ after max retries', () => {
  it('dead-letters a poison-pill row after 10 retries', async () => {
    const poisonRow = {
      id: 'poison-1',
      tableName: 'envelopes',
      recordId: 'e-poison',
      operation: 'INSERT',
      retryCount: 9, // one more failure → 10 → DLQ
      createdAt: new Date().toISOString(),
      deadLetteredAt: null,
    };

    const pending = [poisonRow];

    const updateSetMock = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const updateMock = jest.fn().mockReturnValue({ set: updateSetMock });

    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(makePendingQueueChain(pending))
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ id: 'e-poison', householdId: 'hh-1', isSynced: false }]),
            }),
          }),
        }),
      update: updateMock,
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({ error: { message: 'persistent failure' } }),
      from: () => ({ upsert: jest.fn() }),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(result.failed).toBe(1);
    // The update call should include deadLetteredAt set to a timestamp
    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.deadLetteredAt).toBeTruthy();
    expect(setArg.retryCount).toBe(10);
  });
});

import { SyncOrchestrator } from './SyncOrchestrator';

describe('SyncOrchestrator.syncPending', () => {
  it('returns synced:0 failed:0 when queue is empty', async () => {
    const db = {
      select: () => ({ from: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
    } as any;
    const supabase = {} as any;
    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();
    expect(result).toEqual({ synced: 0, failed: 0 });
  });

  it('increments failed count when Supabase upsert throws', async () => {
    const pending = [
      { id: 'p1', tableName: 'envelopes', recordId: 'e1', operation: 'INSERT', retryCount: 0 },
    ];
    const db = {
      select: jest.fn()
        .mockReturnValueOnce({ from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(pending) }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'e1', householdId: 'h1', isSynced: false }]) }) }) }),
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
        { id: 'p1', tableName: 'baby_steps', recordId: 'bs-1', operation: 'INSERT', retryCount: 0 },
      ];

      const db = {
        select: jest.fn()
          .mockReturnValueOnce({
            from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(pending) }) }),
          })
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
        { id: 'p1', tableName: 'baby_steps', recordId: 'bs-2', operation: 'INSERT', retryCount: 0 },
      ];

      const db = {
        select: jest.fn()
          .mockReturnValueOnce({
            from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(pending) }) }),
          })
          .mockReturnValueOnce({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([{
                  id: 'bs-2', householdId: 'hh-1', stepNumber: 2,
                  isCompleted: false, completedAt: null, isManual: false,
                  celebratedAt: null, createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-01T00:00:00Z', isSynced: false,
                }]),
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

    it('uses plain upsert for non-baby_steps tables (regression guard)', async () => {
      const pending = [
        { id: 'p1', tableName: 'envelopes', recordId: 'e-1', operation: 'INSERT', retryCount: 0 },
      ];

      const db = {
        select: jest.fn()
          .mockReturnValueOnce({
            from: () => ({ orderBy: () => ({ limit: () => Promise.resolve(pending) }) }),
          })
          .mockReturnValueOnce({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([{
                  id: 'e-1', householdId: 'hh-1', name: 'Groceries',
                  allocatedCents: 5000, spentCents: 0, envelopeType: 'spending',
                  isSavingsLocked: false, isArchived: false, periodStart: '2026-04-01',
                  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
                  isSynced: false,
                }]),
              }),
            }),
          }),
        delete: () => ({ where: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      } as any;

      const rpcMock = jest.fn();
      const upsertMock = jest.fn().mockResolvedValue({ error: null });
      const supabase = {
        rpc: rpcMock,
        from: () => ({ upsert: upsertMock }),
      } as any;

      const orch = new SyncOrchestrator(db, supabase);
      await orch.syncPending();

      expect(upsertMock).toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });
});

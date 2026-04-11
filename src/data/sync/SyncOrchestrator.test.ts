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
});

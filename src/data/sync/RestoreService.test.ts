import { RestoreService } from './RestoreService';

describe('RestoreService.restore', () => {
  it('returns empty array when user has no household memberships in Supabase', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    } as any;
    const db = {} as any;
    const svc = new RestoreService(db, supabase);
    const result = await svc.restore('user-1');
    expect(result).toEqual([]);
  });

  it('returns error result when Supabase membership fetch fails', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'network' } }),
        }),
      }),
    } as any;
    const db = {} as any;
    const svc = new RestoreService(db, supabase);
    await expect(svc.restore('user-1')).rejects.toThrow('network');
  });
});

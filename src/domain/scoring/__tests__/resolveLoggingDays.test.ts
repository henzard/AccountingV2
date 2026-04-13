import { resolveLoggingDays } from '../resolveLoggingDays';

describe('resolveLoggingDays', () => {
  const mockDb = (rows: { date: string }[]): object => ({
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(rows),
      }),
    }),
  });

  it('returns 0 when no transactions exist', async () => {
    const db = mockDb([]);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(0);
  });

  it('counts distinct days (not transactions)', async () => {
    const db = mockDb([
      { date: '2026-04-01' },
      { date: '2026-04-01' }, // duplicate — same day
      { date: '2026-04-03' },
      { date: '2026-04-05' },
    ]);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(3);
  });

  it('returns 1 when all transactions are on the same day', async () => {
    const db = mockDb([{ date: '2026-04-10' }, { date: '2026-04-10' }, { date: '2026-04-10' }]);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(1);
  });
});

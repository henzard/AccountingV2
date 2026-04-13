import { resolveLoggingDays } from '../resolveLoggingDays';

describe('resolveLoggingDays', () => {
  /**
   * Build a mock db whose select().from().where() resolves to [{ count }].
   * This matches the COUNT(DISTINCT …) query shape used in resolveLoggingDays.
   */
  const mockDb = (count: number): object => ({
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([{ count }]),
      }),
    }),
  });

  it('returns 0 when no transactions exist', async () => {
    const db = mockDb(0);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(0);
  });

  it('counts distinct days (not transactions)', async () => {
    // SQLite COUNT(DISTINCT …) already deduplicates; mock returns 3 distinct days.
    const db = mockDb(3);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(3);
  });

  it('returns 1 when all transactions are on the same day', async () => {
    const db = mockDb(1);
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(1);
  });

  it('returns 0 when db returns empty array (no rows)', async () => {
    const db: object = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      }),
    };
    const result = await resolveLoggingDays(db as any, 'hh-1', '2026-04-01', '2026-04-30');
    expect(result).toBe(0);
  });
});

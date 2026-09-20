import { findLatestPeriodWithEnvelopes } from '../findLatestPeriodWithEnvelopes';

function makeDb(rows: { period_start: string | null }[]) {
  return { all: jest.fn().mockResolvedValue(rows) } as unknown as Parameters<
    typeof findLatestPeriodWithEnvelopes
  >[0];
}

describe('findLatestPeriodWithEnvelopes', () => {
  it('returns the latest period_start the query resolves', async () => {
    const db = makeDb([{ period_start: '2026-06-01' }]);
    const result = await findLatestPeriodWithEnvelopes(db, 'hh-1', '2026-09-01');
    expect(result).toBe('2026-06-01');
  });

  it('returns null when no earlier period has any period-scoped envelope (MAX() is NULL)', async () => {
    const db = makeDb([{ period_start: null }]);
    const result = await findLatestPeriodWithEnvelopes(db, 'hh-1', '2026-09-01');
    expect(result).toBeNull();
  });

  it('returns null when the query returns no rows at all', async () => {
    const db = makeDb([]);
    const result = await findLatestPeriodWithEnvelopes(db, 'hh-1', '2026-09-01');
    expect(result).toBeNull();
  });

  it('issues exactly one query against the provided db', async () => {
    const db = makeDb([{ period_start: '2026-08-01' }]);
    await findLatestPeriodWithEnvelopes(db, 'hh-42', '2026-09-01');
    expect(db.all).toHaveBeenCalledTimes(1);
  });
});

import { getPeriodScoresAscending } from '../getPeriodScoresAscending';

describe('getPeriodScoresAscending', () => {
  function makeDb(rows: { periodStart: string | null; score: number | null }[]): object {
    const orderByMock = jest.fn().mockResolvedValue(rows);
    const whereMock = jest.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = jest.fn().mockReturnValue({ where: whereMock });
    return { select: jest.fn().mockReturnValue({ from: fromMock }) };
  }

  it('returns rows oldest-first, as given by the query', async () => {
    const db = makeDb([
      { periodStart: '2026-05-01', score: 40 },
      { periodStart: '2026-06-01', score: 72 },
    ]);

    const result = await getPeriodScoresAscending(db as any, 'hh-1');

    expect(result).toEqual([
      { periodStart: '2026-05-01', score: 40 },
      { periodStart: '2026-06-01', score: 72 },
    ]);
  });

  it('returns an empty array when the household has no recorded scores', async () => {
    const db = makeDb([]);
    const result = await getPeriodScoresAscending(db as any, 'hh-1');
    expect(result).toEqual([]);
  });

  it('filters out rows with a null score (defensive against a malformed/partial row)', async () => {
    const db = makeDb([
      { periodStart: '2026-05-01', score: null },
      { periodStart: '2026-06-01', score: 72 },
    ]);

    const result = await getPeriodScoresAscending(db as any, 'hh-1');
    expect(result).toEqual([{ periodStart: '2026-06-01', score: 72 }]);
  });
});

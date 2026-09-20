import { getLatestDebtSnapshot } from '../getLatestDebtSnapshot';

describe('getLatestDebtSnapshot', () => {
  function makeDb(rows: { components: string | null }[]): { select: jest.Mock } {
    const orderByMock = jest.fn().mockResolvedValue(rows);
    const whereMock = jest.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = jest.fn().mockReturnValue({ where: whereMock });
    const select = jest.fn().mockReturnValue({ from: fromMock });
    return { select };
  }

  it('returns the newest row that carries a well-formed debtSnapshot', async () => {
    const db = makeDb([
      {
        components: JSON.stringify({
          score: 80,
          debtSnapshot: { totalDebtCents: 100000, debtFreeDateISO: '2028-01-01T00:00:00.000Z' },
        }),
      },
    ]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toEqual({ totalDebtCents: 100000, debtFreeDateISO: '2028-01-01T00:00:00.000Z' });
  });

  it('tolerates a null debtFreeDateISO (no payable plan)', async () => {
    const db = makeDb([
      {
        components: JSON.stringify({
          score: 80,
          debtSnapshot: { totalDebtCents: 100000, debtFreeDateISO: null },
        }),
      },
    ]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toEqual({ totalDebtCents: 100000, debtFreeDateISO: null });
  });

  it('walks backward past rows that have no debtSnapshot (pre-VAL2-10 rows) to find one that does', async () => {
    const db = makeDb([
      { components: JSON.stringify({ score: 80 }) }, // newest — no debtSnapshot yet
      {
        components: JSON.stringify({
          score: 70,
          debtSnapshot: { totalDebtCents: 200000, debtFreeDateISO: null },
        }),
      },
    ]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-08-01');
    expect(result).toEqual({ totalDebtCents: 200000, debtFreeDateISO: null });
  });

  it('returns null when no row has a debtSnapshot at all', async () => {
    const db = makeDb([{ components: JSON.stringify({ score: 80 }) }]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toBeNull();
  });

  it('returns null when there are no rows', async () => {
    const db = makeDb([]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toBeNull();
  });

  it('tolerates malformed JSON without throwing', async () => {
    const db = makeDb([{ components: '{not json' }]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toBeNull();
  });

  it('tolerates a null components column', async () => {
    const db = makeDb([{ components: null }]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toBeNull();
  });

  it('tolerates a debtSnapshot with the wrong shape (e.g. totalDebtCents not a number)', async () => {
    const db = makeDb([
      {
        components: JSON.stringify({
          score: 80,
          debtSnapshot: { totalDebtCents: 'oops', debtFreeDateISO: null },
        }),
      },
    ]);
    const result = await getLatestDebtSnapshot(db as any, 'hh-1', '2026-07-01');
    expect(result).toBeNull();
  });
});

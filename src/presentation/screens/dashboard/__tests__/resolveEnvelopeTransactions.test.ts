import { resolveEnvelopeTransactions } from '../resolveEnvelopeTransactions';

interface MockTx {
  id: string;
  transactionDate: string;
}

type MockDb = Parameters<typeof resolveEnvelopeTransactions>[0];

function makeDb(rows: MockTx[]) {
  const orderByResult: MockTx[] & { limit: jest.Mock } = Object.assign([...rows], {
    limit: jest.fn().mockImplementation((n: number) => rows.slice(0, n)),
  });
  const where = jest.fn().mockReturnValue({
    orderBy: jest.fn().mockReturnValue(orderByResult),
  });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { db: { select } as unknown as MockDb, where, from, select, orderByResult };
}

describe('resolveEnvelopeTransactions', () => {
  const ROWS: MockTx[] = [
    { id: 'tx-1', transactionDate: '2026-09-05' },
    { id: 'tx-2', transactionDate: '2026-09-10' },
  ];

  it('returns every non-deleted transaction for the envelope when no limit is given', async () => {
    const { db } = makeDb(ROWS);
    const result = await resolveEnvelopeTransactions(db, 'hh-1', 'env-1');
    expect(Array.from(result)).toEqual(ROWS);
  });

  it('applies limit() when a limit is given', async () => {
    const { db, orderByResult } = makeDb(ROWS);
    const result = await resolveEnvelopeTransactions(db, 'hh-1', 'env-1', 1);
    expect(orderByResult.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(ROWS.slice(0, 1));
  });

  it('scopes the query to the given household and envelope', async () => {
    const { db, from, select } = makeDb(ROWS);
    await resolveEnvelopeTransactions(db, 'hh-1', 'env-1');
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

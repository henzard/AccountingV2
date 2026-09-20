import { resolveMeterReadingsLogged } from '../resolveMeterReadingsLogged';

function makeDb(rows: { id: string }[]) {
  return { all: jest.fn().mockResolvedValue(rows) } as unknown as Parameters<
    typeof resolveMeterReadingsLogged
  >[0];
}

describe('resolveMeterReadingsLogged', () => {
  it('returns true when a matching reading exists', async () => {
    const db = makeDb([{ id: 'reading-1' }]);
    const result = await resolveMeterReadingsLogged(db, 'hh-1', '2026-09-01', '2026-09-30');
    expect(result).toBe(true);
  });

  it('returns false when no reading matches the period', async () => {
    const db = makeDb([]);
    const result = await resolveMeterReadingsLogged(db, 'hh-1', '2026-09-01', '2026-09-30');
    expect(result).toBe(false);
  });

  it('issues exactly one query against the provided db', async () => {
    const db = makeDb([]);
    await resolveMeterReadingsLogged(db, 'hh-1', '2026-09-01', '2026-09-30');
    expect(db.all).toHaveBeenCalledTimes(1);
  });
});

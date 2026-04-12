import { resolveBabyStepIsActive } from '../resolveBabyStepIsActive';

function makeDb(rows: Record<string, unknown>[]) {
  const whereFn = jest.fn().mockResolvedValue(rows);
  const fromFn = jest.fn().mockReturnValue({ where: whereFn });
  const selectFn = jest.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

describe('resolveBabyStepIsActive', () => {
  it('no rows → returns false', async () => {
    const db = makeDb([]);
    const result = await resolveBabyStepIsActive(db as any, 'h1');
    expect(result).toBe(false);
  });

  it('one completed step → returns true', async () => {
    const db = makeDb([{ id: 'bs-1', stepNumber: 1, isCompleted: true }]);
    const result = await resolveBabyStepIsActive(db as any, 'h1');
    expect(result).toBe(true);
  });

  it('all 7 steps completed → returns true', async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      id: `bs-${n}`,
      stepNumber: n,
      isCompleted: true,
    }));
    const db = makeDb(rows);
    const result = await resolveBabyStepIsActive(db as any, 'h1');
    expect(result).toBe(true);
  });
});

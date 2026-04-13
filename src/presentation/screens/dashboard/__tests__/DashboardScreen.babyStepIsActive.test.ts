/**
 * Task 3.8: Caller migration test.
 *
 * Verifies that resolveBabyStepIsActive returns the correct boolean given what
 * the DB returns, confirming the caller wiring contract.
 *
 * The function adds `WHERE is_completed = true` — the mock DB simulates this by
 * returning only the rows that would pass the filter.
 *
 * Spec §Scoring integration — "Caller resolves babyStepIsActive via
 * resolveBabyStepIsActive(householdId) helper in src/domain/shared/".
 */

import { resolveBabyStepIsActive } from '../../../../domain/shared/resolveBabyStepIsActive';

// Mock the DB and schema
jest.mock('../../../../data/local/db', () => ({ db: {} }));

describe('Task 3.8 — DashboardScreen babyStepIsActive caller contract', () => {
  /**
   * makeDb simulates the DB after it has applied the WHERE is_completed = true filter.
   * Pass only the rows the DB would return given that filter.
   */
  const makeDb = (filteredRows: { isCompleted: boolean }[]) => ({
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(filteredRows),
      }),
    }),
  });

  it('returns false when no rows exist (no baby steps seeded)', async () => {
    const db = makeDb([]) as any;
    const result = await resolveBabyStepIsActive(db, 'hh-1');
    expect(result).toBe(false);
  });

  it('returns true when the DB returns at least one row (one step completed)', async () => {
    const db = makeDb([{ isCompleted: true }]) as any;
    const result = await resolveBabyStepIsActive(db, 'hh-1');
    expect(result).toBe(true);
  });

  it('returns true when all 7 steps are completed (DB returns 7 rows)', async () => {
    const db = makeDb(
      Array.from({ length: 7 }, () => ({ isCompleted: true })),
    ) as any;
    const result = await resolveBabyStepIsActive(db, 'hh-1');
    expect(result).toBe(true);
  });

});

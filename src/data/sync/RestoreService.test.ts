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

describe('RestoreService.restoreHousehold — baby_steps in dispatch map', () => {
  /**
   * Builds a minimal Supabase mock that records which tables are fetched.
   * Returns { supabaseMock, fetchedTables }.
   */
  function makeSupabaseMock(householdData: Record<string, unknown>, memberRows: unknown[]) {
    const fetchedTables: string[] = [];
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: householdData, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: memberRows, error: null });
            }
            // Entity tables (envelopes, transactions, debts, meter_readings, baby_steps)
            fetchedTables.push(table);
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;
    return { supabase, fetchedTables };
  }

  it('includes baby_steps in the restoreTable dispatch', async () => {
    const hhRow = {
      id: 'hh-1',
      name: 'Test Household',
      payday_day: 1,
      user_level: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const { supabase, fetchedTables } = makeSupabaseMock(hhRow, []);

    const insertOnConflictDoUpdate = jest.fn().mockResolvedValue({});
    const insertOnConflictDoNothing = jest.fn().mockResolvedValue({});
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: insertOnConflictDoUpdate,
          onConflictDoNothing: insertOnConflictDoNothing,
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    expect(fetchedTables).toContain('baby_steps');
  });

  it('restores baby_steps rows returned by Supabase into local DB', async () => {
    const hhRow = {
      id: 'hh-1',
      name: 'Test Household',
      payday_day: 1,
      user_level: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const babyStepRows = [
      {
        id: 'bs-1',
        household_id: 'hh-1',
        step_number: 1,
        is_completed: false,
        completed_at: null,
        is_manual: false,
        celebrated_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const insertedRows: unknown[] = [];

    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: hhRow, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: [], error: null });
            }
            if (table === 'baby_steps' && col === 'household_id') {
              return Promise.resolve({ data: babyStepRows, error: null });
            }
            // Other entity tables return empty
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {
      insert: () => ({
        values: (row: unknown) => {
          if (
            row &&
            typeof row === 'object' &&
            'stepNumber' in (row as Record<string, unknown>)
          ) {
            insertedRows.push(row);
          }
          return {
            onConflictDoUpdate: jest.fn().mockResolvedValue({}),
            onConflictDoNothing: jest.fn().mockResolvedValue({}),
          };
        },
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    // At least one baby_steps row was inserted into local DB
    expect(insertedRows.length).toBeGreaterThan(0);
    const inserted = insertedRows[0] as Record<string, unknown>;
    expect(inserted.stepNumber).toBe(1);
    expect(inserted.isSynced).toBe(true);
  });
});

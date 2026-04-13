jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) }));

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
   * Minimal shape required from the parts of SupabaseClient used by RestoreService.
   */
  interface SupabaseMockShape {
    from: (table: string) => {
      select: () => {
        eq: (col: string, val: unknown) =>
          | Promise<{ data: unknown[]; error: null }>
          | { single: () => Promise<{ data: unknown; error: null }> };
      };
    };
  }

  /**
   * Builds a minimal Supabase mock that records which entity tables are fetched.
   * @param householdData  Row returned for the `households` single-fetch.
   * @param memberRows     Rows returned for `household_members` list-fetch.
   * @param tableOverrides Optional map from table name → rows to return instead of [].
   */
  function makeSupabaseMock(
    householdData: Record<string, unknown>,
    memberRows: unknown[],
    tableOverrides: Record<string, unknown[]> = {},
  ): { supabase: SupabaseMockShape; fetchedTables: string[] } {
    const fetchedTables: string[] = [];
    const supabase: SupabaseMockShape = {
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
            const rows = tableOverrides[table] ?? [];
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
    };
    return { supabase, fetchedTables };
  }

  const baseHhRow = {
    id: 'hh-1',
    name: 'Test Household',
    payday_day: 1,
    user_level: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('includes baby_steps in the restoreTable dispatch', async () => {
    const { supabase, fetchedTables } = makeSupabaseMock(baseHhRow, []);

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

    const svc = new RestoreService(db, supabase as any);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    expect(fetchedTables).toContain('baby_steps');
  });

  it('restores baby_steps rows returned by Supabase into local DB', async () => {
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

    const { supabase } = makeSupabaseMock(baseHhRow, [], { baby_steps: babyStepRows });

    const insertedRows: unknown[] = [];
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

    const svc = new RestoreService(db, supabase as any);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    // At least one baby_steps row was inserted into local DB
    expect(insertedRows.length).toBeGreaterThan(0);
    const inserted = insertedRows[0] as Record<string, unknown>;
    expect(inserted.stepNumber).toBe(1);
    expect(inserted.isSynced).toBe(true);
  });
});

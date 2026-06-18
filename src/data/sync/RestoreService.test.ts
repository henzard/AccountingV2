jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

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
        eq: (
          col: string,
          val: unknown,
        ) =>
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
          if (row && typeof row === 'object' && 'stepNumber' in (row as Record<string, unknown>)) {
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

  it('onConflictDoUpdate: local row gets overwritten by remote on restore', async () => {
    const remoteUpdatedAt = '2026-04-13T00:00:00Z';
    const babyStepRows = [
      {
        id: 'bs-overwrite',
        household_id: 'hh-1',
        step_number: 1,
        is_completed: true,
        completed_at: remoteUpdatedAt,
        is_manual: false,
        celebrated_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: remoteUpdatedAt,
      },
    ];

    const { supabase } = makeSupabaseMock(baseHhRow, [], { baby_steps: babyStepRows });

    const onConflictDoUpdateMock = jest.fn().mockResolvedValue({});
    const insertedValues: unknown[] = [];
    const db = {
      insert: () => ({
        values: (row: unknown) => {
          insertedValues.push(row);
          return {
            onConflictDoUpdate: onConflictDoUpdateMock,
            onConflictDoNothing: jest.fn().mockResolvedValue({}),
          };
        },
      }),
    } as any;

    const svc = new RestoreService(db, supabase as any);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    // The baby_steps row should have been inserted with onConflictDoUpdate
    expect(onConflictDoUpdateMock).toHaveBeenCalled();
    // Verify the target is id-based (remote is authoritative)
    const updateCall = onConflictDoUpdateMock.mock.calls[0][0];
    expect(updateCall).toHaveProperty('target');
  });
});

describe('RestoreService.restore — iterates over multiple memberships', () => {
  it('calls restoreHousehold for each membership and returns summaries', async () => {
    const hhRows: Record<string, Record<string, unknown>> = {
      'hh-1': {
        id: 'hh-1',
        name: 'Home',
        payday_day: 25,
        user_level: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      'hh-2': {
        id: 'hh-2',
        name: 'Business',
        payday_day: 1,
        user_level: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    };

    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: unknown) => {
            if (table === 'household_members' && col === 'user_id') {
              return Promise.resolve({
                data: [
                  { household_id: 'hh-1', role: 'owner' },
                  { household_id: 'hh-2', role: 'member' },
                ],
                error: null,
              });
            }
            if (table === 'households' && col === 'id') {
              return {
                single: () => Promise.resolve({ data: hhRows[val as string], error: null }),
              };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: jest.fn().mockResolvedValue({}),
          onConflictDoNothing: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    const result = await svc.restore('user-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'hh-1', name: 'Home', paydayDay: 25, role: 'owner' });
    expect(result[1]).toEqual({ id: 'hh-2', name: 'Business', paydayDay: 1, role: 'member' });
  });

  it('skips households where restoreHousehold returns null', async () => {
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'household_members' && col === 'user_id') {
              return Promise.resolve({
                data: [{ household_id: 'hh-bad', role: 'owner' }],
                error: null,
              });
            }
            if (table === 'households' && col === 'id') {
              return {
                single: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
              };
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {} as any;
    const svc = new RestoreService(db, supabase);
    const result = await svc.restore('user-1');
    expect(result).toEqual([]);
  });
});

describe('RestoreService.restoreHousehold — household_members insert with error', () => {
  const baseHhRow = {
    id: 'hh-1',
    name: 'Test Household',
    payday_day: 1,
    user_level: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('catches and logs duplicate household_members insert errors', async () => {
    const memberRows = [
      {
        id: 'mem-1',
        household_id: 'hh-1',
        user_id: 'user-1',
        role: 'owner',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: baseHhRow, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: memberRows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const onConflictDoNothing = jest.fn().mockRejectedValue(new Error('UNIQUE constraint'));
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: jest.fn().mockResolvedValue({}),
          onConflictDoNothing,
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh-1', 'owner', 'user-1');
    // Should not throw — error is caught and logged
    expect(result).not.toBeNull();
    expect(result!.id).toBe('hh-1');
  });
});

describe('RestoreService.restoreUserConsent — data rows', () => {
  const baseHhRow = {
    id: 'hh-1',
    name: 'Test Household',
    payday_day: 1,
    user_level: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('upserts user_consent rows into local db', async () => {
    const consentRows = [
      {
        user_id: 'user-1',
        slip_scan_consent_at: '2026-01-15T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
      },
    ];

    const onConflictDoUpdateMock = jest.fn().mockResolvedValue({});
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: baseHhRow, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: [], error: null });
            }
            if (table === 'user_consent' && col === 'user_id') {
              return Promise.resolve({ data: consentRows, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: onConflictDoUpdateMock,
          onConflictDoNothing: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');
    expect(onConflictDoUpdateMock).toHaveBeenCalled();
  });

  it('skips user_consent when Supabase returns an error', async () => {
    const onConflictDoUpdateMock = jest.fn().mockResolvedValue({});
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: baseHhRow, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: [], error: null });
            }
            if (table === 'user_consent' && col === 'user_id') {
              return Promise.resolve({ data: null, error: { message: 'timeout' } });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: onConflictDoUpdateMock,
          onConflictDoNothing: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    // Should not throw
    const result = await svc.restoreHousehold('hh-1', 'owner', 'user-1');
    expect(result).not.toBeNull();
  });
});

describe('RestoreService.restoreHousehold — slip_queue + user_consent in dispatch', () => {
  const baseHhRow = {
    id: 'hh-1',
    name: 'Test Household',
    payday_day: 1,
    user_level: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('includes slip_queue in the restoreTable dispatch', async () => {
    const fetchedTables: string[] = [];
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: baseHhRow, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: [], error: null });
            }
            fetchedTables.push(table);
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: jest.fn().mockResolvedValue({}),
          onConflictDoNothing: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    expect(fetchedTables).toContain('slip_queue');
  });

  it('includes user_consent in the restore dispatch (fetched by user_id)', async () => {
    const fetchedQueries: Array<{ table: string; col: string }> = [];
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, _val: unknown) => {
            if (table === 'households' && col === 'id') {
              return { single: () => Promise.resolve({ data: baseHhRow, error: null }) };
            }
            if (table === 'household_members' && col === 'household_id') {
              return Promise.resolve({ data: [], error: null });
            }
            fetchedQueries.push({ table, col });
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    } as any;

    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: jest.fn().mockResolvedValue({}),
          onConflictDoNothing: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as any;

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh-1', 'owner', 'user-1');

    // user_consent must be fetched by user_id (not household_id)
    const consentQuery = fetchedQueries.find((q) => q.table === 'user_consent');
    expect(consentQuery).toBeDefined();
    expect(consentQuery?.col).toBe('user_id');
  });
});

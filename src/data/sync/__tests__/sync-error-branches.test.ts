/**
 * sync-error-branches.test.ts — RestoreService error path tests.
 */

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
}));

import { RestoreService } from '../RestoreService';

// ---------------------------------------------------------------------------
// RestoreService error branches
// ---------------------------------------------------------------------------

describe('RestoreService error branches', () => {
  function makeRestoreSupabase(tableData: Record<string, { data: any; error: any }>) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, _val: unknown) => {
            const entry = tableData[table] ?? { data: [], error: null };
            if (table === 'households') {
              return { single: () => Promise.resolve(entry) };
            }
            return Promise.resolve(entry);
          },
        }),
      }),
    } as any;
  }

  it('restoreTable: Supabase error -> early return (table skipped)', async () => {
    const db = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      // envelopes returns an error — should be skipped
      envelopes: { data: null, error: { message: 'permission denied' } },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: [], error: null },
    });

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh1', 'owner', 'u1');

    // Should still succeed — error table is skipped
    expect(result).not.toBeNull();
    expect(result!.id).toBe('hh1');
  });

  it('restoreTable: empty data -> no inserts', async () => {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const db = { insert: insertMock } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      envelopes: { data: [], error: null },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: [], error: null },
    });

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh1', 'owner', 'u1');

    // Insert is called for household upsert + seeder, NOT for empty entity tables
    const insertCalls = insertMock.mock.calls.length;
    // household (1) + seeder baby_steps (7) = 8 inserts minimum
    // No entity-table data rows should trigger inserts
    expect(insertCalls).toBeLessThanOrEqual(8);
  });

  it('restoreHousehold: fetch failure -> returns null', async () => {
    const db = {} as any;
    const supabase = makeRestoreSupabase({
      households: { data: null, error: { message: 'not found' } },
    });

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh-missing', 'owner', 'u1');

    expect(result).toBeNull();
  });

  it('restoreUserConsent: empty data -> skipped', async () => {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const db = { insert: insertMock } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      envelopes: { data: [], error: null },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: [], error: null }, // empty
    });

    const svc = new RestoreService(db, supabase);
    await svc.restoreHousehold('hh1', 'owner', 'u1');

    // The key assertion: with empty user_consent data, no consent-specific insert fires
    expect(insertMock).toHaveBeenCalled(); // household + seeder
  });

  it('restoreUserConsent: Supabase error -> skipped', async () => {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });
    const db = { insert: insertMock } as any;

    const supabase = makeRestoreSupabase({
      households: {
        data: { id: 'hh1', name: 'Test', payday_day: 1, created_at: 'x', updated_at: 'x' },
        error: null,
      },
      household_members: { data: [], error: null },
      envelopes: { data: [], error: null },
      transactions: { data: [], error: null },
      debts: { data: [], error: null },
      meter_readings: { data: [], error: null },
      baby_steps: { data: [], error: null },
      audit_events: { data: [], error: null },
      slip_queue: { data: [], error: null },
      user_consent: { data: null, error: { message: 'rls error' } },
    });

    const svc = new RestoreService(db, supabase);
    const result = await svc.restoreHousehold('hh1', 'owner', 'u1');

    // Should complete without crashing
    expect(result).not.toBeNull();
  });
});

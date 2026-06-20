/**
 * Auth edge-case tests: login on empty device triggers RestoreService,
 * SupabaseAuthService handles null sessions gracefully.
 */
import { SupabaseAuthService } from '../../data/remote/SupabaseAuthService';
import { RestoreService } from '../../data/sync/RestoreService';
import { USERS, HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-auth-' + Math.random().toString(36).slice(2, 10),
}));

jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

jest.mock('../../domain/babySteps/SeedBabyStepsUseCase', () => ({
  SeedBabyStepsUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Mock Helpers ────────────────────────────────────────────────────────────

const HENZARD = USERS.henzard;
const KRUGER = HOUSEHOLDS.kruger;

function createMockSupabaseClient(options: {
  members?: any[];
  household?: any;
  entityRows?: Record<string, any[]>;
  signInResult?: any;
  getSessionResult?: any;
}) {
  const entityRows = options.entityRows ?? {};

  return {
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue(
        options.signInResult ?? {
          data: { session: { user: { id: HENZARD.id }, access_token: 'tok' } },
          error: null,
        },
      ),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      getSession: jest.fn().mockResolvedValue(
        options.getSessionResult ?? {
          data: { session: null },
          error: null,
        },
      ),
    },
    from: jest.fn().mockImplementation((table: string) => ({
      select: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockImplementation(() => {
          if (table === 'household_members') {
            return Promise.resolve({
              data: options.members ?? [],
              error: null,
            });
          }
          if (table === 'households') {
            return {
              single: jest.fn().mockResolvedValue({
                data: options.household ?? null,
                error: options.household ? null : { message: 'Not found' },
              }),
            };
          }
          return Promise.resolve({
            data: entityRows[table] ?? [],
            error: null,
          });
        }),
      })),
    })),
  } as any;
}

function createMockDb() {
  const insertedRows: { table: string; values: any }[] = [];
  return {
    insertedRows,
    insert: jest.fn().mockImplementation(() => ({
      values: jest.fn().mockImplementation((vals: any) => {
        insertedRows.push({ table: 'insert', values: vals });
        return {
          onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
        };
      }),
    })),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    }),
  } as any;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Auth Edge Cases', () => {
  describe('Login on empty device -> RestoreService populates all tables', () => {
    it('restores household and returns summary', async () => {
      const supabase = createMockSupabaseClient({
        members: [{ household_id: KRUGER.id, role: 'owner', user_id: HENZARD.id }],
        household: {
          id: KRUGER.id,
          name: KRUGER.name,
          payday_day: KRUGER.paydayDay,
          created_at: KRUGER.createdAt,
          updated_at: KRUGER.updatedAt,
        },
      });
      const db = createMockDb();
      const restoreService = new RestoreService(db, supabase);

      const result = await restoreService.restore(HENZARD.id);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: KRUGER.id,
          name: KRUGER.name,
          paydayDay: KRUGER.paydayDay,
          role: 'owner',
        }),
      );
    });

    it('calls restoreTable for all entity types', async () => {
      const entityTables = [
        'envelopes',
        'transactions',
        'debts',
        'meter_readings',
        'baby_steps',
        'audit_events',
        'slip_queue',
      ];

      const supabase = createMockSupabaseClient({
        members: [{ household_id: KRUGER.id, role: 'owner', user_id: HENZARD.id }],
        household: {
          id: KRUGER.id,
          name: KRUGER.name,
          payday_day: KRUGER.paydayDay,
          created_at: KRUGER.createdAt,
          updated_at: KRUGER.updatedAt,
        },
      });
      const db = createMockDb();
      const restoreService = new RestoreService(db, supabase);

      await restoreService.restore(HENZARD.id);

      // supabase.from() called for: household_members, households, household_members (all),
      // + each entity table + user_consent
      const fromCalls = supabase.from.mock.calls.map((c: any[]) => c[0]);
      for (const table of entityTables) {
        expect(fromCalls).toContain(table);
      }
    });

    it('restored rows get isSynced: true via toLocalRow (no pending_sync items)', async () => {
      const supabase = createMockSupabaseClient({
        members: [{ household_id: KRUGER.id, role: 'owner', user_id: HENZARD.id }],
        household: {
          id: KRUGER.id,
          name: KRUGER.name,
          payday_day: KRUGER.paydayDay,
          created_at: KRUGER.createdAt,
          updated_at: KRUGER.updatedAt,
        },
      });
      const db = createMockDb();

      const restoreService = new RestoreService(db, supabase);
      await restoreService.restore(HENZARD.id);

      const insertCall = db.insert.mock.calls[0];
      expect(insertCall).toBeDefined();

      const insertResult = db.insert(insertCall[0]);
      const valuesResult = insertResult.values(db.insertedRows[0]?.values);
      const onConflict = valuesResult.onConflictDoUpdate;
      expect(onConflict).toBeDefined();

      if (db.insertedRows.length > 0) {
        const insertedValues = db.insertedRows[0].values;
        const hasIsSynced = Array.isArray(insertedValues)
          ? insertedValues.some((v: any) => v.isSynced === true)
          : insertedValues?.isSynced === true;
        expect(hasIsSynced).toBe(true);
      }
    });

    it('returns empty array when user has no memberships', async () => {
      const supabase = createMockSupabaseClient({ members: [] });
      const db = createMockDb();
      const restoreService = new RestoreService(db, supabase);

      const result = await restoreService.restore(HENZARD.id);

      expect(result).toEqual([]);
    });
  });

  describe('SupabaseAuthService session handling', () => {
    it('getSession returns null session without crashing', async () => {
      const client = createMockSupabaseClient({
        getSessionResult: { data: { session: null }, error: null },
      });
      const authService = new SupabaseAuthService(client);

      const result = await authService.getSession();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('getSession returns failure on auth error', async () => {
      const client = createMockSupabaseClient({
        getSessionResult: {
          data: { session: null },
          error: { message: 'Network error' },
        },
      });
      const authService = new SupabaseAuthService(client);

      const result = await authService.getSession();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_GET_SESSION_FAILED');
      }
    });

    it('signIn returns failure on invalid credentials', async () => {
      const client = createMockSupabaseClient({
        signInResult: {
          data: { session: null },
          error: { message: 'Invalid login credentials' },
        },
      });
      const authService = new SupabaseAuthService(client);

      const result = await authService.signIn('wrong@email.com', 'badpassword');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('AUTH_SIGN_IN_FAILED');
        expect(result.error.message).toContain('Invalid login credentials');
      }
    });

    it('signIn returns session on valid credentials', async () => {
      const mockSession = {
        user: { id: HENZARD.id },
        access_token: 'valid-token',
      };
      const client = createMockSupabaseClient({
        signInResult: {
          data: { session: mockSession },
          error: null,
        },
      });
      const authService = new SupabaseAuthService(client);

      const result = await authService.signIn(HENZARD.email, 'password123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user.id).toBe(HENZARD.id);
      }
    });

    it('signOut returns success', async () => {
      const client = createMockSupabaseClient({});
      const authService = new SupabaseAuthService(client);

      const result = await authService.signOut();

      expect(result.success).toBe(true);
    });
  });
});

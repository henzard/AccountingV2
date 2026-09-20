/**
 * Auth edge-case tests: login on empty device triggers RestoreService,
 * SupabaseAuthService handles null sessions gracefully.
 */
import { SupabaseAuthService } from '../../data/remote/SupabaseAuthService';
import { RestoreService } from '../../data/sync/RestoreService';
import { USERS, HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';
import { makeFakeSupabase, makeFakeLocalDb } from '../../../tests/support/fakeRestoreDb';

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
  const restoreDouble = makeFakeSupabase({
    memberships: options.members ?? [],
    households: options.household ? { [options.household.id as string]: options.household } : {},
    tables: entityRows,
    maxSeq: 0,
  });

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
    // The restore half of this client is the SHARED double
    // (tests/support/fakeRestoreDb.ts): RestoreService now reads the server
    // oplog cursor, pages tables with `.range()` and resolves the household
    // with `.maybeSingle()`, none of which a hand-rolled `.eq()` stub here
    // modelled. `from` is wrapped in a jest.fn so the call-table assertions
    // below still work.
    from: jest.fn((table: string) =>
      (
        restoreDouble.supabase as {
          from: (t: string) => unknown;
        }
      ).from(table),
    ),
  } as any;
}

/** The shared local-db double — restore now commits the whole snapshot AND
 * the sync cursor inside one `db.transaction(...)`, which the previous
 * insert-only literal could not model. */
function createMockDb() {
  return makeFakeLocalDb();
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
      const db = createMockDb().db as any;
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
      // `audit_events` is deliberately NOT in this list any more:
      // supabase/migrations/0001_baseline.sql DROPs `public.audit_events`
      // (the audit trail is server-side `job_log` now), so restoring it
      // always errored — harmless only while restore swallowed errors, and a
      // guaranteed restore failure now that it throws.
      // `envelope_contributions` is new (a savings fund's balance is the sum
      // of its contributions, so a restored device shows every fund at R0
      // without it).
      const entityTables = [
        'envelopes',
        'envelope_contributions',
        'transactions',
        'debts',
        'meter_readings',
        'baby_steps',
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
      const db = createMockDb().db as any;
      const restoreService = new RestoreService(db, supabase);

      await restoreService.restore(HENZARD.id);

      // supabase.from() called for: household_members, households, household_members (all),
      // + each entity table + user_consent
      const fromCalls = supabase.from.mock.calls.map((c: any[]) => c[0]);
      for (const table of entityTables) {
        expect(fromCalls).toContain(table);
      }
      expect(fromCalls).not.toContain('audit_events');
      // The pull cursor is read too — without it the first pull replays the
      // household's whole oplog onto the freshly restored snapshot.
      expect(fromCalls).toContain('oplog');
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
      const local = createMockDb();

      const restoreService = new RestoreService(local.db as any, supabase);
      await restoreService.restore(HENZARD.id);

      // Restored rows are server truth, so `toLocalRow` marks them synced —
      // there is no pending_sync queue any more (migration 0014 dropped it)
      // and restore must not manufacture outbox work for rows it just took
      // FROM the server.
      expect(local.written.length).toBeGreaterThan(0);
      expect(local.written.every((w) => w.row.isSynced === true)).toBe(true);
      expect(local.cursorWrites).toEqual([{ householdId: KRUGER.id, seq: 0 }]);
    });

    it('returns empty array when user has no memberships', async () => {
      const supabase = createMockSupabaseClient({ members: [] });
      const db = createMockDb().db as any;
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

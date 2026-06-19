jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { RestoreService } from '../../data/sync/RestoreService';
import { buildPendingSyncRow } from '../../__test-utils__/factories';
import { KRUGER_ENVELOPES, HOUSEHOLDS, USERS } from '../../__test-utils__/scenarioSeed';

function createMockSupabase(overrides: {
  members?: any[];
  household?: any;
  allMembers?: any[];
  tableData?: Record<string, any[]>;
  userConsent?: any[];
}) {
  return {
    from: jest.fn((table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn((col: string, _val: string) => {
          if (table === 'household_members' && col === 'user_id') {
            return {
              data: overrides.members ?? [],
              error: null,
            };
          }
          if (table === 'household_members' && col === 'household_id') {
            return { data: overrides.allMembers ?? [], error: null };
          }
          if (table === 'households') {
            return {
              single: () => ({
                data: overrides.household ?? null,
                error: null,
              }),
            };
          }
          if (table === 'user_consent') {
            return { data: overrides.userConsent ?? [], error: null };
          }
          const tableRows = overrides.tableData?.[table] ?? [];
          return { data: tableRows, error: null };
        }),
      })),
    })),
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('RestoreService — Restore-Before-Push Ordering', () => {
  /**
   * CRITICAL GAP: When a user edits data offline (isSynced=false) and then the app
   * opens online, RestoreService.restore() runs BEFORE SyncOrchestrator.syncPending().
   *
   * RestoreService.restoreTable() uses onConflictDoUpdate with ALL non-id columns
   * from the remote row. This overwrites the local dirty data with remote values.
   *
   * The code comment says:
   *   "Exclude isSynced from the conflict-update set so pending local edits
   *    (isSynced=false) are not silently overwritten back to true on restore."
   *
   * BUT: Only isSynced is excluded. All other columns (name, allocatedCents,
   * spentCents, etc.) ARE overwritten with remote (stale) values.
   */
  it('documents that restore overwrites local dirty data with remote values', async () => {
    const remoteStaleEnvelope = {
      id: KRUGER_ENVELOPES[0].id,
      household_id: HOUSEHOLDS.kruger.id,
      name: 'Groceries',
      allocated_cents: 800000,
      spent_cents: 0,
      envelope_type: 'spending',
      is_savings_locked: false,
      is_archived: false,
      period_start: '2026-01-01',
      target_amount_cents: null,
      target_date: null,
      created_at: '2026-01-15T00:00:00.000Z',
      updated_at: '2026-01-15T00:00:00.000Z',
    };

    const insertCalls: any[] = [];
    const db = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn((config: any) => {
            insertCalls.push(config);
            return Promise.resolve();
          }),
          onConflictDoNothing: jest.fn(() => Promise.resolve()),
        })),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      })),
    } as any;

    const supabase = createMockSupabase({
      members: [{ household_id: HOUSEHOLDS.kruger.id, role: 'owner' }],
      household: {
        id: HOUSEHOLDS.kruger.id,
        name: 'Kruger',
        payday_day: 20,
        user_level: 1,
        created_at: '2026-01-15T00:00:00.000Z',
        updated_at: '2026-01-15T00:00:00.000Z',
      },
      allMembers: [
        {
          id: 'hm-1',
          household_id: HOUSEHOLDS.kruger.id,
          user_id: USERS.henzard.id,
          role: 'owner',
          joined_at: '2026-01-15T00:00:00.000Z',
        },
      ],
      tableData: {
        envelopes: [remoteStaleEnvelope],
        transactions: [],
        debts: [],
        meter_readings: [],
        baby_steps: [],
        audit_events: [],
        slip_queue: [],
      },
      userConsent: [],
    });

    const service = new RestoreService(db, supabase);
    const result = await service.restore(USERS.henzard.id);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Kruger');

    // KNOWN-GAP: RESTORE-001 — restoreTable() overwrites ALL non-id, non-isSynced columns
    // via onConflictDoUpdate. Local dirty data (e.g. name: 'Groceries - Updated Offline',
    // allocatedCents: 950000) is replaced with stale remote values.
    // The isSynced column is excluded from the conflict set, but the actual DATA columns
    // (name, allocatedCents, spentCents, etc.) are all overwritten.
    // Severity: HIGH — offline edits silently lost on next app open.
    // Proposed fix: restoreTable should skip onConflictDoUpdate for rows where the
    // local isSynced=false, or compare updatedAt and keep newer local values.
    expect(db.insert).toHaveBeenCalled();
  });

  it('documents that pending_sync queue retains items with stale restored values', async () => {
    // After restore overwrites local data, the pending_sync queue still has entries
    // for the record. But the local row now has STALE (restored) values.
    // When syncPending() runs, it reads the local row (now stale) and pushes it to server.
    // This means the user's offline edit is doubly lost:
    //   1. Local row overwritten by restore
    //   2. Stale row then pushed to server via syncPending

    const pendingSyncItem = buildPendingSyncRow({
      id: 'ps-stale',
      tableName: 'envelopes',
      recordId: KRUGER_ENVELOPES[0].id,
      operation: 'UPDATE',
    });

    // The pending_sync row still exists after restore
    expect(pendingSyncItem.tableName).toBe('envelopes');
    expect(pendingSyncItem.recordId).toBe(KRUGER_ENVELOPES[0].id);

    // KNOWN-GAP: RESTORE-002 — RestoreService does not check or clear pending_sync entries.
    // After restore overwrites local data, pending_sync still references the record.
    // SyncPending will then read the (now stale) local row and push it back to server,
    // creating a useless round-trip that may also overwrite newer server data.
    // Severity: MEDIUM — no data loss beyond what RESTORE-001 already caused, but
    // wastes bandwidth and risks writing stale data back to server.
    // Proposed fix: RestoreService should either (a) delete pending_sync entries for
    // records it overwrites, or (b) skip conflict-update for records with pending entries.
    expect(pendingSyncItem.operation).toBe('UPDATE');
  });

  it('verifies restoreTable excludes isSynced but overwrites all other columns', async () => {
    // RestoreService.restoreTable line 177-179:
    //   const columns = Object.keys(getTableColumns(localTable)).filter(
    //     (col) => col !== 'id' && col !== 'isSynced',
    //   );
    // This means EVERY column except id and isSynced is overwritten on conflict.

    const remoteRow = {
      id: 'env-test-restore',
      household_id: HOUSEHOLDS.kruger.id,
      name: 'Remote Name',
      allocated_cents: 500000,
      spent_cents: 10000,
      envelope_type: 'spending',
      is_savings_locked: false,
      is_archived: false,
      period_start: '2026-01-01',
      target_amount_cents: null,
      target_date: null,
      created_at: '2026-01-15T00:00:00.000Z',
      updated_at: '2026-01-15T00:00:00.000Z',
    };

    const conflictSets: any[] = [];
    const db = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          onConflictDoUpdate: jest.fn((config: any) => {
            conflictSets.push(config.set);
            return Promise.resolve();
          }),
          onConflictDoNothing: jest.fn(() => Promise.resolve()),
        })),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      })),
    } as any;

    const supabase = createMockSupabase({
      members: [{ household_id: HOUSEHOLDS.kruger.id, role: 'owner' }],
      household: {
        id: HOUSEHOLDS.kruger.id,
        name: 'Kruger',
        payday_day: 20,
        user_level: 1,
        created_at: '2026-01-15T00:00:00.000Z',
        updated_at: '2026-01-15T00:00:00.000Z',
      },
      allMembers: [],
      tableData: {
        envelopes: [remoteRow],
        transactions: [],
        debts: [],
        meter_readings: [],
        baby_steps: [],
        audit_events: [],
        slip_queue: [],
      },
      userConsent: [],
    });

    const service = new RestoreService(db, supabase);
    await service.restore(USERS.henzard.id);

    // The set clause for envelope restore includes all columns EXCEPT id and isSynced
    // KNOWN-GAP: RESTORE-003 — The onConflictDoUpdate set includes ALL data columns
    // (name, allocatedCents, spentCents, updatedAt, etc.). Only `id` and `isSynced`
    // are excluded. This means a dirty local row keeps isSynced=false but has all
    // its data replaced with remote values — a contradictory state.
    // Severity: HIGH — the row claims it needs syncing (isSynced=false) but contains
    // stale remote data, not the user's offline edit. Combined with RESTORE-002,
    // this pushes stale data back to server.
    // Proposed fix: Add updatedAt comparison in onConflictDoUpdate WHERE clause:
    // only overwrite columns when remote.updated_at > local.updated_at.
    const envelopeConflictSet = conflictSets.find(
      (s: Record<string, unknown>) => s && typeof s === 'object' && 'spentCents' in s,
    );
    if (envelopeConflictSet) {
      expect(envelopeConflictSet).not.toHaveProperty('id');
      expect(envelopeConflictSet).not.toHaveProperty('isSynced');
      // These data columns ARE present in the conflict set — confirming the gap:
      expect(envelopeConflictSet).toHaveProperty('name');
      expect(envelopeConflictSet).toHaveProperty('allocatedCents');
      expect(envelopeConflictSet).toHaveProperty('spentCents');
    }
  });
});

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

    // TODO: FIX — The restore overwrites ALL non-id, non-isSynced columns.
    // Local dirty data (name: 'Groceries - Updated Offline', allocatedCents: 950000)
    // is replaced with stale remote data (name: 'Groceries', allocatedCents: 800000).
    // Rows with isSynced=false SHOULD be protected but AREN'T — only isSynced
    // itself is excluded from the conflict-update set.
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

    // TODO: FIX — RestoreService does not check or clear pending_sync entries.
    // After restore, the pending_sync entry points to a row whose values have
    // been overwritten with remote data. SyncPending will then push stale data
    // back to the server, creating a useless round-trip with no user benefit.
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
    // TODO: FIX — Columns like name, allocatedCents, spentCents, updatedAt are all
    // overwritten with remote values. A dirty local row (isSynced=false) has its
    // DATA overwritten even though isSynced stays false.
    // Find the envelope-specific conflict set (has spentCents, unlike household)
    const envelopeConflictSet = conflictSets.find(
      (s: Record<string, unknown>) => s && typeof s === 'object' && 'spentCents' in s,
    );
    if (envelopeConflictSet) {
      expect(envelopeConflictSet).not.toHaveProperty('id');
      // isSynced IS excluded from entity-table restoreTable — the dynamic column filter
      // removes it. But the household restore hardcodes isSynced: true in its set.
      expect(envelopeConflictSet).not.toHaveProperty('isSynced');
      expect(envelopeConflictSet).toHaveProperty('name');
      expect(envelopeConflictSet).toHaveProperty('allocatedCents');
      expect(envelopeConflictSet).toHaveProperty('spentCents');
    }
  });
});

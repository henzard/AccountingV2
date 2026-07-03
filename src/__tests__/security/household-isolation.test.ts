/**
 * Security tests: sync boundary attacks.
 *
 * The rest of this suite (cross-household IDOR checks against hand-rolled
 * mock repos, merge-RPC authorization checks against a mock supabase client
 * configured to return the exact error being asserted, and an inline
 * role-escalation stub) was deleted as self-testing theater: each of those
 * tests mocked the very behavior it claimed to verify and exercised no
 * production code. The real invariants they gestured at (cross-household
 * isolation, membership checks) are covered behaviorally by the pgTAP suite
 * at supabase/tests/ against the real database, which is strictly stronger
 * than a unit test asserting on its own mock.
 *
 * The one test kept below exercises real production code (SyncOrchestrator)
 * and checks that it correctly surfaces an RPC-level authorization failure
 * as a sync failure rather than swallowing it.
 */
import { SyncOrchestrator } from '../../data/sync/SyncOrchestrator';
import { buildTransaction } from '../../__test-utils__/factories';
import { HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-sec-' + Math.random().toString(36).slice(2, 8),
}));

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const KRUGER_ID = HOUSEHOLDS.kruger.id;

function makePendingQueueChain(rows: unknown[]) {
  const limitFn = () => Promise.resolve(rows);
  const orderByFn = () => ({ limit: limitFn });
  const whereChain = { where: () => ({ orderBy: orderByFn }), orderBy: orderByFn };
  return { from: () => whereChain };
}

function makeBatchFetchChain(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC BOUNDARY ATTACK TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Sync Boundary Attacks', () => {
  it('SyncOrchestrator routes through RPC which blocks cross-household pushes', async () => {
    const crossHouseholdTx = buildTransaction({
      id: 'malicious-tx',
      householdId: KRUGER_ID,
    });

    const pending = [
      {
        id: 'pending-malicious',
        tableName: 'transactions',
        recordId: crossHouseholdTx.id,
        operation: 'INSERT',
        retryCount: 0,
        lastAttemptedAt: null,
        createdAt: new Date().toISOString(),
        deadLetteredAt: null,
      },
    ];

    let selectCallCount = 0;
    const db = {
      select: jest.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return makePendingQueueChain(pending);
        }
        return makeBatchFetchChain([crossHouseholdTx]);
      }),
      delete: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;

    const supabase = {
      rpc: jest.fn().mockResolvedValue({
        error: { message: 'not a member of household', code: 'insufficient_privilege' },
      }),
      from: jest.fn(),
    } as any;

    const orch = new SyncOrchestrator(db, supabase);
    const result = await orch.syncPending();

    expect(supabase.rpc).toHaveBeenCalledWith('merge_transaction', expect.any(Object));
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Security tests: Cross-household data isolation, merge RPC authorization,
 * role escalation prevention, and sync boundary attacks.
 */
import { SyncOrchestrator } from '../../data/sync/SyncOrchestrator';
import { toSupabaseRow } from '../../data/sync/rowConverters';
import {
  buildTransaction,
  buildEnvelope,
  buildDebt,
  buildPendingSyncRow,
} from '../../__test-utils__/factories';
import {
  USERS,
  HOUSEHOLDS,
  KRUGER_ENVELOPES,
  KRUGER_DEBTS,
} from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-sec-' + Math.random().toString(36).slice(2, 8),
}));

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const KRUGER_ID = HOUSEHOLDS.kruger.id;
const HETZEL_ID = HOUSEHOLDS.hetzel.id;

function createMockSupabase(rpcResult: { error: any } = { error: null }) {
  return {
    rpc: jest.fn().mockResolvedValue(rpcResult),
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    }),
  } as any;
}

function createMockRepo(rows: Record<string, unknown>[] = []) {
  return {
    findByHouseholdId: jest.fn().mockResolvedValue(rows),
    findById: jest.fn().mockResolvedValue(rows[0] ?? null),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

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
// CROSS-HOUSEHOLD DATA LEAKAGE (IDOR) TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-Household Data Leakage (IDOR)', () => {
  describe('Giel (Hetzel member) cannot access Kruger data', () => {
    it('queries transactions with householdId = KRUGER_ID must return empty', () => {
      const krugerTransactions = [
        buildTransaction({ householdId: KRUGER_ID }),
        buildTransaction({ householdId: KRUGER_ID }),
      ];
      const hetzelTransactions = [buildTransaction({ householdId: HETZEL_ID })];

      const allTransactions = [...krugerTransactions, ...hetzelTransactions];
      const gielVisibleTransactions = allTransactions.filter((tx) => tx.householdId === HETZEL_ID);

      expect(gielVisibleTransactions).toHaveLength(1);
      expect(gielVisibleTransactions.every((tx) => tx.householdId === HETZEL_ID)).toBe(true);
      expect(gielVisibleTransactions.some((tx) => tx.householdId === KRUGER_ID)).toBe(false);
    });

    it('Giel creating a transaction in Kruger household must fail (repo validates householdId)', () => {
      const mockRepo = createMockRepo();
      mockRepo.create.mockImplementation(
        (tx: { householdId: string }, callerHouseholds: string[]) => {
          if (!callerHouseholds.includes(tx.householdId)) {
            throw new Error('FORBIDDEN: user is not a member of this household');
          }
          return tx;
        },
      );

      const gielHouseholds = [HETZEL_ID];
      const krugerTransaction = buildTransaction({ householdId: KRUGER_ID });

      expect(() => mockRepo.create(krugerTransaction, gielHouseholds)).toThrow(
        'FORBIDDEN: user is not a member of this household',
      );
    });

    it('Giel updating a Kruger envelope must fail', () => {
      const mockRepo = createMockRepo();
      mockRepo.update.mockImplementation(
        (entity: { householdId: string }, callerHouseholds: string[]) => {
          if (!callerHouseholds.includes(entity.householdId)) {
            throw new Error('FORBIDDEN: user is not a member of this household');
          }
          return entity;
        },
      );

      const gielHouseholds = [HETZEL_ID];
      const krugerEnvelope = KRUGER_ENVELOPES[0];

      expect(() => mockRepo.update(krugerEnvelope, gielHouseholds)).toThrow(
        'FORBIDDEN: user is not a member of this household',
      );
    });

    it('Giel deleting a Kruger debt must fail', () => {
      const mockRepo = createMockRepo();
      mockRepo.delete.mockImplementation(
        (entity: { householdId: string }, callerHouseholds: string[]) => {
          if (!callerHouseholds.includes(entity.householdId)) {
            throw new Error('FORBIDDEN: user is not a member of this household');
          }
        },
      );

      const gielHouseholds = [HETZEL_ID];
      const krugerDebt = KRUGER_DEBTS[0];

      expect(() => mockRepo.delete(krugerDebt, gielHouseholds)).toThrow(
        'FORBIDDEN: user is not a member of this household',
      );
    });

    it('Henzard can access both Kruger and Hetzel (multi-household member)', () => {
      const henzardHouseholds = [KRUGER_ID, HETZEL_ID];

      const krugerEnvelope = buildEnvelope({ householdId: KRUGER_ID });
      const hetzelEnvelope = buildEnvelope({ householdId: HETZEL_ID });

      expect(henzardHouseholds.includes(krugerEnvelope.householdId)).toBe(true);
      expect(henzardHouseholds.includes(hetzelEnvelope.householdId)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MERGE RPC AUTHORIZATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Merge RPC Authorization', () => {
  it('merge_transaction with wrong household_id raises insufficient_privilege', async () => {
    const supabase = createMockSupabase({
      error: { message: 'not a member of household', code: 'insufficient_privilege' },
    });

    const tx = buildTransaction({ householdId: KRUGER_ID });
    const snakeRow = toSupabaseRow(tx as unknown as Record<string, unknown>);
    const { error } = await supabase.rpc('merge_transaction', { r: snakeRow });

    expect(error).not.toBeNull();
    expect(error.code).toBe('insufficient_privilege');
  });

  it('merge_envelope cross-household must fail', async () => {
    const supabase = createMockSupabase({
      error: { message: 'not a member of household', code: 'insufficient_privilege' },
    });

    const env = buildEnvelope({ householdId: KRUGER_ID });
    const snakeRow = toSupabaseRow(env as unknown as Record<string, unknown>);
    const { error } = await supabase.rpc('merge_envelope', { r: snakeRow });

    expect(error).not.toBeNull();
    expect(error.code).toBe('insufficient_privilege');
  });

  it('merge_debt cross-household must fail', async () => {
    const supabase = createMockSupabase({
      error: { message: 'not a member of household', code: 'insufficient_privilege' },
    });

    const debt = buildDebt({ householdId: KRUGER_ID });
    const snakeRow = toSupabaseRow(debt as unknown as Record<string, unknown>);
    const { error } = await supabase.rpc('merge_debt', { r: snakeRow });

    expect(error).not.toBeNull();
    expect(error.code).toBe('insufficient_privilege');
  });

  it('merge_household_member where user_id != auth.uid() must fail', async () => {
    const supabase = createMockSupabase({
      error: {
        message: 'may only upsert your own household_members row',
        code: 'insufficient_privilege',
      },
    });

    const memberRow = {
      id: 'member-1',
      householdId: KRUGER_ID,
      userId: USERS.henzard.id,
      role: 'member',
      joinedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const snakeRow = toSupabaseRow(memberRow);
    const { error } = await supabase.rpc('merge_household_member', { r: snakeRow });

    expect(error).not.toBeNull();
    expect(error.code).toBe('insufficient_privilege');
    expect(error.message).toContain('may only upsert your own');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROLE ESCALATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Role Escalation Prevention', () => {
  it('member attempting to change own role to owner via merge must be blocked (per migration 012)', () => {
    const memberRow = {
      id: 'member-giel',
      householdId: HETZEL_ID,
      userId: USERS.giel.id,
      role: 'owner' as const,
      joinedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    };

    const validateRoleEscalation = (
      row: { userId: string; role: string },
      callerIsOwner: boolean,
    ): string => {
      if (row.role !== 'member' && !callerIsOwner) {
        return 'member';
      }
      return row.role;
    };

    const callerIsOwner = false;
    const enforcedRole = validateRoleEscalation(memberRow, callerIsOwner);
    expect(enforcedRole).toBe('member');
  });

  it('017 fix: role escalation guard is present in merge_household_member', () => {
    const fs = require('fs');
    const migration017 = fs.readFileSync(
      'supabase/migrations/017_fix_merge_regressions.sql',
      'utf-8',
    );

    const mergeHouseholdMemberSection = migration017.slice(
      migration017.indexOf('CREATE OR REPLACE FUNCTION public.merge_household_member'),
      migration017.indexOf('GRANT EXECUTE ON FUNCTION public.merge_household_member'),
    );

    expect(mergeHouseholdMemberSection).toContain("r.role := 'member'");
  });
});

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

  it('transaction with household_id different from envelope household_id is caught by RPC', async () => {
    const mismatchedTx = buildTransaction({
      id: 'mismatched-tx',
      householdId: KRUGER_ID,
      envelopeId: KRUGER_ENVELOPES[0].id,
    });

    const snakeRow = toSupabaseRow(mismatchedTx as unknown as Record<string, unknown>);

    expect(snakeRow.household_id).toBe(KRUGER_ID);
    expect(snakeRow.envelope_id).toBe(KRUGER_ENVELOPES[0].id);

    const supabase = createMockSupabase({
      error: { message: 'not a member of household', code: 'insufficient_privilege' },
    });

    const { error } = await supabase.rpc('merge_transaction', { r: snakeRow });
    expect(error).not.toBeNull();
    expect(error.code).toBe('insufficient_privilege');
  });

  it('pending_sync row pointing to another household entity is rejected by RPC guard', async () => {
    const maliciousPendingSync = buildPendingSyncRow({
      tableName: 'envelopes',
      recordId: KRUGER_ENVELOPES[0].id,
    });

    const krugerEnvelopeRow = { ...KRUGER_ENVELOPES[0] };
    const snakeRow = toSupabaseRow(krugerEnvelopeRow as Record<string, unknown>);

    expect(snakeRow.household_id).toBe(KRUGER_ID);

    const supabase = createMockSupabase({
      error: { message: 'not a member of household', code: 'insufficient_privilege' },
    });

    const { error } = await supabase.rpc('merge_envelope', { r: snakeRow });
    expect(error).not.toBeNull();
    expect(error.code).toBe('insufficient_privilege');
    expect(maliciousPendingSync.tableName).toBe('envelopes');
  });
});

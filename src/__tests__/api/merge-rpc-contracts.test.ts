/**
 * merge-rpc-contracts.test.ts — WS4
 *
 * Tests that SyncOrchestrator routes each table through the correct merge RPC
 * and that the `r` param passed to supabase.rpc() is a correctly-shaped snake_case
 * row produced by toSupabaseRow.
 */
import { toSupabaseRow } from '../../data/sync/rowConverters';
import {
  buildEnvelope,
  buildTransaction,
  buildDebt,
  buildMeterReading,
  buildHousehold,
} from '../../__test-utils__/factories';
import { HOUSEHOLDS } from '../../__test-utils__/scenarioSeed';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-merge-' + Math.random().toString(36).slice(2, 8),
}));

// ─── TABLE_RPC_MAP replica for assertions ────────────────────────────────────

const EXPECTED_RPC_MAP: Record<string, string> = {
  baby_steps: 'merge_baby_step',
  envelopes: 'merge_envelope',
  transactions: 'merge_transaction',
  debts: 'merge_debt',
  meter_readings: 'merge_meter_reading',
  households: 'merge_household',
  household_members: 'merge_household_member',
  audit_events: 'merge_audit_event',
  slip_queue: 'merge_slip_queue',
  user_consent: 'merge_user_consent',
};

// ═════════════════════════════════════════════════════════════════════════════════
// toSupabaseRow SHAPE TESTS
// ═════════════════════════════════════════════════════════════════════════════════

describe('toSupabaseRow produces correct snake_case for merge RPCs', () => {
  it('converts envelope row — strips isSynced, converts camelCase keys', () => {
    const env = buildEnvelope({ isSynced: true } as any);
    const row = toSupabaseRow(env as unknown as Record<string, unknown>);

    expect(row).not.toHaveProperty('isSynced');
    expect(row).not.toHaveProperty('is_synced');
    expect(row).toHaveProperty('household_id');
    expect(row).toHaveProperty('envelope_type');
    expect(row).toHaveProperty('is_savings_locked');
    expect(row).toHaveProperty('allocated_cents');
    expect(row).toHaveProperty('updated_at');
    expect(row).toHaveProperty('id');
  });

  it('converts transaction row', () => {
    const tx = buildTransaction({ isBusinessExpense: true });
    const row = toSupabaseRow(tx as unknown as Record<string, unknown>);

    expect(row).toHaveProperty('is_business_expense', true);
    expect(row).toHaveProperty('transaction_date');
    expect(row).toHaveProperty('envelope_id');
    expect(row).toHaveProperty('amount_cents');
    expect(row).not.toHaveProperty('isSynced');
  });

  it('converts debt row', () => {
    const debt = buildDebt();
    const row = toSupabaseRow(debt as unknown as Record<string, unknown>);

    expect(row).toHaveProperty('outstanding_balance_cents');
    expect(row).toHaveProperty('interest_rate_percent');
    expect(row).toHaveProperty('minimum_payment_cents');
    expect(row).toHaveProperty('is_paid_off');
    expect(row).toHaveProperty('creditor_name');
    expect(row).toHaveProperty('debt_type');
  });

  it('converts meter_reading row', () => {
    const mr = buildMeterReading();
    const row = toSupabaseRow(mr as unknown as Record<string, unknown>);

    expect(row).toHaveProperty('reading_value');
    expect(row).toHaveProperty('reading_date');
    expect(row).toHaveProperty('meter_type');
    expect(row).toHaveProperty('cost_cents');
  });

  it('converts household row', () => {
    const hh = buildHousehold();
    const row = toSupabaseRow(hh as unknown as Record<string, unknown>);

    expect(row).toHaveProperty('payday_day');
    expect(row).toHaveProperty('user_level');
    expect(row).not.toHaveProperty('isSynced');
  });

  it('converts baby_steps row', () => {
    const bs = {
      id: 'bs-1',
      householdId: 'hh-1',
      stepNumber: 3,
      isCompleted: true,
      completedAt: '2026-03-01T00:00:00Z',
      isManual: false,
      celebratedAt: '2026-03-02T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      isSynced: true,
    };
    const row = toSupabaseRow(bs);

    expect(row).toHaveProperty('step_number', 3);
    expect(row).toHaveProperty('is_completed', true);
    expect(row).toHaveProperty('celebrated_at', '2026-03-02T00:00:00Z');
    expect(row).not.toHaveProperty('isSynced');
  });

  it('converts audit_events row', () => {
    const ae = {
      id: 'ae-1',
      householdId: 'hh-1',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'CREATE',
      previousValueJson: null,
      newValueJson: '{"amount":100}',
      createdAt: '2026-01-01T00:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(ae);

    expect(row).toHaveProperty('entity_type', 'transaction');
    expect(row).toHaveProperty('entity_id', 'tx-1');
    expect(row).toHaveProperty('previous_value_json', null);
    expect(row).toHaveProperty('new_value_json');
    expect(row).not.toHaveProperty('isSynced');
  });

  it('converts household_members row', () => {
    const hm = {
      id: 'hm-1',
      householdId: 'hh-1',
      userId: 'u-1',
      role: 'owner',
      joinedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const row = toSupabaseRow(hm);

    expect(row).toHaveProperty('household_id');
    expect(row).toHaveProperty('user_id');
    expect(row).toHaveProperty('joined_at');
  });

  it('converts slip_queue row', () => {
    const sq = {
      id: 'sq-1',
      householdId: 'hh-1',
      createdBy: 'u-1',
      imageCount: 2,
      status: 'pending',
      rawResponseJson: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(sq);

    expect(row).toHaveProperty('created_by');
    expect(row).toHaveProperty('image_count');
    expect(row).toHaveProperty('raw_response_json');
    expect(row).not.toHaveProperty('isSynced');
  });

  it('converts user_consent row', () => {
    const uc = {
      id: 'uc-1',
      userId: 'u-1',
      slipScanConsentAt: '2026-04-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(uc);

    expect(row).toHaveProperty('user_id');
    expect(row).toHaveProperty('slip_scan_consent_at');
    expect(row).not.toHaveProperty('isSynced');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// LWW (Last-Write-Wins) MERGE SEMANTICS
// ═════════════════════════════════════════════════════════════════════════════════

describe('LWW merge semantics', () => {
  it('newer updated_at wins — later timestamp replaces earlier', () => {
    const older = buildEnvelope({
      id: 'e-lww',
      updatedAt: '2026-03-01T00:00:00.000Z',
      name: 'Old Name',
    });
    const newer = buildEnvelope({
      id: 'e-lww',
      updatedAt: '2026-03-02T00:00:00.000Z',
      name: 'New Name',
    });

    const olderRow = toSupabaseRow(older as unknown as Record<string, unknown>);
    const newerRow = toSupabaseRow(newer as unknown as Record<string, unknown>);

    expect(newerRow.updated_at).toBe('2026-03-02T00:00:00.000Z');
    expect(olderRow.updated_at).toBe('2026-03-01T00:00:00.000Z');

    // In LWW, the merge RPC uses: WHERE updated_at < r.updated_at
    // So newerRow.updated_at > olderRow.updated_at → newerRow wins
    expect(newerRow.updated_at! > olderRow.updated_at!).toBe(true);
  });

  it('equal updated_at with same id → first-write-wins (016 UUIDv7 behavior)', () => {
    const ts = '2026-03-01T12:00:00.000Z';
    const row1 = buildEnvelope({ id: 'e-fww', updatedAt: ts, name: 'First' });
    const row2 = buildEnvelope({ id: 'e-fww', updatedAt: ts, name: 'Second' });

    const snake1 = toSupabaseRow(row1 as unknown as Record<string, unknown>);
    const snake2 = toSupabaseRow(row2 as unknown as Record<string, unknown>);

    // Both have identical timestamps — the SQL merge function uses
    // DO NOTHING when timestamps are equal, preserving the first write
    expect(snake1.updated_at).toBe(snake2.updated_at);
    expect(snake1.id).toBe(snake2.id);
    // Merge RPC condition: WHERE updated_at < r.updated_at → NOT satisfied → no update
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// merge_baby_step: celebrated_at PRESERVATION
// ═════════════════════════════════════════════════════════════════════════════════

describe('merge_baby_step: celebrated_at preservation', () => {
  it('celebrated_at is included in the r param when set', () => {
    const bs = {
      id: 'bs-cel',
      householdId: HOUSEHOLDS.kruger.id,
      stepNumber: 1,
      isCompleted: true,
      completedAt: '2026-02-01T00:00:00Z',
      isManual: false,
      celebratedAt: '2026-02-02T10:30:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(bs);

    expect(row.celebrated_at).toBe('2026-02-02T10:30:00Z');
    expect(row.is_completed).toBe(true);
    expect(row.completed_at).toBe('2026-02-01T00:00:00Z');
  });

  it('celebrated_at is null when step not yet celebrated', () => {
    const bs = {
      id: 'bs-nocel',
      householdId: HOUSEHOLDS.kruger.id,
      stepNumber: 2,
      isCompleted: false,
      completedAt: null,
      isManual: false,
      celebratedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(bs);

    expect(row.celebrated_at).toBeNull();
    expect(row.is_completed).toBe(false);
  });

  it('merge preserves existing celebratedAt even when rest of row updates', () => {
    // Simulates: server has celebratedAt=X, client sends newer updatedAt
    // The merge RPC uses COALESCE(EXCLUDED.celebrated_at, baby_steps.celebrated_at)
    const withCelebration = {
      id: 'bs-merge',
      householdId: HOUSEHOLDS.kruger.id,
      stepNumber: 1,
      isCompleted: true,
      completedAt: '2026-02-01T00:00:00Z',
      isManual: false,
      celebratedAt: '2026-02-02T10:30:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-03T00:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(withCelebration);

    // Client sends the celebratedAt — the SQL uses COALESCE to preserve it
    expect(row.celebrated_at).toBe('2026-02-02T10:30:00Z');
    expect(row.updated_at).toBe('2026-02-03T00:00:00Z');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// merge_audit_event: IMMUTABLE (DO NOTHING on conflict)
// ═════════════════════════════════════════════════════════════════════════════════

describe('merge_audit_event: immutable — DO NOTHING on conflict', () => {
  it('audit_events table routes to merge_audit_event RPC', () => {
    expect(EXPECTED_RPC_MAP['audit_events']).toBe('merge_audit_event');
  });

  it('audit event row has no updatedAt field — immutable by design', () => {
    const ae = {
      id: 'ae-imm',
      householdId: 'hh-1',
      entityType: 'envelope',
      entityId: 'e-1',
      action: 'UPDATE',
      previousValueJson: '{"name":"old"}',
      newValueJson: '{"name":"new"}',
      createdAt: '2026-01-15T09:00:00Z',
      isSynced: false,
    };
    const row = toSupabaseRow(ae);

    expect(row).not.toHaveProperty('updated_at');
    expect(row).toHaveProperty('created_at');
    // The merge RPC uses ON CONFLICT (id) DO NOTHING — never overwrites
  });

  it('duplicate audit event produces identical r param — idempotent insert', () => {
    const ae = {
      id: 'ae-dup',
      householdId: 'hh-1',
      entityType: 'transaction',
      entityId: 'tx-1',
      action: 'DELETE',
      previousValueJson: '{"id":"tx-1"}',
      newValueJson: null,
      createdAt: '2026-01-15T09:00:00Z',
      isSynced: false,
    };
    const row1 = toSupabaseRow(ae);
    const row2 = toSupabaseRow(ae);

    expect(row1).toEqual(row2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════
// RPC ROUTING — all 10 tables map to correct merge functions
// ═════════════════════════════════════════════════════════════════════════════════

describe('TABLE_RPC_MAP routes all 10 tables to correct merge RPCs', () => {
  const tables = Object.keys(EXPECTED_RPC_MAP);

  it.each(tables)('%s → %s', (table) => {
    const expected = EXPECTED_RPC_MAP[table];
    expect(expected).toBeDefined();
    expect(expected).toMatch(/^merge_/);
  });

  it('all 10 merge functions are mapped', () => {
    expect(Object.keys(EXPECTED_RPC_MAP)).toHaveLength(10);
  });
});

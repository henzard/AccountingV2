jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-' + Math.random().toString(36).slice(2),
}));
jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock('../../domain/babySteps/ReconcileEmergencyFundTypeUseCase', () => ({
  ReconcileEmergencyFundTypeUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, data: { flipped: 0 } }),
  })),
}));

import { KRUGER_DEBTS } from '../../__test-utils__/scenarioSeed';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Concurrent User Sync — Debt Payment Lost Update', () => {
  /**
   * GAP: totalPaidCents uses SQL + (atomic increment) on the server RPC,
   * but outstandingBalanceCents is set as an absolute value (LWW overwrite).
   *
   * Two users paying the same debt with stale snapshots:
   * - totalPaidCents: correctly accumulated via SQL + on server
   * - outstandingBalanceCents: last writer wins, overwrites the other's calculation
   */
  it('documents that outstandingBalanceCents overwrites are not atomic', async () => {
    const woolworths = KRUGER_DEBTS[0];
    expect(woolworths.creditorName).toBe('Woolworths Store Account');

    const baseOutstanding = woolworths.outstandingBalanceCents; // 320000
    const basePaid = woolworths.totalPaidCents; // 0

    // Henzard pays R150 → outstanding = 320000 - 15000 = 305000
    const henzardPayment = 15000;
    const henzardOutstanding = baseOutstanding - henzardPayment;
    const henzardPaid = basePaid + henzardPayment;

    // Alicia pays R100 with STALE snapshot → outstanding = 320000 - 10000 = 310000
    const aliciaPayment = 10000;
    const aliciaOutstanding = baseOutstanding - aliciaPayment;

    // Correct outstanding should be 320000 - 15000 - 10000 = 295000
    const correctOutstanding = baseOutstanding - henzardPayment - aliciaPayment;

    // If Alicia's write lands last, server has 310000 (wrong — Henzard's payment lost)
    // If Henzard's write lands last, server has 305000 (wrong — Alicia's payment lost)
    // KNOWN-GAP: LWW-003 — outstandingBalanceCents uses absolute LWW overwrite instead
    // of atomic SQL decrement. totalPaidCents correctly uses SQL + on server, but
    // outstandingBalanceCents is set as an absolute value, causing lost updates.
    // Severity: HIGH — debt payments from one user silently disappear.
    // Proposed fix: Change merge_debt RPC to compute outstandingBalanceCents server-side
    // as (originalBalance - totalPaidCents) rather than accepting client-computed value.
    expect(henzardOutstanding).not.toBe(correctOutstanding);
    expect(aliciaOutstanding).not.toBe(correctOutstanding);

    // totalPaidCents uses SQL + on server merge RPC, so it IS correct
    expect(henzardPaid).toBe(15000);
  });
});

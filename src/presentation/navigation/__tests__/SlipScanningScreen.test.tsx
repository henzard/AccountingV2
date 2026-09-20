/**
 * SlipScanningScreen.test.tsx
 *
 * SlipScanningScreen loads the envelope picker options for the slip-confirm
 * flow via a raw `db.select(...)` (id/name/allocatedCents/envelopeType only —
 * no `spentCents` column, since that column was dropped in migration 0012)
 * and then merges in the ledger-derived spend from `getEnvelopeSpentCents`
 * before handing `EnvelopeOption[]` down to `SlipScanningStackNavigator`.
 *
 * This test proves that wiring end-to-end: the rendered balance reflects the
 * derived map, not any value living on the raw row.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// ─── Heavy child navigator — capture the `envelopes` prop it receives ────────
jest.mock('../SlipScanningStackNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Text } = require('react-native');
  return {
    SlipScanningStackNavigator: (props: {
      envelopes: Array<{ id: string; name: string; allocatedCents: number; spentCents: number }>;
    }) =>
      React.createElement(
        View,
        { testID: 'slip-stack-navigator' },
        props.envelopes.map((e) =>
          React.createElement(
            Text,
            { key: e.id, testID: `envelope-${e.id}` },
            `${e.name}:${e.allocatedCents - e.spentCents}`,
          ),
        ),
      ),
  };
});

// ─── useSlipScanner hook — not exercised by this test ────────────────────────
jest.mock('../../hooks/useSlipScanner', () => ({
  useSlipScanner: jest.fn(() => ({ start: jest.fn(), progress: { stage: 'capturing' } })),
}));

// ─── Application/domain/infrastructure singletons constructed at module load ─
// SlipScanningScreen instantiates a handful of collaborators once at module
// scope (`new DrizzleSlipQueueRepository(db)`, `new AuditLogger(db)`, etc.).
// None of them are exercised by this test — mock them all so import doesn't
// throw, and so nothing here couples to their real implementations.
jest.mock('../../../application/SlipScanFlow', () => ({
  SlipScanFlow: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../domain/slipScanning/CaptureSlipUseCase', () => ({
  CaptureSlipUseCase: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../domain/slipScanning/UploadSlipImagesUseCase', () => ({
  UploadSlipImagesUseCase: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../domain/slipScanning/ExtractSlipUseCase', () => ({
  ExtractSlipUseCase: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../domain/slipScanning/ConfirmSlipUseCase', () => ({
  ConfirmSlipUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));
jest.mock('../../../domain/slipScanning/RecordSlipConsentUseCase', () => ({
  RecordSlipConsentUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));
jest.mock('../../../data/repositories/DrizzleSlipQueueRepository', () => ({
  DrizzleSlipQueueRepository: jest.fn().mockImplementation(() => ({ update: jest.fn() })),
}));
jest.mock('../../../data/repositories/DrizzleUserConsentRepository', () => ({
  DrizzleUserConsentRepository: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
  })),
}));
jest.mock('../../../infrastructure/slipScanning/SupabaseSlipImageUploader', () => ({
  SupabaseSlipImageUploader: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../infrastructure/slipScanning/ExpoSlipImageCompressor', () => ({
  ExpoSlipImageCompressor: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../infrastructure/slipScanning/EdgeFunctionSlipExtractor', () => ({
  EdgeFunctionSlipExtractor: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../domain/transactions/CreateTransactionUseCase', () => ({
  CreateTransactionUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));
jest.mock('../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../data/remote/supabaseClient', () => ({ supabase: {} }));

// ─── BudgetPeriodEngine — fixed period so periodStart is deterministic ───────
jest.mock('../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
    })),
  })),
  // `formatPeriodDateKey` (L7 tz-consistent period key) is a plain exported
  // function, not a class member — the screen now imports it alongside
  // `BudgetPeriodEngine`, so this manual module mock must also provide it.
  formatPeriodDateKey: (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
}));

// ─── appStore ─────────────────────────────────────────────────────────────────
jest.mock('../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      householdId: 'hh-1',
      session: { user: { id: 'user-1' } },
      paydayDay: 25,
    }),
  ),
}));

// ─── DB mock — mirrors AddTransactionScreen's chained select().from().where() ─
jest.mock('../../../data/local/db', () => ({
  db: { select: jest.fn() },
}));

// spentCents is derived from the ledger (getEnvelopeSpentCents), not a stored
// column — the raw rows returned by the mocked db chain deliberately omit it.
jest.mock('../../../data/local/balances/EnvelopeBalanceQuery', () => ({
  getEnvelopeSpentCents: jest.fn(),
  // Real implementation exercised elsewhere (useEnvelopes.periodScope.test.ts,
  // AddTransactionScreen.periodScope.test.tsx) — stubbed here since this test
  // only asserts the ledger-derived-balance wiring, not the scope predicate.
  envelopeScopeCondition: jest.fn(() => 'scope-condition'),
}));

jest.mock('drizzle-orm', () => ({
  and: jest.fn((...args: unknown[]) => args),
  eq: jest.fn((col: unknown, val: unknown) => ({ col, val })),
  ne: jest.fn((col: unknown, val: unknown) => ({ col, val })),
  isNull: jest.fn((col: unknown) => ({ col, isNull: true })),
}));

jest.mock('../../../data/local/schema', () => ({
  envelopes: {
    id: 'id',
    name: 'name',
    allocatedCents: 'allocatedCents',
    envelopeType: 'envelopeType',
    householdId: 'householdId',
    periodStart: 'periodStart',
    isArchived: 'isArchived',
    deletedAt: 'deletedAt',
  },
}));

import { SlipScanningScreen } from '../SlipScanningScreen';
import { getEnvelopeSpentCents } from '../../../data/local/balances/EnvelopeBalanceQuery';
import { SlipScanFlow } from '../../../application/SlipScanFlow';
import { requestSyncNow } from '../../../data/sync/syncRuntime';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db: mockDb } = require('../../../data/local/db');

const mockSlipScanFlow = SlipScanFlow as jest.MockedClass<typeof SlipScanFlow>;
// `SlipScanningScreen` constructs its `SlipScanFlow` singleton once at
// MODULE LOAD (the `import` above) — before any `beforeEach`'s
// `jest.clearAllMocks()` has a chance to wipe the mock's recorded calls.
// Snapshot the constructor args here, once, for the DB-13 wiring test below.
const slipScanFlowCtorArgs = mockSlipScanFlow.mock.calls[0]?.[0];

const mockGetEnvelopeSpentCents = getEnvelopeSpentCents as jest.MockedFunction<
  typeof getEnvelopeSpentCents
>;

function setupDbChain(rows: Array<{ id: string; [k: string]: unknown }>): void {
  const mockThen = jest.fn((cb: (r: object[]) => void) => {
    cb(rows);
    return { catch: jest.fn() };
  });
  const mockWhere = jest.fn(() => ({ then: mockThen }));
  const mockFrom = jest.fn(() => ({ where: mockWhere }));
  mockDb.select.mockReturnValue({ from: mockFrom });
}

describe('SlipScanningScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders envelope options with balances derived from the ledger, not a raw column', async () => {
    // Raw rows selected off the `envelopes` table — note: NO `spentCents` field,
    // matching the real query (that column no longer exists post-migration 0012).
    setupDbChain([
      { id: 'env-1', name: 'Groceries', allocatedCents: 1000, envelopeType: 'spending' },
      { id: 'env-2', name: 'Transport', allocatedCents: 500, envelopeType: 'spending' },
    ]);
    // The ledger-derived map is the ONLY source of spend for these envelopes.
    mockGetEnvelopeSpentCents.mockResolvedValue(
      new Map([
        ['env-1', 200],
        ['env-2', 500],
      ]),
    );

    const { getByTestId } = render(<SlipScanningScreen />);

    await waitFor(() => {
      expect(getByTestId('envelope-env-1')).toBeTruthy();
    });

    // Groceries: allocated=1000, derived spend=200 → balance 800
    expect(getByTestId('envelope-env-1').props.children).toBe('Groceries:800');
    // Transport: allocated=500, derived spend=500 → balance 0
    expect(getByTestId('envelope-env-2').props.children).toBe('Transport:0');

    expect(mockGetEnvelopeSpentCents).toHaveBeenCalledWith(mockDb, 'hh-1', '2026-04-01');
  });

  it('defaults spentCents to 0 when the ledger has no transactions for an envelope', async () => {
    setupDbChain([
      { id: 'env-3', name: 'Utilities', allocatedCents: 300, envelopeType: 'utility' },
    ]);
    mockGetEnvelopeSpentCents.mockResolvedValue(new Map());

    const { getByTestId } = render(<SlipScanningScreen />);

    await waitFor(() => {
      expect(getByTestId('envelope-env-3')).toBeTruthy();
    });

    expect(getByTestId('envelope-env-3').props.children).toBe('Utilities:300');
  });

  // DB-13: the slip_queue insert must reach the server before extraction
  // calls the edge function (it 403s on a row it hasn't seen). SlipScanFlow
  // is constructed once at module scope with `ensureSynced` wired to
  // `requestSyncNow` (src/data/sync/syncRuntime.ts) — this only needs
  // asserting once at import time, since the module is a singleton.
  it('wires SlipScanFlow.ensureSynced to requestSyncNow (DB-13)', () => {
    expect(slipScanFlowCtorArgs).toEqual(expect.objectContaining({ ensureSynced: requestSyncNow }));
  });
});

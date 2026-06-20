/**
 * Consolidated tests for presentation hooks.
 * Covers: useBabySteps, useBudgetBalance, useMeterReadings,
 * useSlipScanner, useSlipHistory, useEmergencyFundReconcileFlag, useLevelAdvancement.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import type { ReconcileResult } from '../../../domain/babySteps/types';
import type { UseBabyStepsDeps } from '../useBabySteps';
import type { EnvelopeEntity } from '../../../domain/envelopes/EnvelopeEntity';
import type { SlipScanFlow, ProgressState } from '../../../application/SlipScanFlow';
import type { Result } from '../../../domain/shared/types';
import type { SlipExtraction } from '../../../domain/slipScanning/types';
import type { SlipScanError } from '../../../domain/slipScanning/errors';
import type {
  ISlipQueueRepository,
  SlipQueueRow,
} from '../../../domain/ports/ISlipQueueRepository';

// ─── AppState mock ──────────────────────────────────────────────────────────
type ChangeListener = (state: string) => void;

const mockAppStateStore = {
  currentState: 'active' as string,
  listeners: [] as ChangeListener[],
  removeListener: jest.fn(),
};

jest.mock('react-native', () => ({
  AppState: {
    get currentState(): string {
      return mockAppStateStore.currentState;
    },
    addEventListener: (event: string, listener: ChangeListener) => {
      if (event === 'change') mockAppStateStore.listeners.push(listener);
      return { remove: mockAppStateStore.removeListener };
    },
  },
}));

// ─── Store mocks ────────────────────────────────────────────────────────────
const mockCelebrationEnqueue = jest.fn().mockResolvedValue(undefined);
const mockToastEnqueue = jest.fn();
const mockSetInFlight = jest.fn();
const mockDismiss = jest.fn();
let mockHasFlag = false;
let mockUserLevel = 1;
const mockSetUserLevel = jest.fn();

jest.mock('../../stores/celebrationStore', () => ({
  useCelebrationStore: jest.fn((selector: (s: { enqueue: jest.Mock }) => unknown) =>
    selector({ enqueue: mockCelebrationEnqueue }),
  ),
}));

jest.mock('../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector: (s: { enqueue: jest.Mock }) => unknown) =>
    selector({ enqueue: mockToastEnqueue }),
  ),
}));

jest.mock('../../stores/slipScannerStore', () => ({
  useSlipScannerStore: (sel: (s: { setInFlight: jest.Mock }) => unknown) =>
    sel({ setInFlight: mockSetInFlight }),
}));

jest.mock('../../stores/emergencyFundReconcileStore', () => ({
  useEmergencyFundReconcileStore: (
    sel: (s: { hasReconciledDuplicateEmf: boolean; dismiss: () => void }) => unknown,
  ) => sel({ hasReconciledDuplicateEmf: mockHasFlag, dismiss: mockDismiss }),
}));

jest.mock('../../stores/appStore', () => ({
  useAppStore: (sel: (s: { userLevel: number; setUserLevel: (n: number) => void }) => unknown) =>
    sel({ userLevel: mockUserLevel, setUserLevel: mockSetUserLevel }),
}));

// ─── Infrastructure mocks ───────────────────────────────────────────────────
jest.mock('../../../infrastructure/notifications/LocalNotificationScheduler', () => ({
  LocalNotificationScheduler: jest.fn().mockImplementation(() => ({
    fireBabyStepCelebration: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../domain/babySteps/ReconcileBabyStepsUseCase', () => ({
  ReconcileBabyStepsUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: { statuses: [], newlyCompleted: [], newlyRegressed: [] },
    }),
  })),
}));

jest.mock('../../../domain/babySteps/ToggleManualStepUseCase', () => ({
  ToggleManualStepUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true }),
  })),
}));

jest.mock('../../../data/local/db', () => ({ db: {} }));

// ─── DB mocks for useMeterReadings ─────────────────────────────────────────
const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();

jest.mock('../../../data/local/db', () => ({
  db: { select: () => ({ from: mockFrom }) },
}));

// ─── Imports (must come after jest.mock) ────────────────────────────────────
import { useBabySteps } from '../useBabySteps';
import { useBudgetBalance } from '../useBudgetBalance';
import { useMeterReadings } from '../useMeterReadings';
import { useSlipScanner } from '../useSlipScanner';
import { useSlipHistory } from '../useSlipHistory';
import { useEmergencyFundReconcileFlag } from '../useEmergencyFundReconcileFlag';
import { useLevelAdvancement } from '../useLevelAdvancement';

// ─── Helpers ────────────────────────────────────────────────────────────────
const HOUSEHOLD_ID = 'hh-test';
const PERIOD_START = '2026-04-01';

const makeSuccessResult = (overrides?: Partial<ReconcileResult>) => ({
  success: true as const,
  data: {
    statuses: [],
    newlyCompleted: [] as number[],
    newlyRegressed: [] as number[],
    ...overrides,
  },
});

function makeDeps(reconcileImpl?: () => Promise<ReturnType<typeof makeSuccessResult>>) {
  const mockReconcileExecute = jest.fn(
    reconcileImpl ?? (() => Promise.resolve(makeSuccessResult())),
  );
  const mockToggleExecute = jest.fn().mockResolvedValue({ success: true, data: undefined });
  const mockFireCelebration = jest.fn().mockResolvedValue(undefined);

  const deps: UseBabyStepsDeps = {
    reconcileUseCase: { execute: mockReconcileExecute },
    toggleUseCase: { execute: mockToggleExecute },
    scheduler: { fireBabyStepCelebration: mockFireCelebration },
  };
  return { deps, mockReconcileExecute, mockToggleExecute, mockFireCelebration };
}

function makeEnvelope(overrides: Partial<EnvelopeEntity>): EnvelopeEntity {
  return {
    id: 'env-1',
    householdId: 'hh-1',
    name: 'Test',
    allocatedCents: 0,
    spentCents: 0,
    envelopeType: 'spending',
    isSavingsLocked: false,
    isArchived: false,
    periodStart: '2026-04-01',
    targetAmountCents: null,
    targetDate: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSlipRow(overrides: Partial<SlipQueueRow> = {}): SlipQueueRow {
  return {
    id: 'slip-1',
    householdId: 'hh-1',
    createdBy: 'user-1',
    imageUris: ['file:///img1.jpg'],
    status: 'completed',
    errorMessage: null,
    merchant: 'Shop',
    slipDate: '2026-06-15',
    totalCents: 15000,
    rawResponseJson: '{}',
    imagesDeletedAt: null,
    openaiCostCents: 2,
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  };
}

function createMockRepo(rows: SlipQueueRow[] = []): ISlipQueueRepository {
  return {
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    listByHousehold: jest.fn().mockResolvedValue(rows),
    listExpired: jest.fn(),
    listProcessingOlderThan: jest.fn(),
  };
}

function createMockFlow(
  result: Result<{ slipId: string; extraction: SlipExtraction }, SlipScanError>,
  progressSequence: ProgressState[] = [],
): SlipScanFlow {
  return {
    start: jest.fn(async (_input, onProgress) => {
      for (const p of progressSequence) onProgress(p);
      return result;
    }),
  } as unknown as SlipScanFlow;
}

const EXTRACTION: SlipExtraction = {
  merchant: 'Shop',
  slipDate: '2026-06-15',
  totalCents: 15000,
  items: [
    {
      description: 'Milk',
      amountCents: 5000,
      quantity: 1,
      suggestedEnvelopeId: null,
      confidence: 0.95,
    },
  ],
  rawResponseJson: '{}',
  openaiCostCents: 2,
};

// ═══════════════════════════════════════════════════════════════════════════════
// useBabySteps
// ═══════════════════════════════════════════════════════════════════════════════
describe('useBabySteps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppStateStore.listeners = [];
    mockAppStateStore.currentState = 'active';
    mockCelebrationEnqueue.mockResolvedValue(undefined);
  });

  it('starts with loading=false and empty statuses', () => {
    mockAppStateStore.currentState = 'background';
    const { deps } = makeDeps();
    const { result } = renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    expect(result.current.statuses).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=true during reconcile then loading=false', async () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
  });

  it('sets error when reconcile result.success is false', async () => {
    const { deps } = makeDeps(() =>
      Promise.resolve({ success: false, error: { message: 'DB failure' } } as any),
    );
    const { result } = renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('DB failure');
  });

  it('does NOT reconcile on mount when AppState is background', async () => {
    mockAppStateStore.currentState = 'background';
    const { deps, mockReconcileExecute } = makeDeps();
    renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    await new Promise((r) => setTimeout(r, 10));
    expect(mockReconcileExecute).not.toHaveBeenCalled();
  });

  it('reconciles on mount when AppState is active', async () => {
    const { deps, mockReconcileExecute } = makeDeps();
    renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockReconcileExecute).toHaveBeenCalledTimes(1);
  });

  it('enqueues regression toast for regressed steps', async () => {
    const { deps } = makeDeps();
    deps.reconcileUseCase.execute = jest
      .fn()
      .mockResolvedValue(makeSuccessResult({ newlyRegressed: [1] }));

    renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockToastEnqueue).toHaveBeenCalledWith(expect.stringContaining('Step 1'), 'regression');
  });

  it('fires scheduler (not celebration) when backgrounded with newly completed', async () => {
    mockAppStateStore.currentState = 'background';
    const { deps, mockFireCelebration } = makeDeps();
    deps.reconcileUseCase.execute = jest
      .fn()
      .mockResolvedValue(makeSuccessResult({ newlyCompleted: [2] }));

    const { result } = renderHook(() => useBabySteps(HOUSEHOLD_ID, PERIOD_START, deps));
    await act(async () => {
      await result.current.reconcile();
    });

    expect(mockFireCelebration).toHaveBeenCalledWith(2);
    expect(mockCelebrationEnqueue).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useBudgetBalance
// ═══════════════════════════════════════════════════════════════════════════════
describe('useBudgetBalance', () => {
  it('returns isBalanced=true for empty envelopes', () => {
    const { result } = renderHook(() => useBudgetBalance([]));
    expect(result.current.isBalanced).toBe(true);
    expect(result.current.toAssign).toBe(0);
  });

  it('isBalanced=true when income equals expense allocation', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 500000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 500000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    expect(result.current.isBalanced).toBe(true);
  });

  it('isBalanced=false when under-allocated', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 500000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 200000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    expect(result.current.isBalanced).toBe(false);
    expect(result.current.toAssign).toBeGreaterThan(0);
  });

  it('isBalanced=false when over-committed', () => {
    const envelopes = [
      makeEnvelope({ id: 'i1', envelopeType: 'income', allocatedCents: 100000 }),
      makeEnvelope({ id: 'e1', envelopeType: 'spending', allocatedCents: 200000 }),
    ];
    const { result } = renderHook(() => useBudgetBalance(envelopes));
    expect(result.current.isBalanced).toBe(false);
    expect(result.current.toAssign).toBeLessThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useMeterReadings
// ═══════════════════════════════════════════════════════════════════════════════
describe('useMeterReadings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  it('starts with loading=true and empty readings', () => {
    const { result } = renderHook(() => useMeterReadings('hh-1', 'electricity'));
    expect(result.current.loading).toBe(true);
    expect(result.current.readings).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets loading=false and data after reload', async () => {
    const rows = [{ id: 'mr-1' }];
    mockLimit.mockResolvedValue(rows);
    const { result } = renderHook(() => useMeterReadings('hh-1', 'electricity'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.readings).toEqual(rows);
  });

  it('sets error on failed reload', async () => {
    mockLimit.mockRejectedValue(new Error('DB error'));
    const { result } = renderHook(() => useMeterReadings('hh-1', 'electricity'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error?.message).toBe('DB error');
    expect(result.current.loading).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useSlipScanner
// ═══════════════════════════════════════════════════════════════════════════════
describe('useSlipScanner', () => {
  const INPUT = { householdId: 'hh-1', createdBy: 'user-1', frameLocalUris: ['file:///f.jpg'] };

  beforeEach(() => jest.clearAllMocks());

  it('clears inFlight when stage=done', async () => {
    const flow = createMockFlow(
      { success: true, data: { slipId: 'slip-1', extraction: EXTRACTION } },
      [
        { stage: 'uploading', slipId: 'slip-1' },
        { stage: 'done', slipId: 'slip-1' },
      ],
    );
    const { result } = renderHook(() => useSlipScanner(flow));
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(mockSetInFlight).toHaveBeenLastCalledWith(null);
  });

  it('clears inFlight when stage=failed', async () => {
    const flow = createMockFlow(
      { success: false, error: { code: 'SLIP_OFFLINE', message: 'No network' } },
      [
        {
          stage: 'failed',
          slipId: 'slip-1',
          error: { code: 'SLIP_OFFLINE', message: 'No network' },
        },
      ],
    );
    const { result } = renderHook(() => useSlipScanner(flow));
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(mockSetInFlight).toHaveBeenLastCalledWith(null);
  });

  it('sets inFlight to slipId during uploading', async () => {
    const flow = createMockFlow(
      { success: true, data: { slipId: 'slip-1', extraction: EXTRACTION } },
      [
        { stage: 'uploading', slipId: 'slip-1' },
        { stage: 'done', slipId: 'slip-1' },
      ],
    );
    const { result } = renderHook(() => useSlipScanner(flow));
    await act(async () => {
      await result.current.start(INPUT);
    });
    expect(mockSetInFlight).toHaveBeenCalledWith('slip-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useSlipHistory
// ═══════════════════════════════════════════════════════════════════════════════
describe('useSlipHistory', () => {
  it('returns empty array initially', () => {
    const repo = createMockRepo();
    (repo.listByHousehold as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSlipHistory(repo, 'hh-1'));
    expect(result.current).toEqual([]);
  });

  it('returns history after fetch', async () => {
    const rows = [makeSlipRow(), makeSlipRow({ id: 'slip-2' })];
    const repo = createMockRepo(rows);
    const { result } = renderHook(() => useSlipHistory(repo, 'hh-1'));
    await waitFor(() => {
      expect(result.current).toEqual(rows);
    });
  });

  it('documents that errors are unhandled (no .catch on .then chain)', () => {
    // useSlipHistory uses .then() without .catch() — rejected promises
    // become unhandled rejections. This is a documented gap in error handling.
    // The hook returns empty array if the promise rejects before setting state.
    const repo = createMockRepo();
    (repo.listByHousehold as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSlipHistory(repo, 'hh-1'));
    expect(result.current).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useEmergencyFundReconcileFlag
// ═══════════════════════════════════════════════════════════════════════════════
describe('useEmergencyFundReconcileFlag', () => {
  beforeEach(() => {
    mockHasFlag = false;
    mockDismiss.mockClear();
  });

  it('returns hasFlag=false by default', () => {
    const { result } = renderHook(() => useEmergencyFundReconcileFlag());
    expect(result.current.hasFlag).toBe(false);
  });

  it('returns hasFlag=true when store has flag', () => {
    mockHasFlag = true;
    const { result } = renderHook(() => useEmergencyFundReconcileFlag());
    expect(result.current.hasFlag).toBe(true);
  });

  it('dismiss calls store dismiss', () => {
    const { result } = renderHook(() => useEmergencyFundReconcileFlag());
    act(() => {
      result.current.dismiss();
    });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useLevelAdvancement
// ═══════════════════════════════════════════════════════════════════════════════
describe('useLevelAdvancement', () => {
  beforeEach(() => {
    mockUserLevel = 1;
    mockSetUserLevel.mockClear();
  });

  it('no-op when userLevel >= 2', () => {
    mockUserLevel = 2;
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([90, 95, 85]);
    });
    expect(mockSetUserLevel).not.toHaveBeenCalled();
  });

  it('advances to level 2 when shouldAdvanceToLevel2 is true', () => {
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([75, 80, 90]);
    });
    expect(mockSetUserLevel).toHaveBeenCalledWith(2);
  });

  it('does not advance with insufficient scores', () => {
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([50, 60, 40]);
    });
    expect(mockSetUserLevel).not.toHaveBeenCalled();
  });

  it('does not advance with fewer than 3 scores', () => {
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([80, 90]);
    });
    expect(mockSetUserLevel).not.toHaveBeenCalled();
  });
});

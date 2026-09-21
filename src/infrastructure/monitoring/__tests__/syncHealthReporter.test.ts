/**
 * syncHealthReporter — background sync-health -> Crashlytics reporting
 * (round 8, P5). See the module doc comment in ../syncHealthReporter.ts for
 * the WHY / SCOPE NOTE / PRIVACY / SAFETY / DEDUPE rules this file verifies.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockCrashlyticsInstance = {
  setAttribute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@react-native-firebase/crashlytics', () => {
  const factory = jest.fn(() => mockCrashlyticsInstance);
  return { __esModule: true, default: factory };
});

jest.mock('../crashlytics', () => ({
  recordError: jest.fn(),
  log: jest.fn(),
}));

jest.mock('../../logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordError, log } from '../crashlytics';
import { logger } from '../../logging/Logger';
import {
  evaluateSyncHealth,
  withSyncHealthReporting,
  DEDUPE_WINDOW_MS,
  PENDING_STALE_HOURS,
  type SyncHealthEngine,
} from '../syncHealthReporter';
import type { SyncStatusSink } from '../../../data/sync/SyncScheduler';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const removeItem = AsyncStorage.removeItem as jest.Mock;
const mockRecordError = recordError as jest.Mock;
const mockLog = log as jest.Mock;
const mockWarn = logger.warn as jest.Mock;

const HH = 'hh-1';
const T0 = Date.parse('2026-03-01T12:00:00.000Z');

/** In-memory AsyncStorage fake so writes from one call are visible to the
 * next `getItem`/dedupe check — a plain resolved-value mock can't do that. */
function useFakeAsyncStorage(): void {
  const store = new Map<string, string>();
  getItem.mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null));
  setItem.mockImplementation((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  });
  removeItem.mockImplementation((key: string) => {
    store.delete(key);
    return Promise.resolve();
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeEngine(overrides: Partial<SyncHealthEngine> = {}): SyncHealthEngine {
  return {
    getPullHealth: jest.fn(() => ({ blocked: false })),
    listDeadLettered: jest.fn(() => []),
    getPendingPushCount: jest.fn(() => 0),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useFakeAsyncStorage();
});

describe('pull-blocked condition', () => {
  it('reports once with the right keys and no sensitive fields', async () => {
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({
        blocked: true,
        opIds: ['op-2', 'op-1'],
        error: 'apply failed: unknown column',
      })),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(1);
    const [err, context] = mockRecordError.mock.calls[0] as [Error, Record<string, unknown>];
    expect(err).toBeInstanceOf(Error);
    expect(context).toEqual({
      kind: 'pull_blocked',
      opIds: 'op-1,op-2',
      error: 'apply failed: unknown column',
    });
    // Full payload shape assertion — no amounts/payees/names/emails/invite
    // codes/household or user ids anywhere in the reported context.
    expect(Object.keys(context).sort()).toEqual(['error', 'kind', 'opIds']);
  });

  it('does not re-report the same signature within 24h', async () => {
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: true,
      now: () => T0 + DEDUPE_WINDOW_MS - 1,
    });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(1);
  });

  it('reports again once the dedupe window has elapsed', async () => {
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: true,
      now: () => T0 + DEDUPE_WINDOW_MS,
    });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(2);
  });

  it('reports immediately when the signature changes, even inside the window', async () => {
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    (engine.getPullHealth as jest.Mock).mockReturnValue({
      blocked: true,
      opIds: ['op-1', 'op-2'],
      error: 'boom',
    });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 + 1000 });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(2);
  });

  it('recovery logs a breadcrumb (not a non-fatal) and clears the stored signature', async () => {
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    expect(mockRecordError).toHaveBeenCalledTimes(1);

    (engine.getPullHealth as jest.Mock).mockReturnValue({ blocked: false });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 + 1000 });
    await flush();

    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('recovered'));
    expect(removeItem).toHaveBeenCalledWith('@sync_health:pull_blocked');

    // A recurrence after recovery reports again right away.
    (engine.getPullHealth as jest.Mock).mockReturnValue({
      blocked: true,
      opIds: ['op-1'],
      error: 'boom',
    });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 + 2000 });
    await flush();
    expect(mockRecordError).toHaveBeenCalledTimes(2);
  });
});

describe('dead-lettered ops condition', () => {
  it('reports once with count and distinct table names, never payloads', async () => {
    const engine = makeEngine({
      listDeadLettered: jest.fn(() => [
        {
          opId: 'op-1',
          householdId: HH,
          table: 'transactions',
          rowId: 'r1',
          opType: 'update',
          deadLetteredAt: '2026-03-01T00:00:00.000Z',
          retryCount: 3,
        },
        {
          opId: 'op-2',
          householdId: HH,
          table: 'envelopes',
          rowId: 'r2',
          opType: 'update',
          deadLetteredAt: '2026-03-01T00:00:00.000Z',
          retryCount: 3,
        },
        {
          opId: 'op-3',
          householdId: HH,
          table: 'transactions',
          rowId: 'r3',
          opType: 'update',
          deadLetteredAt: '2026-03-01T00:00:00.000Z',
          retryCount: 3,
        },
      ]),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(1);
    const [, context] = mockRecordError.mock.calls[0] as [Error, Record<string, unknown>];
    expect(context).toEqual({ kind: 'dlq', count: 3, tables: 'envelopes,transactions' });
    expect(Object.keys(context).sort()).toEqual(['count', 'kind', 'tables']);
  });

  it('does not re-report the same count/tables within 24h, but a changed count does', async () => {
    const dlq = jest.fn(() => [
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'r1',
        opType: 'update',
        deadLetteredAt: 'x',
        retryCount: 1,
      },
    ]);
    const engine = makeEngine({ listDeadLettered: dlq });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 + 1000 });
    await flush();
    expect(mockRecordError).toHaveBeenCalledTimes(1);

    dlq.mockReturnValue([
      {
        opId: 'op-1',
        householdId: HH,
        table: 'debts',
        rowId: 'r1',
        opType: 'update',
        deadLetteredAt: 'x',
        retryCount: 1,
      },
      {
        opId: 'op-2',
        householdId: HH,
        table: 'debts',
        rowId: 'r2',
        opType: 'update',
        deadLetteredAt: 'x',
        retryCount: 1,
      },
    ]);
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 + 2000 });
    await flush();
    expect(mockRecordError).toHaveBeenCalledTimes(2);
  });
});

describe('pending-stale condition — real age via getOldestPendingCreatedAt', () => {
  it('reports immediately using the engine-provided age, no first-observed wait needed', async () => {
    const oldestIso = new Date(T0 - PENDING_STALE_HOURS * 60 * 60 * 1000).toISOString();
    const engine = makeEngine({
      getPendingPushCount: jest.fn(() => 5),
      getOldestPendingCreatedAt: jest.fn(() => oldestIso),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(1);
    const [, context] = mockRecordError.mock.calls[0] as [Error, Record<string, unknown>];
    expect(context).toEqual({ kind: 'pending_stale', count: 5, oldestPendingH: 24 });
  });

  it('does not report when the real age is under the threshold', async () => {
    const oldestIso = new Date(T0 - 1000).toISOString(); // just now
    const engine = makeEngine({
      getPendingPushCount: jest.fn(() => 5),
      getOldestPendingCreatedAt: jest.fn(() => oldestIso),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockRecordError).not.toHaveBeenCalled();
  });

  it('treats a null value as "no stale ops" — never falls back to the approximation', async () => {
    const engine = makeEngine({
      getPendingPushCount: jest.fn(() => 5),
      getOldestPendingCreatedAt: jest.fn(() => null),
    });

    // Even 48h later, still no report: the engine explicitly said "nothing
    // pending" via the real diagnostic, so this must not fall back to
    // treating "first observed" as the queue's start time.
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: true,
      now: () => T0 + 48 * 60 * 60 * 1000,
    });
    await flush();

    expect(mockRecordError).not.toHaveBeenCalled();
    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_oldest_pending_h', '0');
  });

  it('treats an unparseable timestamp as "no stale ops"', async () => {
    const engine = makeEngine({
      getPendingPushCount: jest.fn(() => 5),
      getOldestPendingCreatedAt: jest.fn(() => 'not-a-date'),
    });

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockRecordError).not.toHaveBeenCalled();
    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_oldest_pending_h', '0');
  });

  it('sets sync_oldest_pending_h from the real age, not a first-observed approximation', async () => {
    const oldestIso = new Date(T0 - 5 * 60 * 60 * 1000).toISOString(); // 5h old
    const engine = makeEngine({
      getPendingPushCount: jest.fn(() => 2),
      getOldestPendingCreatedAt: jest.fn(() => oldestIso),
    });

    // A single evaluation already reports the true 5h age -- no "first
    // observed just now" approximation kicking in.
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_oldest_pending_h', '5');
  });

  it('degrades to the first-observed approximation when the engine has no such method', async () => {
    const engine = makeEngine({ getPendingPushCount: jest.fn(() => 5) });
    expect(engine.getOldestPendingCreatedAt).toBeUndefined();

    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    // Age 0h on first observation -- no real timestamp to draw on.
    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_oldest_pending_h', '0');
  });
});

describe('pending-stale condition — fallback approximation (older engine, no getOldestPendingCreatedAt)', () => {
  it('reports once pending ops have been observed for >=24h while online', async () => {
    const engine = makeEngine({ getPendingPushCount: jest.fn(() => 5) });

    // First observation: pending appears, no non-fatal yet (age 0h).
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    expect(mockRecordError).not.toHaveBeenCalled();

    // Same pending count, still present 24h later while online -> reports.
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: true,
      now: () => T0 + PENDING_STALE_HOURS * 60 * 60 * 1000,
    });
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(1);
    const [, context] = mockRecordError.mock.calls[0] as [Error, Record<string, unknown>];
    expect(context).toEqual({ kind: 'pending_stale', count: 5, oldestPendingH: 24 });
    expect(Object.keys(context).sort()).toEqual(['count', 'kind', 'oldestPendingH']);
  });

  it('never fires while offline, even after 24h', async () => {
    const engine = makeEngine({ getPendingPushCount: jest.fn(() => 5) });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: false, now: () => T0 });
    await flush();
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: false,
      now: () => T0 + PENDING_STALE_HOURS * 60 * 60 * 1000 + 1,
    });
    await flush();

    expect(mockRecordError).not.toHaveBeenCalled();
  });

  it('recovers (clears the tracked age) once the pending count returns to zero', async () => {
    const engine = makeEngine({ getPendingPushCount: jest.fn(() => 5) });
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: true,
      now: () => T0 + PENDING_STALE_HOURS * 60 * 60 * 1000,
    });
    await flush();
    expect(mockRecordError).toHaveBeenCalledTimes(1);

    (engine.getPendingPushCount as jest.Mock).mockReturnValue(0);
    evaluateSyncHealth({
      engine,
      householdId: HH,
      isOnline: true,
      now: () => T0 + PENDING_STALE_HOURS * 60 * 60 * 1000 + 1000,
    });
    await flush();

    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('recovered'));
    expect(removeItem).toHaveBeenCalledWith('@sync_health:pending_first_seen');
  });
});

describe('custom keys', () => {
  it('are set on every evaluation regardless of whether anything is reported', async () => {
    const engine = makeEngine();
    evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 });
    await flush();

    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_pull_blocked', 'false');
    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_dlq_count', '0');
    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_pending_count', '0');
    expect(mockCrashlyticsInstance.setAttribute).toHaveBeenCalledWith('sync_oldest_pending_h', '0');
    expect(mockRecordError).not.toHaveBeenCalled();
  });
});

describe('safety', () => {
  it('never throws or propagates when the engine throws', async () => {
    const engine: SyncHealthEngine = {
      getPullHealth: jest.fn(() => {
        throw new Error('engine broke');
      }),
      listDeadLettered: jest.fn(() => {
        throw new Error('engine broke too');
      }),
      getPendingPushCount: jest.fn(() => {
        throw new Error('and again');
      }),
    };

    expect(() =>
      evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 }),
    ).not.toThrow();
    await flush();

    expect(mockWarn).toHaveBeenCalled();
  });

  it('never throws or propagates when AsyncStorage rejects', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'));
    setItem.mockRejectedValue(new Error('disk full'));
    removeItem.mockRejectedValue(new Error('disk full'));
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });

    expect(() =>
      evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 }),
    ).not.toThrow();
    await flush();
    await flush();

    // Reporting still happens even though the dedupe read/write failed.
    expect(mockRecordError).toHaveBeenCalledTimes(1);
  });

  it('never throws or propagates when Crashlytics recordError/setAttribute throw', async () => {
    mockRecordError.mockImplementation(() => {
      throw new Error('crashlytics unavailable');
    });
    mockCrashlyticsInstance.setAttribute.mockImplementation(() => {
      throw new Error('crashlytics unavailable');
    });
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });

    expect(() =>
      evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 }),
    ).not.toThrow();
    await flush();

    expect(mockWarn).toHaveBeenCalled();
  });

  it('is a silent no-op when Crashlytics itself is unavailable (throws on access)', async () => {
    const crashlyticsModule = jest.requireMock('@react-native-firebase/crashlytics') as {
      default: jest.Mock;
    };
    crashlyticsModule.default.mockImplementation(() => {
      throw new Error('No Firebase App');
    });
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-1'], error: 'boom' })),
    });

    expect(() =>
      evaluateSyncHealth({ engine, householdId: HH, isOnline: true, now: () => T0 }),
    ).not.toThrow();
    await flush();

    // The non-fatal path (via the existing `recordError` wrapper) is
    // untouched by this — only the direct custom-key path is affected.
    expect(mockRecordError).toHaveBeenCalledTimes(1);
  });
});

describe('withSyncHealthReporting', () => {
  function makeBaseSink(): SyncStatusSink & Record<string, jest.Mock> {
    return {
      setSyncing: jest.fn(),
      setLastSyncedAt: jest.fn(),
      setPendingCount: jest.fn(),
      setError: jest.fn(),
      setPullBlocked: jest.fn(),
    };
  }

  it('always calls the base sink first, unchanged', () => {
    const base = makeBaseSink();
    const engine = makeEngine();
    const wrapped = withSyncHealthReporting(base, {
      engine,
      getHouseholdId: () => HH,
      isOnline: () => true,
    });

    wrapped.setSyncing(true);
    wrapped.setPendingCount(3);
    wrapped.setPullBlocked(true);

    expect(base.setSyncing).toHaveBeenCalledWith(true);
    expect(base.setPendingCount).toHaveBeenCalledWith(3);
    expect(base.setPullBlocked).toHaveBeenCalledWith(true);
  });

  it('triggers a sync-health evaluation via setPullBlocked — proving the blocked case reaches the reporter', async () => {
    const base = makeBaseSink();
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-9'], error: 'poison batch' })),
    });
    const wrapped = withSyncHealthReporting(base, {
      engine,
      getHouseholdId: () => HH,
      isOnline: () => true,
    });

    // This is exactly what SyncScheduler.runSyncRound's `finally` does via
    // `refreshDiagnostics` after EVERY attempt, blocked pulls included —
    // see SyncScheduler.ts's `refreshDiagnostics`/`runSyncRound`.
    wrapped.setPullBlocked(true);
    await flush();

    expect(mockRecordError).toHaveBeenCalledTimes(1);
    const [, context] = mockRecordError.mock.calls[0] as [Error, Record<string, unknown>];
    expect(context).toEqual({ kind: 'pull_blocked', opIds: 'op-9', error: 'poison batch' });
  });

  it('is a no-op when there is no active household yet', async () => {
    const base = makeBaseSink();
    const engine = makeEngine({
      getPullHealth: jest.fn(() => ({ blocked: true, opIds: ['op-9'], error: 'boom' })),
    });
    const wrapped = withSyncHealthReporting(base, {
      engine,
      getHouseholdId: () => null,
      isOnline: () => true,
    });

    wrapped.setPullBlocked(true);
    await flush();

    expect(mockRecordError).not.toHaveBeenCalled();
  });
});

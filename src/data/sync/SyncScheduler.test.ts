/**
 * SyncScheduler — trigger/orchestration layer tests (app tier).
 *
 * Mocks AppState (established pattern — see useBabySteps.test.ts), the
 * UnitOfWork write-notifier (`onOplogWrite`), and a fake supabase client's
 * `.channel().on().subscribe()` chain, plus a fake `SyncRunner`/
 * `ReconnectSource` — no real SQLite/network needed to prove the scheduler
 * itself wires triggers correctly. The producer side of the after-write
 * trigger (`runInUnitOfWork` notifying `onOplogWrite` only after a real
 * commit) is proven separately against real SQLite in
 * tests/realsql/unitOfWork.test.ts. The production SyncEngine is exercised
 * end-to-end by the two-device convergence tier.
 */

// ─── AppState mock (spec §AppState mocking pattern, per useBabySteps.test.ts) ──
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
      if (event === 'change') {
        mockAppStateStore.listeners.push(listener);
      }
      return { remove: mockAppStateStore.removeListener };
    },
  },
}));

function fireAppStateChange(next: string): void {
  mockAppStateStore.listeners.forEach((l) => l(next));
}

// ─── UnitOfWork write-notifier mock — captures the listener SyncScheduler
// registers so a test can simulate "a write just committed" without a real DB. ──
let capturedWriteListener: ((householdId: string) => void) | null = null;
const mockUnsubscribeWrite = jest.fn();

jest.mock('../uow/UnitOfWork', () => ({
  onOplogWrite: jest.fn((listener: (householdId: string) => void) => {
    capturedWriteListener = listener;
    return mockUnsubscribeWrite;
  }),
}));

jest.mock('../../infrastructure/logging/Logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { SyncScheduler, type SyncRunner, type ReconnectSource } from './SyncScheduler';
import { onOplogWrite } from '../uow/UnitOfWork';
import { logger } from '../../infrastructure/logging/Logger';

const HH = 'hh-1';

/** Fake postgres_changes channel matching the subset of the real
 * `RealtimeChannel` API SyncScheduler drives. */
class FakeChannel {
  onCallback: (() => void) | null = null;
  subscribeCallback: ((status: string, err?: Error) => void) | null = null;
  unsubscribed = false;

  on(_type: string, _filter: unknown, callback: () => void): this {
    this.onCallback = callback;
    return this;
  }

  subscribe(callback?: (status: string, err?: Error) => void): this {
    this.subscribeCallback = callback ?? null;
    return this;
  }
}

function makeSupabase(channel: FakeChannel): {
  channel: jest.Mock;
  removeChannel: jest.Mock;
} {
  return {
    channel: jest.fn(() => channel),
    removeChannel: jest.fn().mockResolvedValue('ok'),
  };
}

function makeEngine(overrides: Partial<SyncRunner> = {}): jest.Mocked<SyncRunner> {
  return {
    sync: jest.fn().mockResolvedValue(undefined),
    getPullHealth: jest.fn().mockReturnValue({ blocked: false }),
    getPendingPushCount: jest.fn().mockReturnValue(0),
    ...overrides,
  } as jest.Mocked<SyncRunner>;
}

function makeReconnectSource(): ReconnectSource & { fire: () => Promise<void> } {
  let cb: (() => Promise<void>) | null = null;
  return {
    onConnected: (callback) => {
      cb = callback;
    },
    fire: async () => {
      if (cb) await cb();
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SyncScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAppStateStore.currentState = 'active';
    mockAppStateStore.listeners = [];
    capturedWriteListener = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('after-write trigger (debounced)', () => {
    it('a burst of rapid after-write notifications collapses into ONE sync() call', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);

      expect(onOplogWrite).toHaveBeenCalledTimes(1);
      expect(capturedWriteListener).not.toBeNull();

      // 5 rapid "writes just committed" notifications, each 50ms apart —
      // well within the 400ms debounce window.
      for (let i = 0; i < 5; i += 1) {
        capturedWriteListener!(HH);
        jest.advanceTimersByTime(50);
      }
      expect(engine.sync).not.toHaveBeenCalled();

      // Let the debounce window elapse from the LAST notification.
      jest.advanceTimersByTime(400);
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);
      expect(engine.sync).toHaveBeenCalledWith(HH);
    });

    it('uses the household id the write actually touched, not necessarily the bound one', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);

      capturedWriteListener!('hh-other');
      jest.advanceTimersByTime(400);
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledWith('hh-other');
    });
  });

  describe('AppState foreground trigger', () => {
    it('transitioning to active syncs immediately (no debounce wait)', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);

      fireAppStateChange('active');
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);
      expect(engine.sync).toHaveBeenCalledWith(HH);
    });

    it('transitioning to background does not sync', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      scheduler.start(HH);

      fireAppStateChange('background');
      await flushMicrotasks();

      expect(engine.sync).not.toHaveBeenCalled();
    });
  });

  describe('NetInfo reconnect trigger', () => {
    it('a reconnect event syncs immediately', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const reconnect = makeReconnectSource();
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: reconnect,
      });
      scheduler.start(HH);

      await reconnect.fire();
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);
      expect(engine.sync).toHaveBeenCalledWith(HH);
    });
  });

  describe('Realtime nudge trigger', () => {
    it('a postgres_changes INSERT event debounces a requestSync (nudge, not immediate)', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);

      expect(supabase.channel).toHaveBeenCalledWith(`oplog:${HH}`);
      expect(channel.onCallback).not.toBeNull();

      channel.onCallback!();
      // Debounced, like after-write — not immediate.
      expect(engine.sync).not.toHaveBeenCalled();

      jest.advanceTimersByTime(400);
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);
      expect(engine.sync).toHaveBeenCalledWith(HH);
    });

    it('subscribing does not throw and requests the correct RLS-scoped filter', () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const onSpy = jest.spyOn(channel, 'on');
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });

      expect(() => scheduler.start(HH)).not.toThrow();

      expect(onSpy).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({
          event: 'INSERT',
          schema: 'public',
          table: 'oplog',
          filter: `household_id=eq.${HH}`,
        }),
        expect.any(Function),
      );
    });
  });

  describe('Realtime is a NUDGE ONLY — never the sole trigger (spec §6.7)', () => {
    it('when the realtime channel never reaches SUBSCRIBED (down/erroring), foreground still syncs', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      scheduler.start(HH);

      // Simulate the realtime nudge being permanently down: subscribe never
      // reports SUBSCRIBED, and the postgres_changes callback never fires —
      // the channel's own subscribe callback reports an error instead.
      channel.subscribeCallback?.('CHANNEL_ERROR', new Error('connection refused'));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('realtime nudge channel not subscribed'),
        expect.objectContaining({ householdId: HH, status: 'CHANNEL_ERROR' }),
      );

      // The nudge is down and NEVER fires — but foreground still triggers sync.
      fireAppStateChange('active');
      await flushMicrotasks();
      expect(engine.sync).toHaveBeenCalledTimes(1);
      expect(engine.sync).toHaveBeenCalledWith(HH);
    });

    it('when the realtime channel never reaches SUBSCRIBED, reconnect still syncs', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const reconnect = makeReconnectSource();
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: reconnect,
      });
      scheduler.start(HH);
      channel.subscribeCallback?.('TIMED_OUT');

      await reconnect.fire();
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);
    });

    it('when the realtime channel never reaches SUBSCRIBED, after-write still syncs (debounced)', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);
      channel.subscribeCallback?.('CLOSED');

      capturedWriteListener!(HH);
      jest.advanceTimersByTime(400);
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('syncStore status sink integration', () => {
    it('reports syncing/lastSyncedAt/pendingCount/error/pullBlocked across a full cycle', async () => {
      const engine = makeEngine({
        getPendingPushCount: jest.fn().mockReturnValue(2),
        getPullHealth: jest.fn().mockReturnValue({ blocked: false }),
      });
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const sink = {
        setSyncing: jest.fn(),
        setLastSyncedAt: jest.fn(),
        setPendingCount: jest.fn(),
        setError: jest.fn(),
        setPullBlocked: jest.fn(),
      };
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        statusSink: sink,
        clock: () => '2026-07-04T06:00:00.000Z',
      });
      scheduler.start(HH);
      sink.setSyncing.mockClear(); // clear the (started) diagnostics refresh call, if any

      fireAppStateChange('active');
      await flushMicrotasks();

      expect(sink.setSyncing).toHaveBeenNthCalledWith(1, true);
      expect(sink.setError).toHaveBeenCalledWith(null);
      expect(sink.setLastSyncedAt).toHaveBeenCalledWith('2026-07-04T06:00:00.000Z');
      expect(sink.setSyncing).toHaveBeenNthCalledWith(2, false);
      expect(sink.setPendingCount).toHaveBeenCalledWith(2);
      expect(sink.setPullBlocked).toHaveBeenCalledWith(false);
    });

    it('reports setError with the failure message when sync() rejects, and still refreshes diagnostics', async () => {
      const engine = makeEngine({
        sync: jest.fn().mockRejectedValue(new Error('sync_push failed: network error')),
        getPendingPushCount: jest.fn().mockReturnValue(5),
        getPullHealth: jest.fn().mockReturnValue({ blocked: true }),
      });
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const sink = {
        setSyncing: jest.fn(),
        setLastSyncedAt: jest.fn(),
        setPendingCount: jest.fn(),
        setError: jest.fn(),
        setPullBlocked: jest.fn(),
      };
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        statusSink: sink,
      });
      scheduler.start(HH);

      fireAppStateChange('active');
      await flushMicrotasks();

      expect(sink.setError).toHaveBeenCalledWith('sync_push failed: network error');
      expect(sink.setLastSyncedAt).not.toHaveBeenCalled();
      expect(sink.setSyncing).toHaveBeenCalledWith(false);
      expect(sink.setPendingCount).toHaveBeenCalledWith(5);
      expect(sink.setPullBlocked).toHaveBeenCalledWith(true);
    });
  });

  describe('onSyncSuccess hook (Task 6 — EMF reconcile re-wiring)', () => {
    it('runs onSyncSuccess with the synced householdId after a successful round', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const onSyncSuccess = jest.fn().mockResolvedValue(undefined);
      const scheduler = new SyncScheduler({
        engine,
        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        onSyncSuccess,
      });
      scheduler.start(HH);

      fireAppStateChange('active');
      await flushMicrotasks();

      expect(onSyncSuccess).toHaveBeenCalledWith(HH);
    });

    it('does not run onSyncSuccess when sync() rejects', async () => {
      const engine = makeEngine({ sync: jest.fn().mockRejectedValue(new Error('boom')) });
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const onSyncSuccess = jest.fn().mockResolvedValue(undefined);
      const scheduler = new SyncScheduler({
        engine,
        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        onSyncSuccess,
      });
      scheduler.start(HH);

      fireAppStateChange('active');
      await flushMicrotasks();

      expect(onSyncSuccess).not.toHaveBeenCalled();
    });

    it('a throwing/rejecting onSyncSuccess is logged and swallowed — never fails the round or the scheduler', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const sink = {
        setSyncing: jest.fn(),
        setLastSyncedAt: jest.fn(),
        setPendingCount: jest.fn(),
        setError: jest.fn(),
        setPullBlocked: jest.fn(),
      };
      const onSyncSuccess = jest.fn().mockRejectedValue(new Error('reconcile blew up'));
      const scheduler = new SyncScheduler({
        engine,
        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        statusSink: sink,
        onSyncSuccess,
      });
      scheduler.start(HH);

      fireAppStateChange('active');
      await flushMicrotasks();

      expect(onSyncSuccess).toHaveBeenCalledWith(HH);
      // The round itself is still reported as a success — the hook failure
      // must never leak into the sync outcome.
      expect(sink.setError).toHaveBeenCalledWith(null);
      expect(logger.warn).toHaveBeenCalledWith(
        'SyncScheduler: onSyncSuccess hook failed',
        expect.objectContaining({ householdId: HH, error: 'reconcile blew up' }),
      );
    });

    it('is optional — a scheduler without onSyncSuccess syncs normally', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,
        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      scheduler.start(HH);

      fireAppStateChange('active');
      await expect(flushMicrotasks()).resolves.not.toThrow();
      expect(engine.sync).toHaveBeenCalledWith(HH);
    });
  });

  describe('start/stop lifecycle', () => {
    it('start() is idempotent — a second call does not re-subscribe', () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      scheduler.start(HH);
      scheduler.start(HH);

      expect(onOplogWrite).toHaveBeenCalledTimes(1);
      expect(supabase.channel).toHaveBeenCalledTimes(1);
      expect(scheduler.isStarted).toBe(true);
    });

    it('stop() unsubscribes the write listener, AppState, and removes the realtime channel', () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      scheduler.start(HH);
      scheduler.stop();

      expect(mockUnsubscribeWrite).toHaveBeenCalledTimes(1);
      expect(mockAppStateStore.removeListener).toHaveBeenCalledTimes(1);
      expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
      expect(scheduler.isStarted).toBe(false);
    });

    it('stop() before start() is a safe no-op', () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      expect(() => scheduler.stop()).not.toThrow();
    });

    it('a pending debounce timer is cleared on stop() — no sync fires after', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);
      capturedWriteListener!(HH);
      scheduler.stop();

      jest.advanceTimersByTime(1000);
      await flushMicrotasks();

      expect(engine.sync).not.toHaveBeenCalled();
    });

    it('rebinding to a new household after stop()/start() wires the new household everywhere', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const reconnect = makeReconnectSource();
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: reconnect,
      });
      scheduler.start(HH);
      scheduler.stop();

      const channel2 = new FakeChannel();
      supabase.channel.mockReturnValue(channel2);
      const reconnect2 = makeReconnectSource();
      const scheduler2 = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: reconnect2,
      });
      scheduler2.start('hh-2');

      await reconnect2.fire();
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledWith('hh-2');
      expect(supabase.channel).toHaveBeenLastCalledWith('oplog:hh-2');
    });
  });

  describe('requestSync', () => {
    it('immediate: true bypasses the debounce entirely, even mid-window', async () => {
      const engine = makeEngine();
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,

        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        debounceMs: 400,
      });
      scheduler.start(HH);

      scheduler.requestSync(HH); // debounced, pending
      scheduler.requestSync(HH, { immediate: true }); // fires now, cancels the pending debounce
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1);

      // The cancelled debounced call must not ALSO fire later.
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
      expect(engine.sync).toHaveBeenCalledTimes(1);
    });
  });

  describe('re-entrancy guard (Task 4 review minor, closed in Task 5)', () => {
    it('an overlapping immediate trigger while a round is in flight skips instead of double-driving statusSink', async () => {
      let resolveSync: (() => void) | null = null;
      const engine = makeEngine({
        sync: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveSync = resolve;
            }),
        ),
      });
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const sink = {
        setSyncing: jest.fn(),
        setLastSyncedAt: jest.fn(),
        setPendingCount: jest.fn(),
        setError: jest.fn(),
        setPullBlocked: jest.fn(),
      };
      const scheduler = new SyncScheduler({
        engine,
        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
        statusSink: sink,
      });
      scheduler.start(HH);
      sink.setSyncing.mockClear();

      // First immediate trigger starts a round that never resolves until we
      // release it below.
      scheduler.requestSync(HH, { immediate: true });
      await flushMicrotasks();
      expect(engine.sync).toHaveBeenCalledTimes(1);
      expect(sink.setSyncing).toHaveBeenCalledTimes(1);
      expect(sink.setSyncing).toHaveBeenLastCalledWith(true);

      // A second immediate trigger arrives WHILE the first is still in
      // flight (e.g. reconnect firing during a foreground-triggered round).
      // Without the re-entrancy guard this would call engine.sync() again
      // AND call setSyncing(true) then (once IT resolves) setSyncing(false)
      // independently of the first round's own lifecycle.
      scheduler.requestSync(HH, { immediate: true });
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(1); // NOT called a second time
      expect(sink.setSyncing).toHaveBeenCalledTimes(1); // still only the one true
      expect(logger.warn).not.toHaveBeenCalled();

      // Releasing the original round completes normally and resets the guard.
      resolveSync!();
      await flushMicrotasks();
      expect(sink.setSyncing).toHaveBeenLastCalledWith(false);

      // A THIRD trigger after the round finished is a normal, un-skipped call.
      scheduler.requestSync(HH, { immediate: true });
      await flushMicrotasks();
      expect(engine.sync).toHaveBeenCalledTimes(2);
    });

    it('stop() resets the guard so a subsequent start() is never spuriously skipped', async () => {
      let resolveSync: (() => void) | null = null;
      const engine = makeEngine({
        sync: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveSync = resolve;
            }),
        ),
      });
      const channel = new FakeChannel();
      const supabase = makeSupabase(channel);
      const scheduler = new SyncScheduler({
        engine,
        supabase: supabase as any,
        networkObserver: makeReconnectSource(),
      });
      scheduler.start(HH);
      scheduler.requestSync(HH, { immediate: true });
      await flushMicrotasks();
      expect(engine.sync).toHaveBeenCalledTimes(1);

      // Household switch: stop while the round is STILL unresolved, then
      // immediately start + requestSync for the new household.
      scheduler.stop();
      scheduler.start('hh-2');
      scheduler.requestSync('hh-2', { immediate: true });
      await flushMicrotasks();

      expect(engine.sync).toHaveBeenCalledTimes(2);
      expect(engine.sync).toHaveBeenLastCalledWith('hh-2');

      resolveSync!();
      await flushMicrotasks();
    });
  });
});

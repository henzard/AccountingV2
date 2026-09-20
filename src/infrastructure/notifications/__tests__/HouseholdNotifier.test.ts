jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
}));

jest.mock('../../logging/Logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

// The module under test also builds a default singleton (`householdNotifier`)
// off the real supabase/db modules — neither is available in a unit test
// environment (supabaseClient throws without app.config extra; db opens a
// real sqlite file), so both are stubbed the same way FcmTokenRegistrar's
// test stubs supabaseClient.
jest.mock('../../../data/remote/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../data/local/db', () => ({ db: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

import NetInfo from '@react-native-community/netinfo';
import { HouseholdNotifier } from '../HouseholdNotifier';
import { logger } from '../../logging/Logger';
import type { HouseholdNotificationEvent } from '../../../domain/ports/IHouseholdNotifier';

/** Mirrors HouseholdNotifier's own DEBOUNCE_MS. */
const DEBOUNCE_MS = 5_000;

const mockNetInfoFetch = NetInfo.fetch as jest.Mock;
const mockLoggerWarn = logger.warn as jest.Mock;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeFakeDb(memberRows: Array<{ userId: string }>) {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(memberRows),
      }),
    }),
  } as any;
}

function makeFakeSupabase(invokeImpl?: (name: string, args: unknown) => Promise<unknown>) {
  return {
    functions: {
      invoke: jest.fn(invokeImpl ?? (() => Promise.resolve({ data: { sent: 1 }, error: null }))),
    },
  } as any;
}

function makePrefsRepo(householdActivityEnabled = true) {
  return { load: jest.fn().mockResolvedValue({ householdActivityEnabled }) } as any;
}

const baseEvent: HouseholdNotificationEvent = {
  kind: 'transaction_created',
  householdId: 'h1',
  senderId: 'u1',
  amountCents: 12_345,
  envelopeName: 'Groceries',
};

describe('HouseholdNotifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  });

  it('invokes notify-event once with the typed event shape', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('notify-event', {
      body: {
        householdId: 'h1',
        event: { kind: 'transaction_created', amountCents: 12_345, envelopeName: 'Groceries' },
      },
    });
  });

  it('REG-15: sends ONE request for a 3-member household, not one per recipient', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    // The server resolves the recipients; the client never addresses one, so
    // a bigger household no longer costs a bigger slice of the hourly budget.
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
    const body = supabase.functions.invoke.mock.calls[0][1].body;
    expect(body).not.toHaveProperty('userId');
  });

  it('SEC2-12: never sends a caller-authored title or body', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    const body = supabase.functions.invoke.mock.calls[0][1].body;
    expect(body).not.toHaveProperty('title');
    expect(body).not.toHaveProperty('body');
    expect(body.event).not.toHaveProperty('title');
    expect(body.event).not.toHaveProperty('body');
  });

  it('projects each event kind onto its own typed field set', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    let now = 1_000;
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => now,
    });

    notifier.notifyHousehold({
      kind: 'envelope_over_budget',
      householdId: 'h1',
      senderId: 'u1',
      envelopeName: 'Groceries',
      overByCents: 500,
    });
    now += DEBOUNCE_MS;
    notifier.notifyHousehold({
      kind: 'slip_confirmed',
      householdId: 'h1',
      senderId: 'u1',
      itemCount: 3,
      merchant: 'Checkers',
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke.mock.calls.map((c: any[]) => c[1].body.event)).toEqual([
      { kind: 'envelope_over_budget', envelopeName: 'Groceries', overByCents: 500 },
      { kind: 'slip_confirmed', itemCount: 3, merchant: 'Checkers' },
    ]);
  });

  it('omits an empty optional free-text field and truncates an over-long one', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    let now = 1_000;
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => now,
    });

    notifier.notifyHousehold({ ...baseEvent, payee: '   ' });
    now += DEBOUNCE_MS;
    notifier.notifyHousehold({ ...baseEvent, payee: 'p'.repeat(80) });
    await flushMicrotasks();
    await flushMicrotasks();

    const events = supabase.functions.invoke.mock.calls.map((c: any[]) => c[1].body.event);
    expect(events[0]).not.toHaveProperty('payee');
    expect(events[1].payee).toBe('p'.repeat(60));
  });

  it('skips entirely when offline', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('skips when the household has only the sender as an active member', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('skips sending when householdActivityEnabled preference is off', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(false),
      now: () => 1_000,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('swallows a notify-event failure and logs it, never throwing', async () => {
    const supabase = makeFakeSupabase(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } }),
    );
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    expect(() => notifier.notifyHousehold(baseEvent)).not.toThrow();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it('swallows a thrown network error from functions.invoke', async () => {
    const supabase = makeFakeSupabase(() => Promise.reject(new Error('network down')));
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => 1_000,
    });

    expect(() => notifier.notifyHousehold(baseEvent)).not.toThrow();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it('debounces an identical event fired twice within the debounce window', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    let now = 1_000;
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => now,
    });

    notifier.notifyHousehold(baseEvent);
    now += 500; // well within the 5s debounce window
    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke).toHaveBeenCalledTimes(1);
  });

  it('prunes debounce entries older than the window so the map cannot grow forever', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    let now = 1_000;
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => now,
    });

    for (let i = 0; i < 25; i++) {
      notifier.notifyHousehold({ ...baseEvent, amountCents: 100 + i });
      now += DEBOUNCE_MS;
    }
    await flushMicrotasks();
    await flushMicrotasks();

    const map = (notifier as unknown as { lastSentAt: Map<string, number> }).lastSentAt;
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(25);
    // Only the most recent entry can still be inside the window.
    expect(map.size).toBe(1);
  });

  it('does not debounce the same event once the debounce window has passed', async () => {
    const supabase = makeFakeSupabase();
    const db = makeFakeDb([{ userId: 'u1' }, { userId: 'u2' }]);
    let now = 1_000;
    const notifier = new HouseholdNotifier({
      supabase,
      db,
      preferencesRepository: makePrefsRepo(),
      now: () => now,
    });

    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();
    now += 6_000; // past the 5s debounce window
    notifier.notifyHousehold(baseEvent);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });
});

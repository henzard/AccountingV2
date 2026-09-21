/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * eveningLogPrompt.rearmBudgetNudges.test.ts — VAL2-11 pull-back nudges.
 *
 * Runs `rearmBudgetNudges` against a REAL migrated better-sqlite3 database
 * (envelopes + transactions), so the money/count numbers it hands to the
 * pure `budgetNudgeMessages` builders come from a real query — only
 * `expo-notifications` and the two zustand stores (`appStore`,
 * `notificationStore`) are mocked, the same seam
 * LocalNotificationScheduler.test.ts uses for the notifications API.
 */
import type Database from 'better-sqlite3';

const HOUSEHOLD = 'hh-1';
const NOW = new Date(2026, 3, 13, 12, 0, 0, 0); // Monday 2026-04-13, local

let mockRawDb: Database.Database;

jest.mock('../../../data/local/db', () => {
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { openMigratedDb } = require('../../../../tests/realsql/harness/openMigratedDb');
  const schema = require('../../../data/local/schema');
  const raw = openMigratedDb();
  mockRawDb = raw;
  return { db: drizzle(raw, { schema }) };
});

const mockSchedule = jest.fn().mockResolvedValue('id');
const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockGetAllScheduled = jest.fn().mockResolvedValue([]);
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (req: unknown) => mockSchedule(req),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  cancelAllScheduledNotificationsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: () => mockGetAllScheduled(),
  SchedulableTriggerInputTypes: { DAILY: 'daily', MONTHLY: 'monthly', DATE: 'date' },
}));

let mockAppState = { householdId: HOUSEHOLD, paydayDay: 25 };
jest.mock('../../stores/appStore', () => ({
  useAppStore: { getState: () => mockAppState },
}));

let mockNotificationState = {
  preferences: {
    eveningLogPromptEnabled: true,
    eveningLogPromptHour: 19,
    eveningLogPromptMinute: 0,
    periodClosingNudgeEnabled: true,
    weeklyCheckInNudgeEnabled: true,
  },
  permissionsGranted: true,
};
jest.mock('../../stores/notificationStore', () => ({
  useNotificationStore: { getState: () => mockNotificationState },
}));

import { rearmBudgetNudges, internalHooks } from '../eveningLogPrompt';

function seedHousehold(raw: Database.Database, id: string): void {
  raw
    .prepare(
      `INSERT INTO households (id, name, payday_day, created_at, updated_at)
       VALUES (?, 'Test Household', 25, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(id);
}

function seedEnvelope(
  raw: Database.Database,
  args: { id: string; allocatedCents: number; periodStart: string },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'spending', 0, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(args.id, HOUSEHOLD, args.id, args.allocatedCents, args.periodStart);
}

/** An INCOME envelope — the shape imported salary deposits are booked against. */
function seedIncomeEnvelope(
  raw: Database.Database,
  args: { id: string; allocatedCents: number; periodStart: string },
): void {
  raw
    .prepare(
      `INSERT INTO envelopes
         (id, household_id, name, allocated_cents, envelope_type,
          is_savings_locked, is_archived, period_start, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'income', 0, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(args.id, HOUSEHOLD, args.id, args.allocatedCents, args.periodStart);
}

function seedTransaction(
  raw: Database.Database,
  args: { id: string; envelopeId: string; amountCents: number; transactionDate: string },
): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, household_id, envelope_id, amount_cents, description, transaction_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'test', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run(args.id, HOUSEHOLD, args.envelopeId, args.amountCents, args.transactionDate);
}

function scheduledIdentifiers(): string[] {
  return mockSchedule.mock.calls.map((c: [{ identifier: string }]) => c[0].identifier);
}

describe('rearmBudgetNudges (VAL2-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllScheduled.mockResolvedValue([]);
    mockRawDb.exec('DELETE FROM envelopes; DELETE FROM transactions; DELETE FROM households;');
    seedHousehold(mockRawDb, HOUSEHOLD);
    mockAppState = { householdId: HOUSEHOLD, paydayDay: 25 };
    mockNotificationState = {
      preferences: {
        eveningLogPromptEnabled: true,
        eveningLogPromptHour: 19,
        eveningLogPromptMinute: 0,
        periodClosingNudgeEnabled: true,
        weeklyCheckInNudgeEnabled: true,
      },
      permissionsGranted: true,
    };
  });

  afterAll(() => {
    mockRawDb.close();
  });

  it('schedules both nudges with copy built from real envelope/spend data', async () => {
    // Current period (payday 25th, "now" 2026-04-13) started 2026-03-25.
    seedEnvelope(mockRawDb, {
      id: 'env-groceries',
      allocatedCents: 50000,
      periodStart: '2026-03-25',
    });
    seedEnvelope(mockRawDb, { id: 'env-fun', allocatedCents: 20000, periodStart: '2026-03-25' });
    seedTransaction(mockRawDb, {
      id: 'txn-1',
      envelopeId: 'env-groceries',
      amountCents: 20000,
      transactionDate: '2026-04-12', // this week (Sunday 2026-04-12 -> Saturday)
    });

    await rearmBudgetNudges(() => NOW);

    expect(scheduledIdentifiers()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^period-closing-\d{4}-\d{2}-\d{2}$/),
        expect.stringMatching(/^weekly-checkin-\d{4}-\d{2}-\d{2}$/),
      ]),
    );

    const periodCall = mockSchedule.mock.calls.find((c) =>
      (c[0] as { identifier: string }).identifier.startsWith('period-closing-'),
    )?.[0] as { content: { title: string; body: string; data: { target: string } } };
    // 50000 - 20000 (Groceries) + 20000 (Fun money, untouched) = 50000 left.
    expect(periodCall.content.body).toBe('R500,00 left across 2 envelopes');
    expect(periodCall.content.data).toEqual({ target: 'dashboard' });

    const weeklyCall = mockSchedule.mock.calls.find((c) =>
      (c[0] as { identifier: string }).identifier.startsWith('weekly-checkin-'),
    )?.[0] as { content: { title: string; body: string; data: { target: string } } };
    expect(weeklyCall.content.body).toBe('This week: R200,00 spent, 2 envelopes on track');
    expect(weeklyCall.content.data).toEqual({ target: 'dashboard' });
  });

  it('does nothing when there is no household', async () => {
    mockAppState = { householdId: '', paydayDay: 25 };
    await rearmBudgetNudges(() => NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('does nothing when notification permission was never granted', async () => {
    mockNotificationState.permissionsGranted = false;
    await rearmBudgetNudges(() => NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  // Item 2 (round-3 review): a disabled nudge must be cancelled even when
  // the function returns early for missing household/permission — otherwise
  // a persisted opt-out leaves an old OS notification alive forever.
  it('cancels a disabled period-closing nudge even with no household (persisted opt-out must not survive)', async () => {
    mockGetAllScheduled.mockResolvedValue([{ identifier: 'period-closing-2026-03-30' }]);
    mockAppState = { householdId: '', paydayDay: 25 };
    mockNotificationState.preferences.periodClosingNudgeEnabled = false;

    await rearmBudgetNudges(() => NOW);

    expect(mockCancel).toHaveBeenCalledWith('period-closing-2026-03-30');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('cancels a disabled weekly check-in nudge even when permission was never granted', async () => {
    mockGetAllScheduled.mockResolvedValue([{ identifier: 'weekly-checkin-2026-04-12' }]);
    mockNotificationState.permissionsGranted = false;
    mockNotificationState.preferences.weeklyCheckInNudgeEnabled = false;

    await rearmBudgetNudges(() => NOW);

    expect(mockCancel).toHaveBeenCalledWith('weekly-checkin-2026-04-12');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  // Item 3 (round-3 review): preferences are re-read immediately before
  // scheduling, so a concurrent settings change landing DURING the awaited
  // DB work wins over the stale snapshot this call started with.
  it('re-reads preferences immediately before scheduling: a toggle-off during the DB work wins over the stale read', async () => {
    seedEnvelope(mockRawDb, {
      id: 'env-groceries',
      allocatedCents: 50000,
      periodStart: '2026-03-25',
    });
    const originalComputeWeekSpentCents = internalHooks.computeWeekSpentCents;
    internalHooks.computeWeekSpentCents = async (householdId, now) => {
      // Simulate a concurrent settings-screen toggle landing while this DB
      // call (which runs AFTER the initial preferences read, and BEFORE the
      // pre-schedule re-read) is still in flight.
      mockNotificationState.preferences.periodClosingNudgeEnabled = false;
      return originalComputeWeekSpentCents(householdId, now);
    };

    try {
      await rearmBudgetNudges(() => NOW);
    } finally {
      internalHooks.computeWeekSpentCents = originalComputeWeekSpentCents;
    }

    const ids = scheduledIdentifiers();
    // The stale ("enabled") snapshot would have scheduled this — the fresh
    // re-read must have won instead.
    expect(ids.some((id) => id.startsWith('period-closing-'))).toBe(false);
    // The untouched flag is unaffected.
    expect(ids.some((id) => id.startsWith('weekly-checkin-'))).toBe(true);
  });

  // Item 3 (round-3 review): concurrent invocations must never interleave.
  it('serialises concurrent rearmBudgetNudges calls so they run one at a time, in call order', async () => {
    seedEnvelope(mockRawDb, {
      id: 'env-groceries',
      allocatedCents: 50000,
      periodStart: '2026-03-25',
    });
    const order: string[] = [];
    const originalLoad = internalHooks.loadPeriodEnvelopeSnapshots;
    let releaseFirstCall: () => void = () => {};
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    let callCount = 0;
    internalHooks.loadPeriodEnvelopeSnapshots = async (householdId, periodStart) => {
      callCount += 1;
      const callIndex = callCount;
      order.push(`start-${callIndex}`);
      if (callIndex === 1) {
        await firstCallGate; // held open until the test explicitly releases it
      }
      const result = await originalLoad(householdId, periodStart);
      order.push(`end-${callIndex}`);
      return result;
    };

    try {
      const first = rearmBudgetNudges(() => NOW);
      const second = rearmBudgetNudges(() => NOW);

      // Give call 2 every chance to (incorrectly) start while call 1 is
      // still held open — if serialization were broken, this would flush
      // enough microtasks for its `loadPeriodEnvelopeSnapshots` to run too.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(order).toEqual(['start-1']);

      releaseFirstCall();
      await Promise.all([first, second]);

      expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    } finally {
      internalHooks.loadPeriodEnvelopeSnapshots = originalLoad;
    }
  });

  it('only schedules the period-closing nudge when the weekly check-in is disabled', async () => {
    mockNotificationState.preferences.weeklyCheckInNudgeEnabled = false;
    await rearmBudgetNudges(() => NOW);
    const ids = scheduledIdentifiers();
    expect(ids.some((id) => id.startsWith('period-closing-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('weekly-checkin-'))).toBe(false);
  });

  it('only schedules the weekly check-in when the period-closing nudge is disabled', async () => {
    mockNotificationState.preferences.periodClosingNudgeEnabled = false;
    await rearmBudgetNudges(() => NOW);
    const ids = scheduledIdentifiers();
    expect(ids.some((id) => id.startsWith('period-closing-'))).toBe(false);
    expect(ids.some((id) => id.startsWith('weekly-checkin-'))).toBe(true);
  });

  it('schedules neither nudge when both are disabled', async () => {
    mockNotificationState.preferences.periodClosingNudgeEnabled = false;
    mockNotificationState.preferences.weeklyCheckInNudgeEnabled = false;
    await rearmBudgetNudges(() => NOW);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  // MONEY IN vs MONEY OUT: imported history books salary deposits as
  // transactions against an `income` envelope. Without the envelope-type
  // filter in `computeWeekSpentCents`, payday week reported an entire
  // month's income as "spent" in a push notification.
  it('never counts a salary deposit on an income envelope as this week’s spend', async () => {
    seedEnvelope(mockRawDb, {
      id: 'env-groceries',
      allocatedCents: 50000,
      periodStart: '2026-03-25',
    });
    seedIncomeEnvelope(mockRawDb, {
      id: 'env-nedbank',
      allocatedCents: 3500000,
      periodStart: '2026-03-25',
    });
    seedTransaction(mockRawDb, {
      id: 'txn-food',
      envelopeId: 'env-groceries',
      amountCents: 20000,
      transactionDate: '2026-04-12',
    });
    seedTransaction(mockRawDb, {
      id: 'txn-salary',
      envelopeId: 'env-nedbank',
      amountCents: 3500000,
      transactionDate: '2026-04-12',
    });

    await rearmBudgetNudges(() => NOW);

    const weeklyCall = mockSchedule.mock.calls.find((c) =>
      (c[0] as { identifier: string }).identifier.startsWith('weekly-checkin-'),
    )?.[0] as { content: { body: string } };
    // R200,00 of groceries — NOT R35 200,00.
    expect(weeklyCall.content.body).toBe('This week: R200,00 spent, 1 envelope on track');
  });

  it('still nets a refund out of this week’s spend', async () => {
    seedEnvelope(mockRawDb, {
      id: 'env-groceries',
      allocatedCents: 50000,
      periodStart: '2026-03-25',
    });
    seedTransaction(mockRawDb, {
      id: 'txn-food',
      envelopeId: 'env-groceries',
      amountCents: 20000,
      transactionDate: '2026-04-12',
    });
    seedTransaction(mockRawDb, {
      id: 'txn-back',
      envelopeId: 'env-groceries',
      amountCents: -5000,
      transactionDate: '2026-04-13',
    });

    await rearmBudgetNudges(() => NOW);

    const weeklyCall = mockSchedule.mock.calls.find((c) =>
      (c[0] as { identifier: string }).identifier.startsWith('weekly-checkin-'),
    )?.[0] as { content: { body: string } };
    expect(weeklyCall.content.body).toBe('This week: R150,00 spent, 1 envelope on track');
  });
});

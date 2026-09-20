import { and, eq, isNull, ne } from 'drizzle-orm';
import { format, startOfWeek } from 'date-fns';
import { db } from '../../data/local/db';
import { envelopes, transactions } from '../../data/local/schema';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import {
  envelopeScopeCondition,
  getEnvelopeSpentCents,
} from '../../data/local/balances/EnvelopeBalanceQuery';
import { getEnvelopeScope } from '../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../../domain/envelopes/EnvelopeEntity';
import { BudgetPeriodEngine, formatPeriodDateKey } from '../../domain/shared/BudgetPeriodEngine';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { buildPeriodClosingMessage, buildWeeklyCheckInMessage } from './budgetNudgeMessages';
import type { PeriodEnvelopeSnapshot } from './budgetNudgeMessages';

// Lives outside RootNavigator so screens (AddTransactionScreen re-arms after a
// save) can import it without importing the navigator that renders them.

/**
 * VAL-12: cheap "did this household already log a transaction today?" check,
 * injected into the scheduler so `scheduleEveningLogPrompt` can skip/cancel
 * today's reminder instead of nagging a user who already logged. See the
 * caveat on `LocalNotificationScheduler`'s constructor doc — this only
 * re-evaluates whenever `RootNavigator`'s notification effect (re)runs, not
 * continuously through the day.
 */
export async function hasLoggedTransactionToday(householdId: string): Promise<boolean> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.transactionDate, today),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);
  return row != null;
}

/**
 * VAL2-1: tiny, standalone re-arm entry point for the evening-log rolling
 * window (see LocalNotificationScheduler.scheduleEveningLogPrompt). It has
 * to work from OUTSIDE any component's render — it's called here on
 * `AppState` becoming 'active', and MUST also run right after a transaction
 * is successfully saved (that call site, AddTransactionScreen.tsx, belongs
 * to another agent — see this change's final report for the one-line call
 * to add there). Reads current household + notification preferences
 * straight from the zustand stores' `getState()` rather than hooks, and is a
 * safe no-op whenever there's no household yet, the evening prompt isn't
 * enabled, or the OS permission was never granted — mirroring the guards
 * this navigator's own init effect already applies.
 */
export async function rearmEveningLogPrompt(): Promise<void> {
  const { householdId } = useAppStore.getState();
  if (!householdId) return;
  const { preferences, permissionsGranted } = useNotificationStore.getState();
  if (!permissionsGranted || !preferences.eveningLogPromptEnabled) return;

  const scheduler = new LocalNotificationScheduler({
    hasLoggedTransactionToday: () => hasLoggedTransactionToday(householdId),
  });
  await scheduler.scheduleEveningLogPrompt(
    preferences.eveningLogPromptHour,
    preferences.eveningLogPromptMinute,
  );
}

/**
 * VAL2-11: every PERIOD-scoped ('spending' | 'income' | 'utility') envelope
 * of `householdId` for `periodStart`, with its derived period-to-date spend
 * — the raw numbers `budgetNudgeMessages`'s pure builders turn into copy.
 * Persistent envelopes (funds) are excluded: they don't have a monthly
 * allocation to be "on track" against (see `getEnvelopeScope`).
 */
async function loadPeriodEnvelopeSnapshots(
  householdId: string,
  periodStart: string,
): Promise<PeriodEnvelopeSnapshot[]> {
  const rows = await db
    .select({
      id: envelopes.id,
      allocatedCents: envelopes.allocatedCents,
      envelopeType: envelopes.envelopeType,
    })
    .from(envelopes)
    .where(
      and(
        eq(envelopes.householdId, householdId),
        isNull(envelopes.deletedAt),
        envelopeScopeCondition(periodStart),
        eq(envelopes.isArchived, false),
        ne(envelopes.envelopeType, 'income'),
      ),
    );
  const periodRows = rows.filter(
    (row) => getEnvelopeScope({ envelopeType: row.envelopeType as EnvelopeType }) === 'period',
  );
  // No PERIOD envelope to report on — skip the (otherwise unconditional)
  // spend lookup entirely, same early-return shape `getEnvelopeSpentCents`
  // itself already uses for the equivalent empty case.
  if (periodRows.length === 0) return [];
  const spentByEnvelopeId = await getEnvelopeSpentCents(db, householdId, periodStart);
  return periodRows.map((row) => ({
    allocatedCents: row.allocatedCents,
    spentCents: spentByEnvelopeId.get(row.id) ?? 0,
  }));
}

/** VAL2-11: sum of `householdId`'s non-deleted transactions from the start of THIS week (Sunday) through `now`, inclusive. */
async function computeWeekSpentCents(householdId: string, now: Date): Promise<number> {
  const weekStart = format(startOfWeek(now), 'yyyy-MM-dd');
  const today = format(now, 'yyyy-MM-dd');
  const rows = await db
    .select({
      amountCents: transactions.amountCents,
      transactionDate: transactions.transactionDate,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  return rows
    .filter((row) => row.transactionDate >= weekStart && row.transactionDate <= today)
    .reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * Test-only override seam for the two DB-reading helpers `rearmBudgetNudges`
 * awaits. Production code always calls through this object unchanged — it
 * exists so a test can substitute one of these two functions (e.g. to inject
 * a concurrent state mutation mid-flight, or to hold one call open to prove
 * serialization) WITHOUT needing to mock the whole module: because
 * `rearmBudgetNudgesOnce` reads `internalHooks.loadPeriodEnvelopeSnapshots`/
 * `internalHooks.computeWeekSpentCents` as a property lookup at call time
 * (not a captured local binding), mutating a property on this shared object
 * from a test reaches the exact same call the production code makes — a
 * plain `jest.mock`/`jest.spyOn` on the named export cannot do this for a
 * same-module call under CommonJS/TS output, since the internal call site
 * resolves the bare identifier directly rather than going through
 * `exports.foo`.
 */
export const internalHooks = {
  loadPeriodEnvelopeSnapshots,
  computeWeekSpentCents,
};

/**
 * Round-3 review fix (items 2+3): every call to `rearmBudgetNudges` is
 * funneled through this one in-module promise chain so overlapping
 * invocations — RootNavigator's init effect, its `AppState` 'active'
 * handler, and AddTransactionScreen's post-save call can all fire close
 * together — run ONE AT A TIME, in call order, rather than interleaving
 * their DB reads and scheduler writes. Without this, two concurrent calls
 * racing through their own `await`s could apply their cancel/schedule
 * writes out of order, with the OLDER call's (now-stale) result landing
 * last and silently undoing the newer one's.
 *
 * `.then(ok, ok)` keeps the queue itself always resolved (never rejected),
 * so one call throwing never wedges every later call behind a permanently
 * rejected promise; each call's OWN returned promise still rejects/resolves
 * on its own outcome for its caller.
 */
let budgetNudgeQueue: Promise<void> = Promise.resolve();

/**
 * VAL2-11: standalone re-arm entry point for the two "pull-back" nudges —
 * "payday countdown" (3 days before the current period ends) and "weekly
 * check-in" (next Sunday) — both at the user's evening-prompt time. Mirrors
 * `rearmEveningLogPrompt`'s shape exactly: called from RootNavigator's init
 * effect and its `AppState` 'active' handler, and after a transaction is
 * successfully saved (AddTransactionScreen.tsx — both create AND edit, since
 * either can change the numbers these nudges report).
 *
 * Each nudge's copy is computed HERE, at schedule time, from local
 * envelope/spend data via the pure builders in `budgetNudgeMessages` — the
 * scheduler itself never touches presentation code or domain data, it only
 * schedules the pre-built strings it's handed (see
 * `LocalNotificationScheduler.schedulePeriodClosingNudge`/`scheduleWeeklyCheckIn`).
 *
 * `now` is injectable for tests; defaults to `new Date()`.
 */
export function rearmBudgetNudges(now: () => Date = () => new Date()): Promise<void> {
  const run = budgetNudgeQueue.then(
    () => rearmBudgetNudgesOnce(now),
    () => rearmBudgetNudgesOnce(now),
  );
  // Keep the queue itself resolved regardless of how `run` settles — see the
  // doc comment above.
  budgetNudgeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function rearmBudgetNudgesOnce(now: () => Date): Promise<void> {
  const scheduler = new LocalNotificationScheduler({ now });

  // Item 2 (round-3 review): cancelling a DISABLED nudge needs no household
  // and no OS permission — an opt-out (or a household going away) must
  // always clear any previously-scheduled occurrence, so this runs BEFORE
  // the early returns below that only concern DATA availability. Without
  // this, toggling a nudge off while offline/signed-out, or while
  // permission was never granted, left the old OS-level notification alive
  // forever (the function returned before ever reaching a cancel call).
  const startPreferences = useNotificationStore.getState().preferences;
  if (!startPreferences.periodClosingNudgeEnabled) {
    await scheduler.cancelPeriodClosingNudge();
  }
  if (!startPreferences.weeklyCheckInNudgeEnabled) {
    await scheduler.cancelWeeklyCheckIn();
  }

  const { householdId, paydayDay } = useAppStore.getState();
  if (!householdId) return;
  if (!useNotificationStore.getState().permissionsGranted) return;

  const engine = new BudgetPeriodEngine();
  const period = engine.getCurrentPeriod(paydayDay, now());
  const periodStart = formatPeriodDateKey(period.startDate);
  // Both awaited unconditionally (regardless of which nudge is currently
  // enabled): a preference flipped ON during THIS await (see the re-read
  // below) must still have its numbers ready to schedule with.
  const envelopeSnapshots = await internalHooks.loadPeriodEnvelopeSnapshots(
    householdId,
    periodStart,
  );
  const weekSpentCents = await internalHooks.computeWeekSpentCents(householdId, now());

  // Item 3 (round-3 review): re-read preferences NOW, immediately before
  // scheduling — the DB work just awaited above is a real gap in which a
  // concurrent settings change (the user toggling a nudge off, which calls
  // the scheduler's cancel directly) could otherwise be undone by this
  // call's now-stale `startPreferences` snapshot re-scheduling it.
  const currentPreferences = useNotificationStore.getState().preferences;

  if (currentPreferences.periodClosingNudgeEnabled) {
    const message = buildPeriodClosingMessage(envelopeSnapshots);
    await scheduler.schedulePeriodClosingNudge(
      period.endDate,
      currentPreferences.eveningLogPromptHour,
      currentPreferences.eveningLogPromptMinute,
      message,
    );
  } else {
    await scheduler.cancelPeriodClosingNudge();
  }
  if (currentPreferences.weeklyCheckInNudgeEnabled) {
    const message = buildWeeklyCheckInMessage(envelopeSnapshots, weekSpentCents);
    await scheduler.scheduleWeeklyCheckIn(
      currentPreferences.eveningLogPromptHour,
      currentPreferences.eveningLogPromptMinute,
      message,
    );
  } else {
    await scheduler.cancelWeeklyCheckIn();
  }
}

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
 * VAL2-11: standalone re-arm entry point for the two "pull-back" nudges —
 * "payday countdown" (3 days before the current period ends) and "weekly
 * check-in" (next Sunday) — both at the user's evening-prompt time. Mirrors
 * `rearmEveningLogPrompt`'s shape exactly: called from RootNavigator's init
 * effect and its `AppState` 'active' handler, and MUST also run right after
 * a transaction is successfully saved (that call site, AddTransactionScreen.tsx,
 * belongs to another agent this round — see this change's final report for
 * the one-line call to add there, alongside the existing
 * `rearmEveningLogPrompt` call).
 *
 * Each nudge's copy is computed HERE, at schedule time, from local
 * envelope/spend data via the pure builders in `budgetNudgeMessages` — the
 * scheduler itself never touches presentation code or domain data, it only
 * schedules the pre-built strings it's handed (see
 * `LocalNotificationScheduler.schedulePeriodClosingNudge`/`scheduleWeeklyCheckIn`).
 *
 * `now` is injectable for tests; defaults to `new Date()`.
 */
export async function rearmBudgetNudges(now: () => Date = () => new Date()): Promise<void> {
  const { householdId, paydayDay } = useAppStore.getState();
  if (!householdId) return;
  const { preferences, permissionsGranted } = useNotificationStore.getState();
  if (!permissionsGranted) return;
  if (!preferences.periodClosingNudgeEnabled && !preferences.weeklyCheckInNudgeEnabled) return;

  const engine = new BudgetPeriodEngine();
  const period = engine.getCurrentPeriod(paydayDay, now());
  const periodStart = formatPeriodDateKey(period.startDate);
  const envelopeSnapshots = await loadPeriodEnvelopeSnapshots(householdId, periodStart);

  const scheduler = new LocalNotificationScheduler({ now });

  if (preferences.periodClosingNudgeEnabled) {
    const message = buildPeriodClosingMessage(envelopeSnapshots);
    await scheduler.schedulePeriodClosingNudge(
      period.endDate,
      preferences.eveningLogPromptHour,
      preferences.eveningLogPromptMinute,
      message,
    );
  }
  if (preferences.weeklyCheckInNudgeEnabled) {
    const weekSpentCents = await computeWeekSpentCents(householdId, now());
    const message = buildWeeklyCheckInMessage(envelopeSnapshots, weekSpentCents);
    await scheduler.scheduleWeeklyCheckIn(
      preferences.eveningLogPromptHour,
      preferences.eveningLogPromptMinute,
      message,
    );
  }
}

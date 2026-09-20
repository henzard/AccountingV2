import { and, eq, isNull } from 'drizzle-orm';
import { format } from 'date-fns';
import { db } from '../../data/local/db';
import { transactions } from '../../data/local/schema';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';

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

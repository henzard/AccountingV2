import messaging, { type FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { useToastStore } from '../../presentation/stores/toastStore';
import { useAppStore } from '../../presentation/stores/appStore';
import { requestSyncNow } from '../../data/sync/syncRuntime';
import { logger } from '../logging/Logger';

/**
 * Foreground push handling — VAL-6/DB-7.
 *
 * `messaging().onMessage` only fires while the app is in the FOREGROUND
 * (background/quit-state delivery is the OS's job, via the notification
 * tray). Without this, a partner's push arrives silently while the app is
 * open — no toast, and the current screen's data goes stale until the next
 * scheduled sync.
 *
 * Shows the push as an in-app toast (same queue as every other UI toast —
 * see toastStore) and requests an immediate sync so the transaction/slip
 * that triggered the push shows up right away. `requestSyncNow`'s rejection
 * is swallowed: a push is a nice-to-have prompt to refresh, never something
 * that should surface an error of its own if the sync round fails.
 */
export function subscribeToForegroundMessages(): () => void {
  return messaging().onMessage((message: FirebaseMessagingTypes.RemoteMessage) => {
    const title = message.notification?.title;
    const body = message.notification?.body;
    if (!title && !body) return;

    useToastStore.getState().enqueue([title, body].filter(Boolean).join(': '), 'info');

    // PUSH-3: sync the household the push is ABOUT (notify-event's
    // `data.householdId`, see index.ts's `buildV1Message`), not necessarily
    // the one currently being viewed — otherwise a push about household B
    // arriving while household A is open would refresh the wrong household
    // and leave B's change unsynced until the next scheduled sync. Falls
    // back to the current household when `data.householdId` is absent (an
    // older server build, or the legacy request shape) or the user is no
    // longer a member of it (removed/left since the push was queued).
    const { householdId: currentHouseholdId, availableHouseholds } = useAppStore.getState();
    const pushedHouseholdId = message.data?.householdId;
    const isMemberOfPushedHousehold =
      typeof pushedHouseholdId === 'string' &&
      availableHouseholds.some((h) => h.id === pushedHouseholdId);
    const syncHouseholdId = isMemberOfPushedHousehold ? pushedHouseholdId : currentHouseholdId;

    if (syncHouseholdId) {
      void requestSyncNow(syncHouseholdId).catch((err: unknown) => {
        logger.warn('[ForegroundMessageHandler] requestSyncNow after push failed', {
          err: String(err),
        });
      });
    }
  });
}

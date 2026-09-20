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

    const householdId = useAppStore.getState().householdId;
    if (householdId) {
      void requestSyncNow(householdId).catch((err: unknown) => {
        logger.warn('[ForegroundMessageHandler] requestSyncNow after push failed', {
          err: String(err),
        });
      });
    }
  });
}

import messaging from '@react-native-firebase/messaging';
import { supabase } from '../../data/remote/supabaseClient';
import { logger } from '../logging/Logger';

/**
 * Registers the device's FCM token with the user_fcm_tokens table in Supabase.
 * Called at login and on session restore. Non-fatal — any failure is logged and swallowed.
 *
 * The user_fcm_tokens table is expected to have columns:
 *   user_id TEXT, token TEXT, updated_at TIMESTAMPTZ, PRIMARY KEY (user_id, token)
 *
 * PRIMARY KEY is (user_id, token) — NOT just user_id — so a user can register
 * from multiple devices (phone + tablet) without one overwriting the other
 * (migration 0006_fcm_tokens_multi_device.sql / audit finding M18). A single
 * physical FCM token is unique per device install, so (user_id, token) is
 * the natural key for "this user's registration on this device".
 */
async function upsertToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('user_fcm_tokens')
    .upsert(
      { user_id: userId, token, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );
  if (error) {
    logger.warn('[FcmTokenRegistrar] upsert failed', { error: error.message });
  }
}

export async function registerFcmToken(userId: string): Promise<void> {
  try {
    const token = await messaging().getToken();
    if (!token) return;
    await upsertToken(userId, token);
  } catch (err) {
    // Non-fatal: FCM unavailable in some environments (emulators, no google-services.json)
    logger.warn('[FcmTokenRegistrar] getToken failed', { err: String(err) });
  }
}

/**
 * Subscribes to FCM token rotation (audit finding M16).
 *
 * FCM rotates the device token periodically (app reinstall/restore, GMS
 * refresh). Without this subscription the rotated token is never written
 * back to user_fcm_tokens, so every push to this device is sent to a dead
 * token until the next full cold-start sign-in re-registers.
 *
 * Call once per session start, alongside `registerFcmToken` (they upsert the
 * same row shape). Returns the unsubscribe function `onTokenRefresh` gives
 * back, so the caller can tear the listener down (e.g. on sign-out).
 *
 * WIRING NOTE (not owned by this fix): the sole current caller of
 * `registerFcmToken` is `initSessionRemote` in App.tsx (~line 253-254). That
 * boot path should also call `subscribeToTokenRefresh(userId)` right next to
 * it and hold onto the returned unsubscribe for its own session-teardown
 * logic (`resetAllStoresOnSignOut`, App.tsx ~290) — this file only owns the
 * subscription helper itself, not App.tsx's boot/teardown wiring.
 */
export function subscribeToTokenRefresh(userId: string): () => void {
  return messaging().onTokenRefresh((token: string) => {
    void upsertToken(userId, token).catch((err: unknown) => {
      logger.warn('[FcmTokenRegistrar] onTokenRefresh upsert failed', { err: String(err) });
    });
  });
}

/**
 * Unregisters this device's FCM token on sign-out (audit finding M17).
 *
 * Sign-out previously never deleted the user_fcm_tokens row nor called
 * messaging().deleteToken(), so on a shared device the previous user's row
 * kept the current device's token — the next user to sign in on the same
 * device would silently receive the previous user's push notifications.
 *
 * Deletes ONLY this device's row (matched by user_id + the device's current
 * token) so other rows for the same user — e.g. their tablet — are left
 * untouched, then calls messaging().deleteToken() so this device's install
 * mints a completely fresh token for whichever user signs in next. Must be
 * called BEFORE supabase.auth.signOut() — the delete relies on RLS
 * (user_id = auth.uid()), which requires the still-authenticated session.
 * Non-fatal — any failure is logged and swallowed so sign-out is never
 * blocked by FCM/network issues.
 */
export async function unregisterFcmToken(userId: string): Promise<void> {
  try {
    const token = await messaging().getToken();
    if (token) {
      const { error } = await supabase
        .from('user_fcm_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('token', token);
      if (error) {
        logger.warn('[FcmTokenRegistrar] delete on sign-out failed', { error: error.message });
      }
    }
    await messaging().deleteToken();
  } catch (err) {
    logger.warn('[FcmTokenRegistrar] unregister failed', { err: String(err) });
  }
}

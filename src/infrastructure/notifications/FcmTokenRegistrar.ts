import messaging from '@react-native-firebase/messaging';
import { supabase } from '../../data/remote/supabaseClient';
import { logger } from '../logging/Logger';

/**
 * Registers the device's FCM token with the user_fcm_tokens table in Supabase.
 * Called at login and on session restore. Non-fatal — any failure is logged and swallowed.
 *
 * The user_fcm_tokens table is expected to have columns:
 *   user_id TEXT PRIMARY KEY, token TEXT, updated_at TIMESTAMPTZ
 */
export async function registerFcmToken(userId: string): Promise<void> {
  try {
    const token = await messaging().getToken();
    if (!token) return;
    const { error } = await supabase
      .from('user_fcm_tokens')
      .upsert(
        { user_id: userId, token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) {
      logger.warn('[FcmTokenRegistrar] upsert failed', { error: error.message });
    }
  } catch (err) {
    // Non-fatal: FCM unavailable in some environments (emulators, no google-services.json)
    logger.warn('[FcmTokenRegistrar] getToken failed', { err: String(err) });
  }
}

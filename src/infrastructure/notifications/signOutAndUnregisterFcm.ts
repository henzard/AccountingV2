import { supabase } from '../../data/remote/supabaseClient';
import { unregisterFcmToken } from './FcmTokenRegistrar';

/**
 * Best-effort FCM deregistration followed by sign-out.
 *
 * Mirrors SettingsScreen's `handleSignOut` (see the M17 fix comment there):
 * on a shared device, the FCM token identifies the device install, not the
 * signed-in user, and survives a user switch unless it is explicitly cleared
 * before `supabase.auth.signOut()`. Without this, the previous user's row in
 * `user_fcm_tokens` stays registered and the next person to sign in on the
 * same device silently keeps receiving the previous household's pushes.
 *
 * `unregisterFcmToken` deletes rely on RLS (user_id = auth.uid()), so this
 * MUST run before sign-out while the session is still authenticated.
 * `unregisterFcmToken` is itself non-fatal (it logs and swallows), and a
 * missing `userId` (already signed out, or session never hydrated) simply
 * skips the unregister step — sign-out itself must never be blocked by an
 * FCM/network failure.
 *
 * SettingsScreen currently duplicates this exact sequence inline; it could
 * be migrated to call this helper too, but that screen is owned by another
 * agent this round and is intentionally left untouched here.
 */
/** How long sign-out waits for the best-effort push-token removal. */
export const UNREGISTER_TIMEOUT_MS = 5000;

export async function signOutAndUnregisterFcm(userId: string | null | undefined): Promise<void> {
  if (userId) {
    // `unregisterFcmToken` already catches and logs internally, but this
    // call is wrapped again defensively: sign-out must never be blocked by
    // FCM/network trouble, even if that internal contract ever regresses.
    //
    // A rejection is not the only way to be blocked: a request that never
    // SETTLES (stalled Firebase/Supabase call) would leave the previous
    // session signed in on a shared phone. The wait is therefore bounded.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        unregisterFcmToken(userId),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, UNREGISTER_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Best-effort — swallow and proceed to sign-out regardless.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  await supabase.auth.signOut();
}

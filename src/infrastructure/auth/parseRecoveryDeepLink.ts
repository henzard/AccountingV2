/**
 * parseRecoveryDeepLink
 *
 * Supabase's password-recovery email links land back in the app as a deep
 * link (`redirectTo` passed to `resetPasswordForEmail`), carrying the
 * recovery access/refresh tokens either as a URL fragment
 * (`accountingv2://reset-password#access_token=...&refresh_token=...&type=recovery`)
 * or as query params, depending on the Supabase project's mail template.
 *
 * IMPORTANT: `@supabase/auth-js`'s automatic `PASSWORD_RECOVERY` event
 * (emitted by `GoTrueClient#_initialize`) is gated on `isBrowser()` — it only
 * ever fires when `window`/`window.document` exist, which is never true on
 * React Native. Calling `supabase.auth.setSession(...)` manually (the
 * documented RN pattern for consuming a deep link) instead emits a plain
 * `SIGNED_IN` event. That means the ONLY reliable place to detect "this
 * session came from a recovery link" on this platform is here, at parse
 * time — by checking for `type=recovery` ourselves — not by waiting on a
 * `PASSWORD_RECOVERY` event that this SDK will never emit for us. See
 * App.tsx's deep-link handler, which calls this and flips
 * `passwordRecoveryPending` directly off the parse result.
 */
export type RecoveryTokens = {
  accessToken: string;
  refreshToken: string;
};

function extractParamString(url: string): string | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) return url.slice(hashIndex + 1);
  const queryIndex = url.indexOf('?');
  if (queryIndex >= 0) return url.slice(queryIndex + 1);
  return null;
}

/**
 * Returns the recovery tokens iff `url` is a well-formed Supabase recovery
 * deep link (has `type=recovery` plus both tokens). Returns null for every
 * other URL (a plain app open, an unrelated deep link, a malformed link) so
 * callers can safely no-op.
 */
export function parseRecoveryDeepLink(url: string): RecoveryTokens | null {
  const paramString = extractParamString(url);
  if (!paramString) return null;

  const params = new URLSearchParams(paramString);
  if (params.get('type') !== 'recovery') return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

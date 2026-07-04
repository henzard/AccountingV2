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
 *
 * A recovery link can ALSO come back carrying only an error (an
 * expired/invalid/already-used link — a very common case, since email
 * scanners pre-fetch links and links expire): no tokens, just
 * `error`/`error_code`/`error_description` params. Those must NOT be silently
 * dropped — the user would be stranded on the sign-in screen with no
 * feedback. This parser reports that case as a distinct `error` result so the
 * caller can route to ResetPasswordScreen's error view.
 */
export type RecoveryTokens = {
  accessToken: string;
  refreshToken: string;
};

/**
 * Discriminated result of parsing a deep link that MIGHT be a Supabase
 * password-recovery redirect:
 *  - `{ status: 'tokens' }` — a well-formed recovery link with both tokens.
 *  - `{ status: 'error' }`  — a recovery redirect that FAILED (expired/
 *     invalid/already-used): no tokens, but error params.
 *  - `null` — not a recovery link at all; the caller safely no-ops.
 */
export type RecoveryDeepLinkResult =
  | { status: 'tokens'; tokens: RecoveryTokens }
  | { status: 'error'; errorCode: string | null; errorDescription: string | null };

/** The path segment Supabase redirects a recovery link (and its error) back to. */
const RECOVERY_PATH = 'reset-password';

function extractParamString(url: string): string | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) return url.slice(hashIndex + 1);
  const queryIndex = url.indexOf('?');
  if (queryIndex >= 0) return url.slice(queryIndex + 1);
  return null;
}

/**
 * Classifies `url` as a recovery link:
 *  - a well-formed recovery link (`type=recovery` plus both tokens) →
 *    `{ status: 'tokens' }`;
 *  - a recovery redirect that failed (the `reset-password` path, carrying
 *    `error`/`error_code`/`error_description` but no usable tokens) →
 *    `{ status: 'error' }`;
 *  - anything else (a plain app open, an unrelated deep link, a malformed
 *    link) → `null`, so callers can safely no-op.
 */
export function parseRecoveryDeepLink(url: string): RecoveryDeepLinkResult | null {
  const paramString = extractParamString(url);
  if (!paramString) return null;

  const params = new URLSearchParams(paramString);

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (params.get('type') === 'recovery' && accessToken && refreshToken) {
    return { status: 'tokens', tokens: { accessToken, refreshToken } };
  }

  // No usable tokens. If this is the recovery redirect path AND it carries
  // error params, it's a failed recovery link (expired/invalid/already-used)
  // — surface it so the caller can show the reset-screen error rather than
  // silently dropping the link. Gating on the `reset-password` path keeps an
  // unrelated deep link that happens to carry an `error` param from hijacking
  // the reset flow.
  const errorCode = params.get('error_code');
  const errorDescription = params.get('error_description');
  const error = params.get('error');
  // Gate on the PATH segment (before any `?`/`#`) only — a `url.includes(...)`
  // over the whole URL would let an unrelated deep link that merely carries
  // `reset-password` inside a query/fragment value hijack the recovery flow.
  const pathSegment = url.split(/[?#]/, 1)[0];
  if (pathSegment.includes(RECOVERY_PATH) && (errorCode || errorDescription || error)) {
    return { status: 'error', errorCode, errorDescription };
  }

  return null;
}

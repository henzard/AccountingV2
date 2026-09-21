/**
 * Maps raw Supabase Auth errors (`@supabase/auth-js` — `AuthApiError`,
 * `AuthRetryableFetchError`, `AuthWeakPasswordError`, etc., or the
 * `DomainError` shape `SupabaseAuthService` wraps them in) to copy that is
 * safe to show a user. The raw error is always logged through the project
 * logger first — it must never reach the screen.
 *
 * Detection is deliberately based on `code`/`status` first (the stable,
 * versioned contract — see `@supabase/auth-js`'s `error-codes.ts`) and falls
 * back to matching the `message` text for shapes that don't carry a code
 * (e.g. a bare fetch `TypeError`, or a hand-rolled mock in a test).
 */
import { logger } from '../../infrastructure/logging/Logger';

export interface AuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
  /** `SupabaseAuthService` forwards the underlying error's status/code here
   * when it has to re-wrap it as a `DomainError` (whose own `code` is a
   * domain code like `AUTH_SIGN_IN_FAILED`, not the Supabase one). */
  context?: {
    status?: number;
    code?: string;
  };
}

const NETWORK_MESSAGE_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /timed?\s?out/i,
  /timeout/i,
  /networkerror/i,
];

const RATE_LIMIT_MESSAGE_PATTERNS = [/rate limit/i, /too many/i];

const INVALID_CREDENTIALS_MESSAGE_PATTERNS = [/invalid login credentials/i, /invalid credentials/i];

const UNCONFIRMED_EMAIL_MESSAGE_PATTERNS = [/email not confirmed/i, /confirm your email/i];

const WEAK_PASSWORD_MESSAGE_PATTERNS = [
  /password should be at least/i,
  /password is too weak/i,
  /weak password/i,
];

const ALREADY_REGISTERED_MESSAGE_PATTERNS = [
  /already registered/i,
  /already exists/i,
  /user already registered/i,
];

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);

const ALREADY_REGISTERED_CODES = new Set([
  'user_already_exists',
  'email_exists',
  'identity_already_exists',
]);

export const FRIENDLY_AUTH_MESSAGES = {
  offline: "You're offline or the connection dropped. Check your connection and try again.",
  rateLimit: 'Too many attempts. Wait a minute and try again.',
  unconfirmedEmail:
    'Please confirm your email address first — check your inbox for the confirmation link.',
  invalidCredentials: 'Incorrect email or password. Please try again.',
  fallback: 'Something went wrong. Please try again.',
} as const;

function matchesAny(value: string | undefined, patterns: RegExp[]): boolean {
  if (!value) return false;
  return patterns.some((pattern) => pattern.test(value));
}

function toAuthErrorLike(error: unknown): AuthErrorLike {
  if (error && typeof error === 'object') {
    return error as AuthErrorLike;
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return {};
}

/**
 * Returns copy safe to show the user for a raw Supabase Auth error, and logs
 * the raw error through the project logger. Never surface `error.message`
 * (or any other raw field) to the UI directly — always go through this.
 */
export function getFriendlyAuthErrorMessage(error: unknown, logContext?: string): string {
  const err = toAuthErrorLike(error);

  logger.error(
    logContext ? `Auth error: ${logContext}` : 'Auth error',
    error,
    logContext ? { context: logContext } : undefined,
  );

  const message = typeof err.message === 'string' ? err.message : undefined;
  const code = (typeof err.code === 'string' ? err.code : undefined) ?? err.context?.code;
  const status = (typeof err.status === 'number' ? err.status : undefined) ?? err.context?.status;
  const name = err.name;

  // Offline / dropped connection — AuthRetryableFetchError (thrown for any
  // non-HTTP fetch failure, status 0) or a bare fetch TypeError message.
  if (
    status === 0 ||
    name === 'AuthRetryableFetchError' ||
    matchesAny(message, NETWORK_MESSAGE_PATTERNS)
  ) {
    return FRIENDLY_AUTH_MESSAGES.offline;
  }

  // Rate limiting.
  if (
    status === 429 ||
    (code !== undefined && RATE_LIMIT_CODES.has(code)) ||
    matchesAny(message, RATE_LIMIT_MESSAGE_PATTERNS)
  ) {
    return FRIENDLY_AUTH_MESSAGES.rateLimit;
  }

  // Unconfirmed email.
  if (code === 'email_not_confirmed' || matchesAny(message, UNCONFIRMED_EMAIL_MESSAGE_PATTERNS)) {
    return FRIENDLY_AUTH_MESSAGES.unconfirmedEmail;
  }

  // Invalid credentials — no screen currently has its own app-authored copy
  // for this, so use this friendly wording rather than the raw message.
  if (code === 'invalid_credentials' || matchesAny(message, INVALID_CREDENTIALS_MESSAGE_PATTERNS)) {
    return FRIENDLY_AUTH_MESSAGES.invalidCredentials;
  }

  // Weak password / already registered — Supabase's own message is already
  // plain, actionable copy ("Password should be at least 6 characters."),
  // so show it as-is rather than a generic fallback.
  if (
    code === 'weak_password' ||
    name === 'AuthWeakPasswordError' ||
    matchesAny(message, WEAK_PASSWORD_MESSAGE_PATTERNS)
  ) {
    return message ?? FRIENDLY_AUTH_MESSAGES.fallback;
  }
  if (
    (code !== undefined && ALREADY_REGISTERED_CODES.has(code)) ||
    matchesAny(message, ALREADY_REGISTERED_MESSAGE_PATTERNS)
  ) {
    return message ?? FRIENDLY_AUTH_MESSAGES.fallback;
  }

  return FRIENDLY_AUTH_MESSAGES.fallback;
}

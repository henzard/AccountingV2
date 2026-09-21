import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';
import { getFriendlyAuthErrorMessage, FRIENDLY_AUTH_MESSAGES } from '../authErrorMessages';

jest.mock('../../../infrastructure/logging/Logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { logger } = require('../../../infrastructure/logging/Logger') as {
  logger: { error: jest.Mock };
};

describe('getFriendlyAuthErrorMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the raw error through the project logger and never returns its message verbatim for a generic failure', () => {
    const raw = new AuthApiError('Some unexpected upstream detail', 500, 'unexpected_failure');
    const friendly = getFriendlyAuthErrorMessage(raw);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), raw, undefined);
    expect(friendly).not.toBe(raw.message);
    expect(friendly).toBe(FRIENDLY_AUTH_MESSAGES.fallback);
  });

  describe('offline / dropped connection', () => {
    it('maps AuthRetryableFetchError (status 0) to the offline message', () => {
      const raw = new AuthRetryableFetchError('Network request failed', 0);
      expect(getFriendlyAuthErrorMessage(raw)).toBe(FRIENDLY_AUTH_MESSAGES.offline);
    });

    it('maps a bare "Network request failed" message (React Native fetch failure)', () => {
      expect(getFriendlyAuthErrorMessage({ message: 'Network request failed' })).toBe(
        FRIENDLY_AUTH_MESSAGES.offline,
      );
    });

    it('maps a bare "Failed to fetch" message (web fetch failure)', () => {
      expect(getFriendlyAuthErrorMessage({ message: 'TypeError: Failed to fetch' })).toBe(
        FRIENDLY_AUTH_MESSAGES.offline,
      );
    });

    it('maps a timeout message', () => {
      expect(getFriendlyAuthErrorMessage({ message: 'The request timed out' })).toBe(
        FRIENDLY_AUTH_MESSAGES.offline,
      );
    });

    it('maps status 0 from a DomainError context even without a matching message', () => {
      expect(
        getFriendlyAuthErrorMessage({ message: 'Sign in failed', context: { status: 0 } }),
      ).toBe(FRIENDLY_AUTH_MESSAGES.offline);
    });
  });

  describe('invalid credentials', () => {
    it('maps AuthApiError("Invalid login credentials", 400, "invalid_credentials")', () => {
      const raw = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');
      expect(getFriendlyAuthErrorMessage(raw)).toBe(FRIENDLY_AUTH_MESSAGES.invalidCredentials);
    });

    it('maps by code alone even if the message text differs', () => {
      const raw = new AuthApiError('unexpected wording', 400, 'invalid_credentials');
      expect(getFriendlyAuthErrorMessage(raw)).toBe(FRIENDLY_AUTH_MESSAGES.invalidCredentials);
    });

    it('maps via a DomainError-shaped error carrying the code in context', () => {
      expect(
        getFriendlyAuthErrorMessage({
          message: 'Sign in failed',
          context: { status: 400, code: 'invalid_credentials' },
        }),
      ).toBe(FRIENDLY_AUTH_MESSAGES.invalidCredentials);
    });

    it('prefers the provider code in context over the top-level DOMAIN code', () => {
      // The real shape SupabaseAuthService returns: the domain code sits at the
      // top level and would otherwise shadow the provider code entirely.
      expect(
        getFriendlyAuthErrorMessage({
          code: 'AUTH_SIGN_IN_FAILED',
          message: 'Sign in failed',
          context: { code: 'email_not_confirmed' },
        }),
      ).toBe(FRIENDLY_AUTH_MESSAGES.unconfirmedEmail);
    });
  });

  describe('unconfirmed email', () => {
    it('maps AuthApiError with code "email_not_confirmed"', () => {
      const raw = new AuthApiError('Email not confirmed', 400, 'email_not_confirmed');
      const friendly = getFriendlyAuthErrorMessage(raw);
      expect(friendly).toBe(FRIENDLY_AUTH_MESSAGES.unconfirmedEmail);
      expect(friendly.toLowerCase()).toContain('inbox');
    });
  });

  describe('rate limiting', () => {
    it('maps status 429', () => {
      const raw = new AuthApiError('For security purposes...', 429, 'over_request_rate_limit');
      expect(getFriendlyAuthErrorMessage(raw)).toBe(FRIENDLY_AUTH_MESSAGES.rateLimit);
    });

    it('maps by rate-limit error code even without status 429 on the mock', () => {
      expect(
        getFriendlyAuthErrorMessage({ message: 'slow down', code: 'over_email_send_rate_limit' }),
      ).toBe(FRIENDLY_AUTH_MESSAGES.rateLimit);
    });

    it('maps a "too many" message', () => {
      expect(getFriendlyAuthErrorMessage({ message: 'Too many requests' })).toBe(
        FRIENDLY_AUTH_MESSAGES.rateLimit,
      );
    });

    it('maps a "rate limit" message', () => {
      expect(getFriendlyAuthErrorMessage({ message: 'Email rate limit exceeded' })).toBe(
        FRIENDLY_AUTH_MESSAGES.rateLimit,
      );
    });
  });

  describe('weak password', () => {
    it('maps AuthWeakPasswordError to fixed app copy, never the provider text', () => {
      const raw = new AuthWeakPasswordError('Password should be at least 6 characters.', 422, [
        'length',
      ]);
      expect(getFriendlyAuthErrorMessage(raw)).toBe(FRIENDLY_AUTH_MESSAGES.weakPassword);
    });
  });

  describe('already registered', () => {
    it('maps AuthApiError("User already registered", 422, "user_already_exists") to fixed copy', () => {
      const raw = new AuthApiError('User already registered', 422, 'user_already_exists');
      expect(getFriendlyAuthErrorMessage(raw)).toBe(FRIENDLY_AUTH_MESSAGES.alreadyRegistered);
    });

    it('maps a plain "already registered" message by text when there is no code', () => {
      expect(getFriendlyAuthErrorMessage({ message: 'This email is already registered' })).toBe(
        FRIENDLY_AUTH_MESSAGES.alreadyRegistered,
      );
    });

    it('never leaks internal text that merely looks like "already exists"', () => {
      const leaky = 'relation "auth.users" already exists';
      expect(getFriendlyAuthErrorMessage({ message: leaky })).not.toContain('auth.users');
    });
  });

  describe('fallback', () => {
    it('never leaks an unrecognised raw message to the UI', () => {
      const friendly = getFriendlyAuthErrorMessage({
        message: 'relation "auth.users" does not exist',
      });
      expect(friendly).toBe(FRIENDLY_AUTH_MESSAGES.fallback);
    });

    it('handles null/undefined/non-object errors without throwing', () => {
      expect(getFriendlyAuthErrorMessage(null)).toBe(FRIENDLY_AUTH_MESSAGES.fallback);
      expect(getFriendlyAuthErrorMessage(undefined)).toBe(FRIENDLY_AUTH_MESSAGES.fallback);
      expect(getFriendlyAuthErrorMessage('boom')).toBe(FRIENDLY_AUTH_MESSAGES.fallback);
    });
  });
});

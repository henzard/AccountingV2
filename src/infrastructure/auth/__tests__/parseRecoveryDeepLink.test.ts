import { parseRecoveryDeepLink } from '../parseRecoveryDeepLink';

describe('parseRecoveryDeepLink', () => {
  it('extracts tokens from a fragment-style recovery URL', () => {
    const url =
      'accountingv2://reset-password#access_token=abc123&refresh_token=def456&type=recovery';
    expect(parseRecoveryDeepLink(url)).toEqual({
      status: 'tokens',
      tokens: { accessToken: 'abc123', refreshToken: 'def456' },
    });
  });

  it('extracts tokens from a query-string-style recovery URL', () => {
    const url =
      'accountingv2://reset-password?access_token=abc123&refresh_token=def456&type=recovery';
    expect(parseRecoveryDeepLink(url)).toEqual({
      status: 'tokens',
      tokens: { accessToken: 'abc123', refreshToken: 'def456' },
    });
  });

  it('returns null when type is not recovery (e.g. a plain sign-in magic link)', () => {
    const url = 'accountingv2://callback#access_token=abc123&refresh_token=def456&type=signup';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });

  it('returns null when access_token is missing (and there are no error params)', () => {
    const url = 'accountingv2://reset-password#refresh_token=def456&type=recovery';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });

  it('returns null when refresh_token is missing (and there are no error params)', () => {
    const url = 'accountingv2://reset-password#access_token=abc123&type=recovery';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });

  it('returns null for a URL with no params at all', () => {
    expect(parseRecoveryDeepLink('accountingv2://')).toBeNull();
  });

  it('returns null for an unrelated deep link', () => {
    expect(parseRecoveryDeepLink('accountingv2://some/other/path')).toBeNull();
  });

  it('reports an error for a recovery redirect carrying only error params (expired link, no tokens)', () => {
    const url =
      'accountingv2://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(parseRecoveryDeepLink(url)).toEqual({
      status: 'error',
      errorCode: 'otp_expired',
      errorDescription: 'Email link is invalid or has expired',
    });
  });

  it('reports an error for a recovery redirect with an error_description but no error_code', () => {
    const url = 'accountingv2://reset-password?error_description=Something+went+wrong';
    expect(parseRecoveryDeepLink(url)).toEqual({
      status: 'error',
      errorCode: null,
      errorDescription: 'Something went wrong',
    });
  });

  it('does NOT treat error params on an unrelated (non reset-password) deep link as a recovery error', () => {
    const url = 'accountingv2://callback#error=access_denied&error_code=otp_expired';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });
});

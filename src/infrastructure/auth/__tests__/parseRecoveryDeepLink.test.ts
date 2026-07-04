import { parseRecoveryDeepLink } from '../parseRecoveryDeepLink';

describe('parseRecoveryDeepLink', () => {
  it('extracts tokens from a fragment-style recovery URL', () => {
    const url =
      'accountingv2://reset-password#access_token=abc123&refresh_token=def456&type=recovery';
    expect(parseRecoveryDeepLink(url)).toEqual({
      accessToken: 'abc123',
      refreshToken: 'def456',
    });
  });

  it('extracts tokens from a query-string-style recovery URL', () => {
    const url =
      'accountingv2://reset-password?access_token=abc123&refresh_token=def456&type=recovery';
    expect(parseRecoveryDeepLink(url)).toEqual({
      accessToken: 'abc123',
      refreshToken: 'def456',
    });
  });

  it('returns null when type is not recovery (e.g. a plain sign-in magic link)', () => {
    const url = 'accountingv2://callback#access_token=abc123&refresh_token=def456&type=signup';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });

  it('returns null when access_token is missing', () => {
    const url = 'accountingv2://reset-password#refresh_token=def456&type=recovery';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });

  it('returns null when refresh_token is missing', () => {
    const url = 'accountingv2://reset-password#access_token=abc123&type=recovery';
    expect(parseRecoveryDeepLink(url)).toBeNull();
  });

  it('returns null for a URL with no params at all', () => {
    expect(parseRecoveryDeepLink('accountingv2://')).toBeNull();
  });

  it('returns null for an unrelated deep link', () => {
    expect(parseRecoveryDeepLink('accountingv2://some/other/path')).toBeNull();
  });
});

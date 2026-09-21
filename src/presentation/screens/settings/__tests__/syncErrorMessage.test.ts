/**
 * syncErrorMessage.test.ts — D-2: known error shapes get plain language,
 * everything else falls back to one generic message. The raw text must
 * never come back out of this function.
 */
import { syncErrorMessage } from '../syncErrorMessage';

describe('syncErrorMessage', () => {
  it('maps a network/fetch/timeout error to a connection message', () => {
    expect(syncErrorMessage(new Error('network down'))).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(syncErrorMessage(new Error('FetchError: request failed'))).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(syncErrorMessage(new Error('request timeout after 30000ms'))).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it('maps an auth/JWT-expired error to a sign-in-again message', () => {
    expect(syncErrorMessage(new Error('JWT expired'))).toBe(
      'Your session expired. Sign in again to keep syncing.',
    );
    expect(syncErrorMessage(new Error('401 unauthorized'))).toBe(
      'Your session expired. Sign in again to keep syncing.',
    );
  });

  it('maps a permission error to a permission message', () => {
    expect(syncErrorMessage(new Error('permission denied for table oplog'))).toBe(
      "You don't have permission to make this change.",
    );
    expect(syncErrorMessage(new Error('403 forbidden'))).toBe(
      "You don't have permission to make this change.",
    );
  });

  it('falls back to one generic message for an unknown shape, never the raw text', () => {
    const message = syncErrorMessage(new Error('duplicate key value violates constraint xyz_pkey'));
    expect(message).toBe("Something went wrong while syncing. We'll try again.");
    expect(message).not.toContain('xyz_pkey');
  });

  it('falls back to the generic message for a non-Error value', () => {
    expect(syncErrorMessage('a raw string')).toBe(
      "Something went wrong while syncing. We'll try again.",
    );
    expect(syncErrorMessage(undefined)).toBe(
      "Something went wrong while syncing. We'll try again.",
    );
  });
});

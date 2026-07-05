const mockGetToken = jest.fn();
const mockOnTokenRefresh = jest.fn();
const mockDeleteToken = jest.fn();
jest.mock('@react-native-firebase/messaging', () => () => ({
  getToken: mockGetToken,
  onTokenRefresh: mockOnTokenRefresh,
  deleteToken: mockDeleteToken,
}));

const mockUpsert = jest.fn();
const mockDeleteEq1 = jest.fn();
const mockDeleteEq2 = jest.fn();
jest.mock('../../../data/remote/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: mockUpsert,
      delete: jest.fn(() => ({ eq: mockDeleteEq1 })),
    })),
  },
}));

jest.mock('../../logging/Logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import {
  registerFcmToken,
  subscribeToTokenRefresh,
  unregisterFcmToken,
} from '../FcmTokenRegistrar';
import { supabase } from '../../../data/remote/supabaseClient';
import { logger } from '../../logging/Logger';

const mockLoggerWarn = logger.warn as jest.Mock;

describe('FcmTokenRegistrar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-wire the chained delete().eq().eq() mock after clearAllMocks resets it.
    mockDeleteEq1.mockImplementation(() => ({ eq: mockDeleteEq2 }));
    mockDeleteEq2.mockResolvedValue({ error: null });
  });

  describe('registerFcmToken', () => {
    it('registers token successfully with a multi-device onConflict target', async () => {
      mockGetToken.mockResolvedValue('fcm-token-123');
      mockUpsert.mockResolvedValue({ error: null });

      await registerFcmToken('user-1');

      expect(mockGetToken).toHaveBeenCalled();
      expect(supabase.from).toHaveBeenCalledWith('user_fcm_tokens');
      // M18: onConflict must target (user_id, token), not just user_id —
      // otherwise a second device's registration overwrites the first.
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', token: 'fcm-token-123' }),
        { onConflict: 'user_id,token' },
      );
    });

    it('returns early when token is null', async () => {
      mockGetToken.mockResolvedValue(null);

      await registerFcmToken('user-1');

      expect(supabase.from).not.toHaveBeenCalled();
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('returns early when token is empty string', async () => {
      mockGetToken.mockResolvedValue('');

      await registerFcmToken('user-1');

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('logs warning when supabase upsert fails', async () => {
      mockGetToken.mockResolvedValue('fcm-token-123');
      mockUpsert.mockResolvedValue({ error: { message: 'RLS violation' } });

      await registerFcmToken('user-1');

      expect(mockLoggerWarn).toHaveBeenCalledWith('[FcmTokenRegistrar] upsert failed', {
        error: 'RLS violation',
      });
    });

    it('catches and logs when messaging throws', async () => {
      mockGetToken.mockRejectedValue(new Error('No google-services.json'));

      await registerFcmToken('user-1');

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        '[FcmTokenRegistrar] getToken failed',
        expect.objectContaining({ err: expect.stringContaining('No google-services.json') }),
      );
    });

    it('does not throw when messaging throws', async () => {
      mockGetToken.mockRejectedValue(new Error('crash'));

      await expect(registerFcmToken('user-1')).resolves.toBeUndefined();
    });
  });

  describe('subscribeToTokenRefresh (M16)', () => {
    it('subscribes to messaging().onTokenRefresh', () => {
      const unsubscribe = jest.fn();
      mockOnTokenRefresh.mockReturnValue(unsubscribe);

      const result = subscribeToTokenRefresh('user-1');

      expect(mockOnTokenRefresh).toHaveBeenCalledWith(expect.any(Function));
      expect(result).toBe(unsubscribe);
    });

    it('re-upserts the rotated token when the refresh callback fires', async () => {
      mockOnTokenRefresh.mockImplementation((cb: (token: string) => void) => {
        cb('rotated-token');
        return jest.fn();
      });
      mockUpsert.mockResolvedValue({ error: null });

      subscribeToTokenRefresh('user-1');
      // upsertToken is fire-and-forget inside the callback; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      expect(supabase.from).toHaveBeenCalledWith('user_fcm_tokens');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', token: 'rotated-token' }),
        { onConflict: 'user_id,token' },
      );
    });

    it('logs a warning if the rotated-token upsert fails, without throwing', async () => {
      mockOnTokenRefresh.mockImplementation((cb: (token: string) => void) => {
        cb('rotated-token');
        return jest.fn();
      });
      mockUpsert.mockResolvedValue({ error: { message: 'network error' } });

      subscribeToTokenRefresh('user-1');
      await Promise.resolve();
      await Promise.resolve();

      expect(mockLoggerWarn).toHaveBeenCalledWith('[FcmTokenRegistrar] upsert failed', {
        error: 'network error',
      });
    });
  });

  describe('unregisterFcmToken (M17)', () => {
    it('deletes this device row and calls messaging().deleteToken()', async () => {
      mockGetToken.mockResolvedValue('fcm-token-123');
      mockDeleteToken.mockResolvedValue(undefined);

      await unregisterFcmToken('user-1');

      expect(supabase.from).toHaveBeenCalledWith('user_fcm_tokens');
      expect(mockDeleteEq1).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockDeleteEq2).toHaveBeenCalledWith('token', 'fcm-token-123');
      expect(mockDeleteToken).toHaveBeenCalled();
    });

    it('skips the row delete but still calls deleteToken when getToken returns null', async () => {
      mockGetToken.mockResolvedValue(null);
      mockDeleteToken.mockResolvedValue(undefined);

      await unregisterFcmToken('user-1');

      expect(supabase.from).not.toHaveBeenCalled();
      expect(mockDeleteToken).toHaveBeenCalled();
    });

    it('logs a warning and does not throw when the delete fails', async () => {
      mockGetToken.mockResolvedValue('fcm-token-123');
      mockDeleteEq2.mockResolvedValue({ error: { message: 'RLS violation' } });
      mockDeleteToken.mockResolvedValue(undefined);

      await expect(unregisterFcmToken('user-1')).resolves.toBeUndefined();

      expect(mockLoggerWarn).toHaveBeenCalledWith('[FcmTokenRegistrar] delete on sign-out failed', {
        error: 'RLS violation',
      });
    });

    it('logs a warning and does not throw when messaging throws', async () => {
      mockGetToken.mockRejectedValue(new Error('crash'));

      await expect(unregisterFcmToken('user-1')).resolves.toBeUndefined();

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        '[FcmTokenRegistrar] unregister failed',
        expect.objectContaining({ err: expect.stringContaining('crash') }),
      );
    });
  });
});

const mockGetToken = jest.fn();
jest.mock('@react-native-firebase/messaging', () => () => ({
  getToken: mockGetToken,
}));

const mockUpsert = jest.fn();
jest.mock('../../../data/remote/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}));

jest.mock('../../logging/Logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { registerFcmToken } from '../FcmTokenRegistrar';
import { supabase } from '../../../data/remote/supabaseClient';
import { logger } from '../../logging/Logger';

const mockLoggerWarn = logger.warn as jest.Mock;

describe('FcmTokenRegistrar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers token successfully', async () => {
    mockGetToken.mockResolvedValue('fcm-token-123');
    mockUpsert.mockResolvedValue({ error: null });

    await registerFcmToken('user-1');

    expect(mockGetToken).toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith('user_fcm_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', token: 'fcm-token-123' }),
      { onConflict: 'user_id' },
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

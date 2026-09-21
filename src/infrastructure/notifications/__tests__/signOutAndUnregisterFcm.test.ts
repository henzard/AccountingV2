const mockUnregisterFcmToken = jest.fn();
jest.mock('../FcmTokenRegistrar', () => ({
  unregisterFcmToken: (...args: unknown[]) => mockUnregisterFcmToken(...args),
}));

const mockSignOut = jest.fn();
jest.mock('../../../data/remote/supabaseClient', () => ({
  supabase: { auth: { signOut: (...args: unknown[]) => mockSignOut(...args) } },
}));

import { signOutAndUnregisterFcm } from '../signOutAndUnregisterFcm';

describe('signOutAndUnregisterFcm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnregisterFcmToken.mockResolvedValue(undefined);
    mockSignOut.mockResolvedValue({ error: null });
  });

  it('unregisters this device token before signing out', async () => {
    const order: string[] = [];
    mockUnregisterFcmToken.mockImplementation(async () => {
      order.push('unregister');
    });
    mockSignOut.mockImplementation(async () => {
      order.push('signOut');
      return { error: null };
    });

    await signOutAndUnregisterFcm('user-1');

    expect(mockUnregisterFcmToken).toHaveBeenCalledWith('user-1');
    expect(mockSignOut).toHaveBeenCalled();
    expect(order).toEqual(['unregister', 'signOut']);
  });

  it('skips unregister and still signs out when userId is null', async () => {
    await signOutAndUnregisterFcm(null);

    expect(mockUnregisterFcmToken).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('skips unregister and still signs out when userId is undefined', async () => {
    await signOutAndUnregisterFcm(undefined);

    expect(mockUnregisterFcmToken).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('still signs out even when unregister rejects (best-effort, must never block sign-out)', async () => {
    mockUnregisterFcmToken.mockRejectedValue(new Error('network down'));

    // The helper must not let an unregister failure prevent sign-out. If it
    // propagated the rejection instead of being best-effort, this call
    // would reject and mockSignOut would never be reached.
    await expect(signOutAndUnregisterFcm('user-1')).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalled();
  });
});

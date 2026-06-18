import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  markOnboardingComplete,
  isOnboardingComplete,
  clearOnboardingFlag,
} from '../onboardingFlag';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

describe('onboardingFlag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('markOnboardingComplete', () => {
    it('stores true with the correct key', async () => {
      await markOnboardingComplete('user-1', 'hh-1');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@onboarding_completed:user-1:hh-1',
        'true',
      );
    });

    it('propagates storage errors', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage full'));

      await expect(markOnboardingComplete('u', 'h')).rejects.toThrow('Storage full');
    });
  });

  describe('isOnboardingComplete', () => {
    it('returns true when flag is set', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('true');

      const result = await isOnboardingComplete('user-1', 'hh-1');

      expect(result).toBe(true);
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('@onboarding_completed:user-1:hh-1');
    });

    it('returns false when flag is null', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

      const result = await isOnboardingComplete('user-1', 'hh-1');

      expect(result).toBe(false);
    });

    it('returns false when flag is unexpected value', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('false');

      const result = await isOnboardingComplete('user-1', 'hh-1');

      expect(result).toBe(false);
    });
  });

  describe('clearOnboardingFlag', () => {
    it('removes the correct key', async () => {
      await clearOnboardingFlag('user-1', 'hh-1');

      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@onboarding_completed:user-1:hh-1');
    });

    it('propagates storage errors', async () => {
      (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('Oops'));

      await expect(clearOnboardingFlag('u', 'h')).rejects.toThrow('Oops');
    });
  });

  describe('key format', () => {
    it('uses correct key format with special characters in ids', async () => {
      await markOnboardingComplete('user@email.com', 'hh-with-dashes');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@onboarding_completed:user@email.com:hh-with-dashes',
        'true',
      );
    });
  });
});

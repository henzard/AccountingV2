import {
  markOnboardingComplete,
  isOnboardingComplete,
  clearOnboardingFlag,
} from '../onboardingFlag';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn(),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

describe('onboardingFlag', () => {
  const userId = 'user-abc';
  const householdId = 'hh-123';
  const key = `@onboarding_completed:${userId}:${householdId}`;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('markOnboardingComplete stores "true" at the correct key', async () => {
    await markOnboardingComplete(userId, householdId);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(key, 'true');
  });

  it('isOnboardingComplete returns true when flag is set', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');
    const result = await isOnboardingComplete(userId, householdId);
    expect(result).toBe(true);
  });

  it('isOnboardingComplete returns false when flag is absent', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const result = await isOnboardingComplete(userId, householdId);
    expect(result).toBe(false);
  });

  it('clearOnboardingFlag removes the correct key', async () => {
    await clearOnboardingFlag(userId, householdId);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(key);
  });
});

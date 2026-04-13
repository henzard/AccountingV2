/**
 * onboardingFlag — AsyncStorage-backed onboarding completion flag.
 *
 * Key format: @onboarding_completed:<userId>:<householdId>
 * Used by RootNavigator to gate the onboarding wizard.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

function flagKey(userId: string, householdId: string): string {
  return `@onboarding_completed:${userId}:${householdId}`;
}

export async function markOnboardingComplete(userId: string, householdId: string): Promise<void> {
  await AsyncStorage.setItem(flagKey(userId, householdId), 'true');
}

export async function isOnboardingComplete(userId: string, householdId: string): Promise<boolean> {
  const val = await AsyncStorage.getItem(flagKey(userId, householdId));
  return val === 'true';
}

export async function clearOnboardingFlag(userId: string, householdId: string): Promise<void> {
  await AsyncStorage.removeItem(flagKey(userId, householdId));
}

import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { CreateHouseholdNavigator } from './CreateHouseholdNavigator';
import { OnboardingNavigator } from '../screens/auth/onboarding/OnboardingNavigator';
import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { ShareInviteScreen } from '../screens/household/ShareInviteScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import { LoadingSplash } from '../components/shared/LoadingSplash';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationPreferencesRepository } from '../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import { isOnboardingComplete } from '../../infrastructure/storage/onboardingFlag';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefsRepo = new NotificationPreferencesRepository();
const scheduler = new LocalNotificationScheduler();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function RootNavigator(): React.JSX.Element {
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const { setPreferences, setPermissionsGranted } = useNotificationStore();

  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  // Resolve onboarding flag whenever session + household are known
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !householdId) {
      setOnboardingCompleted(null);
      return;
    }
    let cancelled = false;
    isOnboardingComplete(userId, householdId).then((done) => {
      if (!cancelled) setOnboardingCompleted(done);
    });
    return () => {
      cancelled = true;
    };
  }, [session, householdId]);

  const isAuthenticated = Boolean(session);
  const hasHousehold = Boolean(householdId);

  useEffect(() => {
    if (!isAuthenticated || !hasHousehold) {
      void scheduler.cancelAll();
      return;
    }

    const initNotifications = async (): Promise<void> => {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setPermissionsGranted(granted);

      const prefs = await prefsRepo.load();
      setPreferences(prefs);

      if (!granted) return;

      if (prefs.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(
          prefs.eveningLogPromptHour,
          prefs.eveningLogPromptMinute,
        );
      }
      if (prefs.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(prefs.meterReadingReminderDay);
      }
      if (prefs.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
    };

    void initNotifications();
  }, [isAuthenticated, hasHousehold, paydayDay, setPreferences, setPermissionsGranted]);

  // Determine which navigator to show
  const renderNavigator = (): React.JSX.Element => {
    if (!isAuthenticated) {
      return <Stack.Screen name="Auth" component={AuthNavigator} />;
    }
    if (!hasHousehold) {
      return <Stack.Screen name="CreateHouseholdFlow" component={CreateHouseholdNavigator} />;
    }
    // Wait for onboarding check to resolve before showing either wizard or main.
    // Render a neutral loading screen to prevent flashing Main on slow devices.
    if (onboardingCompleted === null) {
      return <Stack.Screen name="Auth" component={LoadingSplash} />;
    }
    if (!onboardingCompleted) {
      return <Stack.Screen name="Onboarding" component={OnboardingNavigator} />;
    }
    return <Stack.Screen name="Main" component={MainTabNavigator} />;
  };

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {renderNavigator()}
        <Stack.Screen
          name="HouseholdPicker"
          component={HouseholdPickerScreen}
          options={{ title: 'Your Households' }}
        />
        <Stack.Screen
          name="CreateHousehold"
          component={CreateHouseholdScreen}
          options={{ title: 'New Household' }}
        />
        <Stack.Screen
          name="ShareInvite"
          component={ShareInviteScreen}
          options={{ title: 'Invite Member' }}
        />
        <Stack.Screen
          name="JoinHousehold"
          component={JoinHouseholdScreen}
          options={{ title: 'Join a Household' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

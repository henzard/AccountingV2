import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { ShareInviteScreen } from '../screens/household/ShareInviteScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationPreferencesRepository } from '../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
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
  const isAuthenticated = Boolean(session && householdId);

  useEffect(() => {
    if (!isAuthenticated) {
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
        await scheduler.scheduleEveningLogPrompt(prefs.eveningLogPromptHour, prefs.eveningLogPromptMinute);
      }
      if (prefs.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(prefs.meterReadingReminderDay);
      }
      if (prefs.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
    };

    void initNotifications();
  }, [isAuthenticated, paydayDay, setPreferences, setPermissionsGranted]);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
        <Stack.Screen name="HouseholdPicker" component={HouseholdPickerScreen} options={{ title: 'Your Households' }} />
        <Stack.Screen name="CreateHousehold" component={CreateHouseholdScreen} options={{ title: 'New Household' }} />
        <Stack.Screen name="ShareInvite" component={ShareInviteScreen} options={{ title: 'Invite Member' }} />
        <Stack.Screen name="JoinHousehold" component={JoinHouseholdScreen} options={{ title: 'Join a Household' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

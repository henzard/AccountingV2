import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppTheme } from '../../theme/useAppTheme';
import type { SettingsStackParamList } from '../../navigation/types';
import { SettingsScreen } from './SettingsScreen';
import { NotificationPreferencesScreen } from './NotificationPreferencesScreen';
import { CrashLogViewer } from './CrashLogViewer';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStackNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
      }}
    >
      <Stack.Screen
        name="SettingsHome"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: 'Notifications' }}
      />
      <Stack.Screen name="CrashLog" component={CrashLogViewer} options={{ title: 'Crash log' }} />
    </Stack.Navigator>
  );
}

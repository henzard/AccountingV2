import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colours } from '../theme/tokens';
import type { MetersStackParamList } from './types';
import { MeterDashboardScreen } from '../screens/meters/MeterDashboardScreen';
import { AddReadingScreen } from '../screens/meters/AddReadingScreen';
import { RateHistoryScreen } from '../screens/meters/RateHistoryScreen';

const Stack = createNativeStackNavigator<MetersStackParamList>();

export function MetersStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
      }}
    >
      <Stack.Screen
        name="MeterDashboard"
        component={MeterDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddReading"
        component={AddReadingScreen}
        options={{ title: 'Log Reading' }}
      />
      <Stack.Screen
        name="RateHistory"
        component={RateHistoryScreen}
        options={{ title: 'Rate History' }}
      />
    </Stack.Navigator>
  );
}

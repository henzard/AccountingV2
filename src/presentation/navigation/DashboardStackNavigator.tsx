import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { AddEditEnvelopeScreen } from '../screens/envelopes/AddEditEnvelopeScreen';
import { colours } from '../theme/tokens';
import type { DashboardStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="DashboardHome"
        component={DashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddEditEnvelope"
        component={AddEditEnvelopeScreen}
        options={{
          title: 'Envelope',
          headerStyle: { backgroundColor: colours.surface },
          headerTintColor: colours.primary,
          headerShadowVisible: false,
        }}
      />
    </Stack.Navigator>
  );
}

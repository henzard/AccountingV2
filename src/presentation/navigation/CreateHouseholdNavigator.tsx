import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import type { CreateHouseholdStackParamList } from './types';

const Stack = createNativeStackNavigator<CreateHouseholdStackParamList>();

export function CreateHouseholdNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Stack.Screen name="CreateHouseholdGate" component={CreateHouseholdScreen as any} />
      <Stack.Screen
        name="JoinHouseholdGate"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        component={JoinHouseholdScreen as any}
        options={{ headerShown: true, title: 'Join a Household' }}
      />
    </Stack.Navigator>
  );
}

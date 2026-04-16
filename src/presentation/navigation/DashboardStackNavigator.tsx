import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { AddEditEnvelopeScreen } from '../screens/envelopes/AddEditEnvelopeScreen';
import { BabyStepsScreen } from '../screens/babySteps/BabyStepsScreen';
import { CelebrationModalHost } from '../screens/babySteps/CelebrationModalHost';
import { useAppTheme } from '../theme/useAppTheme';
import type { DashboardStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStackNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.flex}>
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
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.primary,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="BabySteps"
          component={BabyStepsScreen}
          options={{
            title: 'Baby Steps',
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.primary,
            headerShadowVisible: false,
          }}
        />
      </Stack.Navigator>

      {/*
       * CelebrationModalHost is a sibling to the Stack, NOT inside any single screen.
       * This ensures the modal appears regardless of which screen is active.
       * Spec §Host mounting: "sibling to the stack, not inside a single screen."
       */}
      <CelebrationModalHost />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

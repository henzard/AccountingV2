import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { AddEditEnvelopeScreen } from '../screens/envelopes/AddEditEnvelopeScreen';
import { AddTransactionScreen } from '../screens/transactions/AddTransactionScreen';
import { BabyStepsScreen } from '../screens/babySteps/BabyStepsScreen';
import { SinkingFundsScreen } from '../screens/sinkingFunds/SinkingFundsScreen';
import { ForecastScreen } from '../screens/forecasting/ForecastScreen';
import { CelebrationModalHost } from '../screens/babySteps/CelebrationModalHost';
import { useAppTheme } from '../theme/useAppTheme';
import type { DashboardStackParamList } from './types';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStackNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.flex}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="DashboardHome"
          component={DashboardScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="AddEditEnvelope"
          component={AddEditEnvelopeScreen}
          options={{ title: 'Envelope' }}
        />
        <Stack.Screen
          name="BabySteps"
          component={BabyStepsScreen}
          options={{ title: 'Baby Steps' }}
        />
        <Stack.Screen
          name="SinkingFunds"
          component={SinkingFundsScreen}
          options={{ title: 'Sinking Funds' }}
        />
        <Stack.Screen
          name="AddTransaction"
          component={AddTransactionScreen}
          options={{ title: 'Add Transaction' }}
        />
        <Stack.Screen name="Forecast" component={ForecastScreen} options={{ title: 'Forecast' }} />
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

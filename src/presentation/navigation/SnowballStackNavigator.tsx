import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppTheme } from '../theme/useAppTheme';
import type { SnowballStackParamList } from './types';
import { SnowballDashboardScreen } from '../screens/debtSnowball/SnowballDashboardScreen';
import { AddDebtScreen } from '../screens/debtSnowball/AddDebtScreen';
import { DebtDetailScreen } from '../screens/debtSnowball/DebtDetailScreen';
import { LogPaymentScreen } from '../screens/debtSnowball/LogPaymentScreen';

const Stack = createNativeStackNavigator<SnowballStackParamList>();

export function SnowballStackNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="SnowballDashboard"
        component={SnowballDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="AddDebt" component={AddDebtScreen} options={{ title: 'Add Debt' }} />
      <Stack.Screen
        name="DebtDetail"
        component={DebtDetailScreen}
        options={{ title: 'Debt Details' }}
      />
      <Stack.Screen
        name="LogPayment"
        component={LogPaymentScreen}
        options={{ title: 'Log Payment' }}
      />
    </Stack.Navigator>
  );
}

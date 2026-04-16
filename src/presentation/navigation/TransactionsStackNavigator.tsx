import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppTheme } from '../theme/useAppTheme';
import type { TransactionsStackParamList } from './types';
import { TransactionListScreen } from '../screens/transactions/TransactionListScreen';
import { AddTransactionScreen } from '../screens/transactions/AddTransactionScreen';

const Stack = createNativeStackNavigator<TransactionsStackParamList>();

export function TransactionsStackNavigator(): React.JSX.Element {
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
        name="TransactionList"
        component={TransactionListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddTransaction"
        component={AddTransactionScreen}
        options={{ title: 'Add Transaction' }}
      />
    </Stack.Navigator>
  );
}

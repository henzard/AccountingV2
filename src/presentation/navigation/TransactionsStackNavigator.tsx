import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colours } from '../theme/tokens';
import type { TransactionsStackParamList } from './types';
import { TransactionListScreen } from '../screens/transactions/TransactionListScreen';
import { AddTransactionScreen } from '../screens/transactions/AddTransactionScreen';

const Stack = createNativeStackNavigator<TransactionsStackParamList>();

export function TransactionsStackNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colours.surface },
        headerTintColor: colours.primary,
        headerTitleStyle: { fontFamily: 'PlusJakartaSans_700Bold' },
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

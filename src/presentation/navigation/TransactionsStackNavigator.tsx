import React from 'react';
import { TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native-paper';
import { useAppTheme } from '../theme/useAppTheme';
import type { TransactionsStackParamList } from './types';
import { TransactionListScreen } from '../screens/transactions/TransactionListScreen';
import { AddTransactionScreen } from '../screens/transactions/AddTransactionScreen';
import { BusinessExpenseReportScreen } from '../screens/transactions/BusinessExpenseReportScreen';

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
        options={({ navigation }) => ({
          headerShown: true,
          title: 'Transactions',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => navigation.navigate('BusinessExpenseReport')}
              style={{ marginRight: 8 }}
              testID="biz-expense-header-button"
            >
              <Text style={{ color: colors.primary }}>Business</Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="AddTransaction"
        component={AddTransactionScreen}
        options={{ title: 'Add Transaction' }}
      />
      <Stack.Screen
        name="BusinessExpenseReport"
        component={BusinessExpenseReportScreen}
        options={{ title: 'Business Expenses' }}
      />
    </Stack.Navigator>
  );
}

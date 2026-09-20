import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { TransactionsStackNavigator } from './TransactionsStackNavigator';
import { MetersStackNavigator } from './MetersStackNavigator';
import { SnowballStackNavigator } from './SnowballStackNavigator';
import { SettingsStackNavigator } from '../screens/settings/SettingsStackNavigator';
import { OfflineBanner } from '../components/shared/OfflineBanner';
import { useAppTheme } from '../theme/useAppTheme';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({
  name,
  color,
  size,
}: {
  name: string;
  color: string;
  size: number;
}): React.JSX.Element {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

export function MainTabNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.flex}>
      <OfflineBanner />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.onSurfaceVariant,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant },
          tabBarShowLabel: true,
          tabBarLabelStyle: { fontSize: 11 },
        }}
      >
        <Tab.Screen
          name="DashboardTab"
          component={DashboardStackNavigator}
          options={{
            tabBarLabel: 'Dashboard',
            tabBarIcon: ({ color, size }) => (
              <TabIcon name="wallet-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Transactions"
          component={TransactionsStackNavigator}
          options={{
            tabBarLabel: 'Transactions',
            tabBarIcon: ({ color, size }) => (
              <TabIcon name="swap-horizontal" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Meters"
          component={MetersStackNavigator}
          options={{
            tabBarLabel: 'Meters',
            tabBarIcon: ({ color, size }) => <TabIcon name="gauge" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Snowball"
          component={SnowballStackNavigator}
          options={{
            tabBarLabel: 'Snowball',
            tabBarIcon: ({ color, size }) => <TabIcon name="snowflake" color={color} size={size} />,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsStackNavigator}
          options={{
            tabBarLabel: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <TabIcon name="cog-outline" color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>
      {/*
        UX2-3: ToastHost and ConfirmDialogHost now mount exactly ONCE, at the
        app root (RootNavigator) — mounting them here too would either double
        them up while Main is active, or (for toasts enqueued from outside
        the five tabs, e.g. JoinHousehold/CreateHousehold/HouseholdMembers/
        SlipCapture/onboarding) leave them invisible until the user happened
        to be on a tab.
      */}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

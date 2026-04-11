import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { TransactionsStackNavigator } from './TransactionsStackNavigator';
import { MetersStackNavigator } from './MetersStackNavigator';
import { SnowballStackNavigator } from './SnowballStackNavigator';
import { SettingsStackNavigator } from '../screens/settings/SettingsStackNavigator';
import { colours } from '../theme/tokens';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({ name, color, size }: { name: string; color: string; size: number }): React.JSX.Element {
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}

export function MainTabNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: colours.onSurfaceVariant,
        tabBarStyle: { backgroundColor: colours.surface, borderTopColor: colours.outlineVariant },
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="wallet-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="swap-horizontal" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Meters"
        component={MetersStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="gauge" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Snowball"
        component={SnowballStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="snowflake" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStackNavigator}
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="cog-outline" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

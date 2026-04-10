import React from 'react';
import { View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { DashboardStackNavigator } from './DashboardStackNavigator';
import { colours } from '../theme/tokens';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function PlaceholderScreen({ name }: { name: string }): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{name} — coming soon</Text>
    </View>
  );
}

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
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="swap-horizontal" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Transactions" />}
      />
      <Tab.Screen
        name="Meters"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="gauge" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Meters" />}
      />
      <Tab.Screen
        name="Snowball"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="snowflake" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Snowball" />}
      />
      <Tab.Screen
        name="Settings"
        options={{
          tabBarIcon: ({ color, size }) => <TabIcon name="cog-outline" color={color} size={size} />,
        }}
        children={() => <PlaceholderScreen name="Settings" />}
      />
    </Tab.Navigator>
  );
}

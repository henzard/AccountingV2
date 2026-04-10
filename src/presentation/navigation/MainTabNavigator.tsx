import React from 'react';
import { View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
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
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Transactions" children={(): React.JSX.Element => <PlaceholderScreen name="Transactions" />} />
      <Tab.Screen name="Meters" children={(): React.JSX.Element => <PlaceholderScreen name="Meters" />} />
      <Tab.Screen name="Snowball" children={(): React.JSX.Element => <PlaceholderScreen name="Snowball" />} />
      <Tab.Screen name="Settings" children={(): React.JSX.Element => <PlaceholderScreen name="Settings" />} />
    </Tab.Navigator>
  );
}

/**
 * MainTabNavigator.test.tsx — B7
 *
 * Asserts that all five tab labels are present in the rendered navigator.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Mock stack navigators loaded as tab screens ───────────────────────────────
// Note: jest.mock factories cannot reference out-of-scope non-mock variables.
// Use require() inside factories instead of JSX.

jest.mock('../DashboardStackNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    DashboardStackNavigator: () => React.createElement(View, { testID: 'dashboard-stack' }),
  };
});
jest.mock('../TransactionsStackNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    TransactionsStackNavigator: () => React.createElement(View, { testID: 'transactions-stack' }),
  };
});
jest.mock('../MetersStackNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { MetersStackNavigator: () => React.createElement(View, { testID: 'meters-stack' }) };
});
jest.mock('../SnowballStackNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { SnowballStackNavigator: () => React.createElement(View, { testID: 'snowball-stack' }) };
});
jest.mock('../../screens/settings/SettingsStackNavigator', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { SettingsStackNavigator: () => React.createElement(View, { testID: 'settings-stack' }) };
});

// ─── Mock shared components ───────────────────────────────────────────────────
jest.mock('../../components/shared/ToastHost', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { ToastHost: () => React.createElement(View, { testID: 'toast-host' }) };
});
jest.mock('../../components/shared/OfflineBanner', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { OfflineBanner: () => React.createElement(View, { testID: 'offline-banner' }) };
});

// ─── Mock vector icons ────────────────────────────────────────────────────────
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return ({ name }: { name: string }) => React.createElement(View, { testID: `icon-${name}` });
});

import { NavigationContainer } from '@react-navigation/native';
import { MainTabNavigator } from '../MainTabNavigator';

describe('MainTabNavigator', () => {
  it('renders all five tab labels', () => {
    const { getByText } = render(
      <NavigationContainer>
        <MainTabNavigator />
      </NavigationContainer>,
    );
    expect(getByText('Dashboard')).toBeTruthy();
    expect(getByText('Budget')).toBeTruthy();
    expect(getByText('Meters')).toBeTruthy();
    expect(getByText('Snowball')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
  });
});

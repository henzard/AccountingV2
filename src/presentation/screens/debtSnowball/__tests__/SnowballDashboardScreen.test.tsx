/**
 * SnowballDashboardScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../hooks/useDebts', () => ({
  useDebts: jest.fn().mockReturnValue({ debts: [], loading: false, reload: jest.fn() }),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string }) => unknown) =>
    sel({ householdId: 'hh-1' }),
  ),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    TouchableRipple: ({
      children,
      onPress,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
    }) => React.createElement('Pressable', { onPress }, children),
  };
});
jest.mock('../components/DebtPayoffBar', () => ({
  DebtPayoffBar: () => null,
}));
jest.mock('../components/PayoffProjectionCard', () => ({
  PayoffProjectionCard: () => null,
}));

const mockNavigate = jest.fn();
import { SnowballDashboardScreen } from '../SnowballDashboardScreen';

describe('SnowballDashboardScreen', () => {
  it('renders without crashing and shows FAB', () => {
    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('fab')).toBeTruthy();
  });

  it('pressing FAB navigates to AddDebt', () => {
    const { getByTestId } = render(
      <SnowballDashboardScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddDebt');
  });
});

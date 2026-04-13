/**
 * HouseholdPickerScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn(
    (
      sel: (s: {
        availableHouseholds: [];
        setHouseholdId: () => void;
        setPaydayDay: () => void;
      }) => unknown,
    ) =>
      sel({
        availableHouseholds: [],
        setHouseholdId: jest.fn(),
        setPaydayDay: jest.fn(),
      }),
  ),
}));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    TouchableRipple: ({
      children,
      onPress,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
    }) => React.createElement('Pressable', { onPress }, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement('Pressable', { onPress, testID }, children),
  };
});

const mockNavigate = jest.fn();
const mockReset = jest.fn();
import { HouseholdPickerScreen } from '../HouseholdPickerScreen';

describe('HouseholdPickerScreen', () => {
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <HouseholdPickerScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate, reset: mockReset } as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });
});

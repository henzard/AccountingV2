/**
 * TransactionListScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../hooks/useTransactions', () => ({
  useTransactions: jest
    .fn()
    .mockReturnValue({ transactions: [], loading: false, reload: jest.fn() }),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string; paydayDay: number }) => unknown) =>
    sel({ householdId: 'hh-1', paydayDay: 25 }),
  ),
}));
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
    IconButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID }),
  };
});

const mockNavigate = jest.fn();
import { TransactionListScreen } from '../TransactionListScreen';

describe('TransactionListScreen', () => {
  it('renders without crashing and shows FAB', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    expect(getByTestId('fab')).toBeTruthy();
  });

  it('pressing FAB navigates to AddTransaction', () => {
    const { getByTestId } = render(
      <TransactionListScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate } as never}
      />,
    );
    fireEvent.press(getByTestId('fab'));
    expect(mockNavigate).toHaveBeenCalledWith('AddTransaction');
  });
});

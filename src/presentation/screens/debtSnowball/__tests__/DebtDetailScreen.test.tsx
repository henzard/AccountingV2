/**
 * DebtDetailScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    Surface: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement('Pressable', { onPress, testID }, children),
    ActivityIndicator: () => React.createElement('View', { testID: 'loading' }),
  };
});
jest.mock('../components/DebtPayoffBar', () => ({
  DebtPayoffBar: () => null,
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
import { DebtDetailScreen } from '../DebtDetailScreen';

describe('DebtDetailScreen', () => {
  it('renders without crashing (loading state)', () => {
    const { getByTestId } = render(
      <DebtDetailScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
      />,
    );
    // Initially shows loading indicator while fetching debt
    expect(getByTestId('loading')).toBeTruthy();
  });
});

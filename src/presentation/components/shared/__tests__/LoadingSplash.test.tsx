import React from 'react';
import { render } from '@testing-library/react-native';
import { LoadingSplash } from '../LoadingSplash';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({
    children,
    testID,
    ...props
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    return React.createElement('View', { testID, ...props }, children);
  },
}));

describe('LoadingSplash', () => {
  it('renders loading-splash testID', () => {
    const { getByTestId } = render(<LoadingSplash />);
    expect(getByTestId('loading-splash')).toBeTruthy();
  });

  it('renders an ActivityIndicator', () => {
    const { UNSAFE_getByType } = render(<LoadingSplash />);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });
});

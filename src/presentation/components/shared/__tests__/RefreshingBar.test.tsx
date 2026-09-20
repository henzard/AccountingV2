/**
 * RefreshingBar — REG-9's thin, non-blanking reload indicator.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ProgressBar: ({
      testID,
      accessibilityLabel,
      accessibilityLiveRegion,
    }: {
      testID?: string;
      accessibilityLabel?: string;
      accessibilityLiveRegion?: string;
    }) =>
      React.createElement('View', {
        testID: testID ?? 'progress-bar',
        accessibilityLabel,
        accessibilityLiveRegion,
      }),
  };
});

import { RefreshingBar } from '../RefreshingBar';

describe('RefreshingBar', () => {
  it('renders nothing when refreshing is false', () => {
    const { queryByTestId } = render(<RefreshingBar refreshing={false} />);
    expect(queryByTestId('refreshing-bar')).toBeNull();
  });

  it('renders an indeterminate progress bar when refreshing is true', () => {
    const { getByTestId } = render(<RefreshingBar refreshing />);
    const bar = getByTestId('refreshing-bar');
    expect(bar).toBeTruthy();
    expect(bar.props.accessibilityLabel).toBe('Updating');
    expect(bar.props.accessibilityLiveRegion).toBe('polite');
  });
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
      React.createElement('Text', p, children),
    Button: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
      React.createElement('Pressable', { onPress, testID: 'try-again-btn' }, children),
  };
});

import { ScreenErrorBoundary } from '../ScreenErrorBoundary';

function ThrowingChild(): React.JSX.Element {
  throw new Error('Test crash');
}

function GoodChild(): React.JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return <RN.Text>Hello</RN.Text>;
}

describe('ScreenErrorBoundary', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it('renders children when no error', () => {
    const { getByText } = render(
      <ScreenErrorBoundary>
        <GoodChild />
      </ScreenErrorBoundary>,
    );
    expect(getByText('Hello')).toBeTruthy();
  });

  it('renders fallback UI when child throws', () => {
    const { getByText } = render(
      <ScreenErrorBoundary>
        <ThrowingChild />
      </ScreenErrorBoundary>,
    );
    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('shows error message in dev mode', () => {
    const { getByText } = render(
      <ScreenErrorBoundary>
        <ThrowingChild />
      </ScreenErrorBoundary>,
    );
    expect(getByText('Test crash')).toBeTruthy();
  });

  it('recovers after pressing Try Again', () => {
    let shouldThrow = true;
    function MaybeThrow(): React.JSX.Element {
      if (shouldThrow) throw new Error('Boom');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const RN = require('react-native');
      return <RN.Text>Recovered</RN.Text>;
    }

    const { getByTestId, getByText } = render(
      <ScreenErrorBoundary>
        <MaybeThrow />
      </ScreenErrorBoundary>,
    );

    expect(getByText('Something went wrong')).toBeTruthy();
    shouldThrow = false;
    fireEvent.press(getByTestId('try-again-btn'));
    expect(getByText('Recovered')).toBeTruthy();
  });
});

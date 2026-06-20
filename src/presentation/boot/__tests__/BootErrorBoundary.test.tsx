/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * BootErrorBoundary.test.tsx — error boundary test
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Share } from 'react-native';

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Text', { testID, ...p }, children),
    Button: ({
      children,
      onPress,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      [k: string]: unknown;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID, ...p },
        React.createElement('Text', {}, children),
      ),
  };
});

// ─── captureBoot mock ─────────────────────────────────────────────────────────
const mockCaptureBoot = jest.fn();
jest.mock('../../../infrastructure/monitoring/earlyCrashLog', () => ({
  captureBoot: (...args: unknown[]) => mockCaptureBoot(...args),
}));

// ─── themeStore mock ──────────────────────────────────────────────────────────
jest.mock('../../stores/themeStore', () => ({
  useThemeStore: {
    getState: () => ({ preference: 'light' }),
  },
}));

// ─── useAppTheme mock (for lightTheme/darkTheme) ──────────────────────────────
jest.mock('../../theme/useAppTheme', () => ({
  lightTheme: {
    colors: {
      surface: '#fff',
      error: '#f00',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      primary: '#00f',
    },
  },
  darkTheme: {
    colors: {
      surface: '#111',
      error: '#f88',
      onSurface: '#fff',
      onSurfaceVariant: '#999',
      primary: '#88f',
    },
  },
}));

import { BootErrorBoundary } from '../BootErrorBoundary';

function BombComponent(): React.JSX.Element {
  throw new Error('Test explosion');
}

function GoodComponent(): React.JSX.Element {
  const { View: RNView } = require('react-native');
  return <RNView testID="child-ok" />;
}

describe('BootErrorBoundary', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error occurs', () => {
    const { getByTestId } = render(
      <BootErrorBoundary>
        <GoodComponent />
      </BootErrorBoundary>,
    );
    expect(getByTestId('child-ok')).toBeTruthy();
  });

  it('shows crash UI when child throws', () => {
    const { getByText } = render(
      <BootErrorBoundary>
        <BombComponent />
      </BootErrorBoundary>,
    );
    expect(getByText('App crashed while rendering')).toBeTruthy();
    expect(getByText('Test explosion')).toBeTruthy();
  });

  it('calls captureBoot when error is caught', () => {
    render(
      <BootErrorBoundary>
        <BombComponent />
      </BootErrorBoundary>,
    );
    expect(mockCaptureBoot).toHaveBeenCalledWith('render (ErrorBoundary)', expect.any(Error));
  });

  it('share button invokes Share.share with error details', () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });

    const { getByText } = render(
      <BootErrorBoundary>
        <BombComponent />
      </BootErrorBoundary>,
    );
    fireEvent.press(getByText('Share'));
    expect(shareSpy).toHaveBeenCalledWith({
      message: expect.stringContaining('Test explosion'),
    });
    shareSpy.mockRestore();
  });

  it('uses light theme colors by default', () => {
    const { getByText } = render(
      <BootErrorBoundary>
        <BombComponent />
      </BootErrorBoundary>,
    );
    const title = getByText('App crashed while rendering');
    expect(title.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: '#f00' })]),
    );
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * BootRecoveryGate.test.tsx — boot recovery gate test
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

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

// ─── Theme mock ───────────────────────────────────────────────────────────────
jest.mock('../../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      surface: '#fff',
      error: '#f00',
      onSurface: '#000',
      onSurfaceVariant: '#666',
      primary: '#00f',
    },
  }),
}));

jest.mock('../../stores/themeStore', () => ({
  useThemeStore: jest.fn((sel: (s: object) => unknown) => sel({ preference: 'light' })),
}));

// ─── earlyCrashLog mock ───────────────────────────────────────────────────────
const mockReadLastCrash = jest.fn();
const mockClearLastCrash = jest.fn();
jest.mock('../../../infrastructure/monitoring/earlyCrashLog', () => ({
  readLastCrash: (...args: unknown[]) => mockReadLastCrash(...args),
  clearLastCrash: (...args: unknown[]) => mockClearLastCrash(...args),
}));

import { BootRecoveryGate } from '../BootRecoveryGate';

function ChildComponent(): React.JSX.Element {
  const { View } = require('react-native');
  return <View testID="child-content" />;
}

describe('BootRecoveryGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClearLastCrash.mockResolvedValue(undefined);
  });

  it('shows loading view while not yet checked', () => {
    mockReadLastCrash.mockReturnValue(new Promise(() => {}));

    const { toJSON } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );
    const tree = toJSON();
    expect(tree).toBeTruthy();
    expect(tree?.type).toBe('View');
  });

  it('renders children when no crash detected', async () => {
    mockReadLastCrash.mockResolvedValue(null);

    const { getByTestId } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );

    await waitFor(() => {
      expect(getByTestId('child-content')).toBeTruthy();
    });
  });

  it('shows recovery UI when crash detected', async () => {
    const crashRecord = {
      timestamp: '2026-06-19T10:00:00.000Z',
      step: 'App.tsx init',
      message: 'Module not found',
      stack: 'Error: Module not found\n    at boot.ts:42',
    };
    mockReadLastCrash.mockResolvedValue(crashRecord);

    const { getByText, queryByTestId } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );

    await waitFor(() => {
      expect(getByText('Previous boot crashed')).toBeTruthy();
    });
    expect(getByText('App.tsx init')).toBeTruthy();
    expect(getByText('Module not found')).toBeTruthy();
    expect(queryByTestId('child-content')).toBeNull();
  });

  it('clears crash and shows children after pressing Clear & continue', async () => {
    const crashRecord = {
      timestamp: '2026-06-19T10:00:00.000Z',
      step: 'boot',
      message: 'Crash',
      stack: 'stack',
    };
    mockReadLastCrash.mockResolvedValue(crashRecord);

    const { getByText, getByTestId } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );

    await waitFor(() => {
      expect(getByText('Previous boot crashed')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Clear & continue'));
    });

    expect(mockClearLastCrash).toHaveBeenCalled();
    await waitFor(() => {
      expect(getByTestId('child-content')).toBeTruthy();
    });
  });

  it('renders children even if readLastCrash throws', async () => {
    mockReadLastCrash.mockRejectedValue(new Error('Storage broken'));

    const { getByTestId } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );

    await waitFor(() => {
      expect(getByTestId('child-content')).toBeTruthy();
    });
  });
});

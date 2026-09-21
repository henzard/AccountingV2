/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * BootRecoveryGate.test.tsx — boot recovery gate test
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
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

  it('shows an inline fallback line when Share.share rejects (react-native-web with no navigator.share)', async () => {
    const crashRecord = {
      timestamp: '2026-06-19T10:00:00.000Z',
      step: 'App.tsx init',
      message: 'Module not found',
      stack: 'Error: Module not found\n    at boot.ts:42',
    };
    mockReadLastCrash.mockResolvedValue(crashRecord);
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockRejectedValueOnce(new Error('Share is not supported'));

    const { getByText, queryByText } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );

    await waitFor(() => {
      expect(getByText('Previous boot crashed')).toBeTruthy();
    });

    expect(queryByText(/Couldn't open sharing/)).toBeNull();

    await act(async () => {
      fireEvent.press(getByText('Share'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getByText("Couldn't open sharing — select and copy the text above.")).toBeTruthy();
    });

    shareSpy.mockRestore();
  });

  it('the crash step, message and stack are selectable so they can be copied without sharing', async () => {
    const crashRecord = {
      timestamp: '2026-06-19T10:00:00.000Z',
      step: 'App.tsx init',
      message: 'Module not found',
      stack: 'Error: Module not found\n    at boot.ts:42',
    };
    mockReadLastCrash.mockResolvedValue(crashRecord);

    const { getByText } = render(
      <BootRecoveryGate>
        <ChildComponent />
      </BootRecoveryGate>,
    );

    await waitFor(() => {
      expect(getByText('Previous boot crashed')).toBeTruthy();
    });

    expect(getByText('App.tsx init').props.selectable).toBe(true);
    expect(getByText('Module not found').props.selectable).toBe(true);
    expect(getByText(crashRecord.stack).props.selectable).toBe(true);
  });
});

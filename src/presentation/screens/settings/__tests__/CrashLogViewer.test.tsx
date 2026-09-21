/**
 * CrashLogViewer.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

const mockReadLastCrash = jest.fn();
const mockClearLastCrash = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../infrastructure/monitoring/earlyCrashLog', () => ({
  readLastCrash: (...args: unknown[]) => mockReadLastCrash(...args),
  clearLastCrash: (...args: unknown[]) => mockClearLastCrash(...args),
}));

// SET-4: handleCopy fires Share.share and must await/catch it rather than
// firing-and-forgetting. Spying (rather than jest.mock('react-native', ...))
// avoids pulling in native-only pieces of the real RN module (e.g. DevMenu)
// that this jest-expo environment can't load.
import { Share } from 'react-native';
const mockShare = jest.spyOn(Share, 'share');

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);
  const Button = ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID },
      React.createElement('Text', {}, children),
    );
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  const Divider = () => React.createElement('View');
  return { Text, Button, Surface, Divider };
});

import { CrashLogViewer } from '../CrashLogViewer';

const mockRecord = {
  timestamp: '2026-06-10T08:15:00.000Z',
  step: 'supabase-init',
  message: 'Failed to initialize Supabase client',
  stack: 'Error: Failed to initialize Supabase client\n    at init (bootstrap.ts:42)',
};

describe('CrashLogViewer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShare.mockResolvedValue({ action: 'sharedAction' });
  });

  it('shows loading text while fetching crash record', () => {
    mockReadLastCrash.mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<CrashLogViewer />);
    expect(getByText('Loading…')).toBeTruthy();
  });

  it('shows empty state when no crash record exists', async () => {
    mockReadLastCrash.mockResolvedValue(null);
    const { getByText } = render(<CrashLogViewer />);
    await waitFor(() => {
      expect(getByText('No crash record')).toBeTruthy();
    });
  });

  it('renders crash record details when populated', async () => {
    mockReadLastCrash.mockResolvedValue(mockRecord);
    const { getByText, getByTestId } = render(<CrashLogViewer />);
    await waitFor(() => {
      expect(getByText(mockRecord.timestamp)).toBeTruthy();
      expect(getByText('supabase-init')).toBeTruthy();
      expect(getByText(mockRecord.message)).toBeTruthy();
      expect(getByTestId('crash-stack-text')).toBeTruthy();
    });
  });

  it('renders share and clear buttons when record exists', async () => {
    mockReadLastCrash.mockResolvedValue(mockRecord);
    const { getByTestId } = render(<CrashLogViewer />);
    await waitFor(() => {
      expect(getByTestId('crash-copy-button')).toBeTruthy();
      expect(getByTestId('crash-clear-button')).toBeTruthy();
    });
  });

  it('clears record and shows empty state on clear button press', async () => {
    mockReadLastCrash.mockResolvedValue(mockRecord);
    const { getByTestId, getByText } = render(<CrashLogViewer />);
    await waitFor(() => {
      expect(getByTestId('crash-clear-button')).toBeTruthy();
    });
    fireEvent.press(getByTestId('crash-clear-button'));
    await waitFor(() => {
      expect(mockClearLastCrash).toHaveBeenCalled();
      expect(getByText('No crash record')).toBeTruthy();
    });
  });

  // SET-4 — handleCopy previously fired Share.share without awaiting or
  // catching it, then unconditionally showed "Shared!" regardless of outcome.
  describe('SET-4 — awaited, honest share result', () => {
    it('awaits Share.share and shows "Shared!" only when it actually shares', async () => {
      mockReadLastCrash.mockResolvedValue(mockRecord);
      mockShare.mockResolvedValue({ action: 'sharedAction' });
      const { getByTestId, getByText } = render(<CrashLogViewer />);
      await waitFor(() => expect(getByTestId('crash-copy-button')).toBeTruthy());

      fireEvent.press(getByTestId('crash-copy-button'));

      await waitFor(() => expect(mockShare).toHaveBeenCalled());
      await waitFor(() => expect(getByText('Shared!')).toBeTruthy());
    });

    it('does not show "Shared!" when the share sheet is dismissed (iOS dismissedAction)', async () => {
      mockReadLastCrash.mockResolvedValue(mockRecord);
      mockShare.mockResolvedValue({ action: 'dismissedAction' });
      const { getByTestId, queryByText } = render(<CrashLogViewer />);
      await waitFor(() => expect(getByTestId('crash-copy-button')).toBeTruthy());

      fireEvent.press(getByTestId('crash-copy-button'));

      await waitFor(() => expect(mockShare).toHaveBeenCalled());
      expect(queryByText('Shared!')).toBeNull();
    });

    it('shows a failure message instead of "Shared!" when Share.share rejects', async () => {
      mockReadLastCrash.mockResolvedValue(mockRecord);
      mockShare.mockRejectedValue(new Error('no share target'));
      const { getByTestId, queryByText } = render(<CrashLogViewer />);
      await waitFor(() => expect(getByTestId('crash-copy-button')).toBeTruthy());

      fireEvent.press(getByTestId('crash-copy-button'));

      await waitFor(() => expect(getByTestId('crash-share-error')).toBeTruthy());
      expect(getByTestId('crash-share-error')).toHaveTextContent(
        "Couldn't share — select and copy the text above instead.",
      );
      expect(queryByText('Shared!')).toBeNull();
    });
  });
});

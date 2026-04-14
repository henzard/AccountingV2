import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({
    key: 'SlipProcessing',
    name: 'SlipProcessing',
    params: { householdId: 'hh-1', createdBy: 'user-1', frameLocalUris: ['file:///x.jpg'] },
  }),
}));

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
  const ActivityIndicator = ({ testID, ...p }: { testID?: string; [k: string]: unknown }) =>
    React.createElement('View', { testID, ...p });
  return { Text, Button, ActivityIndicator };
});

import { SlipProcessingScreen } from '../SlipProcessingScreen';

describe('SlipProcessingScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
  });

  it('shows uploading progress label', () => {
    const startScan = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId } = render(
      <SlipProcessingScreen
        startScan={startScan}
        progress={{ stage: 'uploading', slipId: 's1' }}
      />,
    );
    expect(getByTestId('progress-label').props.children).toBe('Uploading…');
  });

  it('shows extracting label when extracting', () => {
    const startScan = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId } = render(
      <SlipProcessingScreen
        startScan={startScan}
        progress={{ stage: 'extracting', slipId: 's1' }}
      />,
    );
    expect(getByTestId('progress-label').props.children).toBe('Reading slip…');
  });

  it('shows error message and retry button on failure', () => {
    const startScan = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId } = render(
      <SlipProcessingScreen
        startScan={startScan}
        progress={{
          stage: 'failed',
          slipId: 's1',
          error: { code: 'SLIP_OPENAI_UNREACHABLE', message: 'OpenAI down' },
        }}
      />,
    );
    // Now shows human-readable copy instead of raw error message
    expect(getByTestId('error-message').props.children).toBe(
      'Slip service is temporarily unreachable. Try again, or log manually.',
    );
    expect(getByTestId('retry-button')).toBeTruthy();
  });

  it('navigates to SlipConfirm on success', async () => {
    const startScan = jest
      .fn()
      .mockResolvedValue({ success: true, data: { slipId: 's1', extraction: {} } });
    render(
      <SlipProcessingScreen startScan={startScan} progress={{ stage: 'done', slipId: 's1' }} />,
    );
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        'SlipConfirm',
        expect.objectContaining({ slipId: 's1' }),
      );
    });
  });

  it('shows cancel button during processing', () => {
    const startScan = jest.fn().mockResolvedValue({ success: false });
    const { getByTestId } = render(
      <SlipProcessingScreen
        startScan={startScan}
        progress={{ stage: 'uploading', slipId: 's1' }}
      />,
    );
    expect(getByTestId('cancel-button')).toBeTruthy();
  });
});

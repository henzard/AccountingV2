import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock('expo-camera');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

let mockIsOnline = true;
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: mockIsOnline }),
}));

jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: () => void }) => unknown) =>
    sel({ enqueue: jest.fn() }),
  ),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID },
        React.createElement('Text', null, children),
      ),
  };
});

import { SlipCaptureScreen } from '../SlipCaptureScreen';
import { useCameraPermissions } from 'expo-camera';

describe('SlipCaptureScreen', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockIsOnline = true;
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: true, canAskAgain: true },
      jest.fn().mockResolvedValue({ granted: true }),
    ]);
  });

  it('renders shutter button when permission granted', () => {
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByTestId('shutter-button')).toBeTruthy();
  });

  it('shows request-permission button when permission not granted', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: true },
      jest.fn().mockResolvedValue({ granted: true }),
    ]);
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByTestId('request-permission')).toBeTruthy();
  });

  it('shows open-settings link when canAskAgain is false', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: false },
      jest.fn(),
    ]);
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByTestId('open-settings')).toBeTruthy();
  });

  it('shows coachmark on first use', async () => {
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    await waitFor(() => {
      expect(getByTestId('coachmark')).toBeTruthy();
    });
  });

  it('shows offline banner when offline', () => {
    mockIsOnline = false;
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByTestId('offline-banner')).toBeTruthy();
  });

  it('shutter is disabled when offline', () => {
    mockIsOnline = false;
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    const shutter = getByTestId('shutter-button');
    expect(shutter.props.accessibilityState?.disabled ?? shutter.props.disabled).toBeTruthy();
  });

  it('done button is disabled when no frames captured', () => {
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    const doneButton = getByTestId('done-button');
    expect(doneButton.props.accessibilityState?.disabled ?? doneButton.props.disabled).toBeTruthy();
  });

  it('shows daily counter', () => {
    const { getByTestId } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByTestId('daily-counter')).toBeTruthy();
  });

  it('shutter button has accessibility label "Take photo"', () => {
    const { getByLabelText } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByLabelText('Take photo')).toBeTruthy();
  });

  it('shutter button has correct accessibility state when disabled', () => {
    mockIsOnline = false;
    const { getByLabelText } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    const shutter = getByLabelText('Take photo');
    expect(shutter.props.accessibilityState?.disabled).toBe(true);
  });

  it('done button has accessibility label based on photo count', () => {
    const { getByLabelText } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByLabelText('Process 0 photos')).toBeTruthy();
  });

  it('done button has correct accessibility state when disabled', () => {
    const { getByLabelText } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    const done = getByLabelText('Process 0 photos');
    expect(done.props.accessibilityState?.disabled).toBe(true);
  });

  it('grant permission button has accessibility label', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: true },
      jest.fn().mockResolvedValue({ granted: true }),
    ]);
    const { getByLabelText } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByLabelText('Grant camera permission')).toBeTruthy();
  });

  it('open settings button has accessibility label', () => {
    (useCameraPermissions as jest.Mock).mockReturnValue([
      { granted: false, canAskAgain: false },
      jest.fn(),
    ]);
    const { getByLabelText } = render(<SlipCaptureScreen householdId="hh-1" createdBy="user-1" />);
    expect(getByLabelText('Open device settings to grant camera permission')).toBeTruthy();
  });
});

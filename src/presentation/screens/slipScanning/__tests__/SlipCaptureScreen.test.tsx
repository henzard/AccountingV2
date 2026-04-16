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
});

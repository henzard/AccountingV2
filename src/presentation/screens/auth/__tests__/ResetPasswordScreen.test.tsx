/**
 * ResetPasswordScreen.test.tsx
 *
 * Rendered by RootNavigator while `passwordRecoveryPending` is true. Lets
 * the user set a new password via `supabase.auth.updateUser({ password })`,
 * then clears the pending flag so RootNavigator falls back to normal
 * session-based routing (see App.tsx's deep-link handler for how the flag
 * gets set in the first place).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('Text', p, children);
  const TextInput = ({
    label,
    value,
    onChangeText,
    testID,
    ...p
  }: {
    label?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('TextInput', { testID: testID ?? label, value, onChangeText, ...p });
  TextInput.Icon = ({ onPress }: { onPress?: () => void }) =>
    React.createElement('Pressable', { onPress, testID: 'password-toggle' });
  const Button = ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => React.createElement('Pressable', { onPress, testID }, children);
  const HelperText = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement('Text', { testID }, children);
  return { Text, TextInput, Button, HelperText };
});

const mockUpdateUser = jest.fn();
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    },
  },
}));

const mockSetPasswordRecoveryPending = jest.fn();
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn(
    (sel: (s: { setPasswordRecoveryPending: typeof mockSetPasswordRecoveryPending }) => unknown) =>
      sel({ setPasswordRecoveryPending: mockSetPasswordRecoveryPending }),
  ),
}));

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.AccessibilityInfo = {
    announceForAccessibility: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    isReduceMotionEnabled: jest.fn().mockResolvedValue(false),
    isScreenReaderEnabled: jest.fn().mockResolvedValue(false),
  };
  return rn;
});

import { ResetPasswordScreen } from '../ResetPasswordScreen';

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
  });

  it('renders new-password and confirm fields', () => {
    const { getByTestId } = render(<ResetPasswordScreen />);
    expect(getByTestId('reset-password-new')).toBeTruthy();
    expect(getByTestId('reset-password-confirm')).toBeTruthy();
  });

  it('shows a validation error without calling supabase when password is too short', async () => {
    const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'short');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'short');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(queryByTestId('reset-password-error')).toBeTruthy();
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('shows a validation error when passwords do not match', async () => {
    const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'longenoughpassword');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'somethingelse123');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(queryByTestId('reset-password-error')).toBeTruthy();
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser with the new password when valid', async () => {
    const { getByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'longenoughpassword');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'longenoughpassword');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'longenoughpassword' });
    });
  });

  it('shows a success state and clears passwordRecoveryPending on success', async () => {
    const { getByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'longenoughpassword');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'longenoughpassword');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(getByTestId('reset-password-success')).toBeTruthy();
    });
    await waitFor(() => {
      expect(mockSetPasswordRecoveryPending).toHaveBeenCalledWith(false);
    });
  });

  it('shows an error message when updateUser fails and does not clear the pending flag', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Session expired' } });
    const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'longenoughpassword');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'longenoughpassword');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(queryByTestId('reset-password-error')).toBeTruthy();
    });
    expect(queryByTestId('reset-password-success')).toBeNull();
    expect(mockSetPasswordRecoveryPending).not.toHaveBeenCalled();
  });
});

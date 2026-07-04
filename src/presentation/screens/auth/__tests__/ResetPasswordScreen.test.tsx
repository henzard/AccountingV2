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
const mockSignOut = jest.fn();
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}));

const mockSetPasswordRecoveryPending = jest.fn();
const mockSetPasswordRecoveryError = jest.fn();
// Mutable, read by the useAppStore mock below on every selector call so
// individual tests can flip `passwordRecoveryError` without needing to
// re-mock the whole module. Name starts with "mock" so babel-plugin-
// jest-hoist allows referencing it from inside the (hoisted) jest.mock
// factory further down -- same convention the rest of this file already
// uses for `mockUpdateUser`/`mockSignOut`.
const mockAppStoreState: { passwordRecoveryError: string | null } = {
  passwordRecoveryError: null,
};
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn(
    (
      sel: (s: {
        setPasswordRecoveryPending: typeof mockSetPasswordRecoveryPending;
        setPasswordRecoveryError: typeof mockSetPasswordRecoveryError;
        passwordRecoveryError: string | null;
      }) => unknown,
    ) =>
      sel({
        setPasswordRecoveryPending: mockSetPasswordRecoveryPending,
        setPasswordRecoveryError: mockSetPasswordRecoveryError,
        passwordRecoveryError: mockAppStoreState.passwordRecoveryError,
      }),
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
    mockSignOut.mockResolvedValue({ error: null });
    mockAppStoreState.passwordRecoveryError = null;
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

  it('shows a success state, signs out, and clears passwordRecoveryPending on success (clean re-auth, not a silent bootstrap)', async () => {
    const { getByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'longenoughpassword');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'longenoughpassword');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(getByTestId('reset-password-success')).toBeTruthy();
    });
    // Signs out the temporary recovery session (App.tsx's auth listener
    // never ran initSessionOnce for it -- see ResetPasswordScreen's doc
    // comment) BEFORE clearing the flag, so RootNavigator lands the user on
    // the normal Auth flow to re-authenticate with their new password.
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
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

  it('"Back to sign in" signs out and clears both recovery flags, even after a failed updateUser', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Session expired' } });
    const { getByTestId } = render(<ResetPasswordScreen />);
    fireEvent.changeText(getByTestId('reset-password-new'), 'longenoughpassword');
    fireEvent.changeText(getByTestId('reset-password-confirm'), 'longenoughpassword');
    fireEvent.press(getByTestId('reset-password-submit'));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalled();
    });

    fireEvent.press(getByTestId('reset-password-back-to-signin'));

    expect(mockSignOut).toHaveBeenCalled();
    expect(mockSetPasswordRecoveryError).toHaveBeenCalledWith(null);
    expect(mockSetPasswordRecoveryPending).toHaveBeenCalledWith(false);
  });

  describe('invalid/expired recovery link (passwordRecoveryError set)', () => {
    beforeEach(() => {
      mockAppStoreState.passwordRecoveryError =
        'This reset link is invalid or expired — request a new one.';
    });

    it('shows the error and a "Back to sign in" affordance instead of the form', () => {
      const { getByTestId, queryByTestId } = render(<ResetPasswordScreen />);
      expect(getByTestId('reset-password-link-error-text')).toBeTruthy();
      expect(getByTestId('reset-password-back-to-signin')).toBeTruthy();
      expect(queryByTestId('reset-password-new')).toBeNull();
      expect(queryByTestId('reset-password-submit')).toBeNull();
    });

    it('"Back to sign in" signs out and clears the error + pending flags', () => {
      const { getByTestId } = render(<ResetPasswordScreen />);
      fireEvent.press(getByTestId('reset-password-back-to-signin'));

      expect(mockSignOut).toHaveBeenCalled();
      expect(mockSetPasswordRecoveryError).toHaveBeenCalledWith(null);
      expect(mockSetPasswordRecoveryPending).toHaveBeenCalledWith(false);
    });
  });
});

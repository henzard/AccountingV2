/**
 * ForgotPasswordScreen.test.tsx
 *
 * Covers the "locked out with no recovery path" deep-review fix: a
 * forgot-password request flow that calls
 * `supabase.auth.resetPasswordForEmail` and shows a check-your-email
 * confirmation, without ever revealing whether the email is registered.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

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
  const Button = ({
    children,
    onPress,
    testID,
    accessibilityLabel,
    accessibilityRole,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityRole?: string;
  }) =>
    React.createElement(
      'Pressable',
      { onPress, testID, accessibilityLabel, accessibilityRole },
      children,
    );
  const HelperText = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    React.createElement('Text', { testID }, children);
  return { Text, TextInput, Button, HelperText };
});

const mockResetPasswordForEmail = jest.fn();
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args),
    },
  },
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

import { ForgotPasswordScreen } from '../ForgotPasswordScreen';

describe('ForgotPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it('renders the email field and submit button', () => {
    const { getByTestId } = render(<ForgotPasswordScreen />);
    expect(getByTestId('forgot-password-email')).toBeTruthy();
    expect(getByTestId('forgot-password-submit')).toBeTruthy();
  });

  it('shows a validation error without calling supabase when email is empty', async () => {
    const { getByTestId, queryByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.press(getByTestId('forgot-password-submit'));
    await waitFor(() => {
      expect(queryByTestId('forgot-password-error')).toBeTruthy();
    });
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('calls resetPasswordForEmail with the trimmed, lowercased email and a redirectTo', async () => {
    const { getByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId('forgot-password-email'), '  User@Example.COM  ');
    fireEvent.press(getByTestId('forgot-password-submit'));
    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
        redirectTo: 'accountingv2://reset-password',
      });
    });
  });

  it('shows a check-your-email confirmation on success', async () => {
    const { getByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId('forgot-password-email'), 'user@example.com');
    fireEvent.press(getByTestId('forgot-password-submit'));
    await waitFor(() => {
      expect(getByTestId('forgot-password-check-email')).toBeTruthy();
    });
  });

  it('shows an error message when the request fails', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: { message: 'Rate limited' } });
    const { getByTestId, queryByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId('forgot-password-email'), 'user@example.com');
    fireEvent.press(getByTestId('forgot-password-submit'));
    await waitFor(() => {
      expect(queryByTestId('forgot-password-error')).toBeTruthy();
    });
    expect(queryByTestId('forgot-password-check-email')).toBeNull();
  });

  it('navigates back to Login from the back link', () => {
    const { getByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.press(getByTestId('forgot-password-back-link'));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });

  it('navigates back to Login from the confirmation screen', async () => {
    const { getByTestId } = render(<ForgotPasswordScreen />);
    fireEvent.changeText(getByTestId('forgot-password-email'), 'user@example.com');
    fireEvent.press(getByTestId('forgot-password-submit'));
    await waitFor(() => {
      expect(getByTestId('forgot-password-check-email')).toBeTruthy();
    });
    fireEvent.press(getByTestId('forgot-password-back-to-signin'));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });
});

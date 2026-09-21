/**
 * ForgotPasswordScreen.test.tsx
 *
 * Covers the "locked out with no recovery path" deep-review fix: a
 * forgot-password request flow that calls
 * `supabase.auth.resetPasswordForEmail` and shows a check-your-email
 * confirmation, without ever revealing whether the email is registered.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

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
    disabled,
    loading,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityRole?: string;
    disabled?: boolean;
    loading?: boolean;
  }) =>
    React.createElement(
      'Pressable',
      { onPress, testID, accessibilityLabel, accessibilityRole, disabled, loading },
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

  // AUTH-1: raw Supabase error text must never reach the helper text.
  describe('AUTH-1: friendly error copy', () => {
    it('shows a friendly offline message instead of the raw fetch error', async () => {
      mockResetPasswordForEmail.mockResolvedValue({ error: { message: 'Failed to fetch' } });
      const { getByTestId } = render(<ForgotPasswordScreen />);
      fireEvent.changeText(getByTestId('forgot-password-email'), 'user@example.com');
      fireEvent.press(getByTestId('forgot-password-submit'));
      await waitFor(() => {
        expect(getByTestId('forgot-password-error').props.children).toMatch(/offline|connection/i);
      });
    });
  });

  // AUTH-2: resend + edit affordances on the check-your-email state.
  describe('AUTH-2: resend email + edit email on the check-your-email state', () => {
    async function getToCheckEmail() {
      const utils = render(<ForgotPasswordScreen />);
      fireEvent.changeText(utils.getByTestId('forgot-password-email'), '  User@Example.COM  ');
      fireEvent.press(utils.getByTestId('forgot-password-submit'));
      await waitFor(() => {
        expect(utils.queryByTestId('forgot-password-check-email')).toBeTruthy();
      });
      return utils;
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    it('re-issues resetPasswordForEmail with the same normalised email and redirectTo on resend', async () => {
      jest.useFakeTimers();
      const { getByTestId } = await getToCheckEmail();
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      await act(async () => {
        fireEvent.press(getByTestId('forgot-password-resend'));
      });
      expect(mockResetPasswordForEmail).toHaveBeenLastCalledWith('user@example.com', {
        redirectTo: 'accountingv2://reset-password',
      });
    });

    it('disables resend during the 30s cooldown, then re-enables it', async () => {
      jest.useFakeTimers();
      const { getByTestId } = await getToCheckEmail();
      expect(getByTestId('forgot-password-resend').props.disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(29000);
      });
      expect(getByTestId('forgot-password-resend').props.disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(getByTestId('forgot-password-resend').props.disabled).toBe(false);
    });

    it('pressing resend during cooldown does not call resetPasswordForEmail again', async () => {
      const { getByTestId } = await getToCheckEmail();
      const callsBefore = mockResetPasswordForEmail.mock.calls.length;
      fireEvent.press(getByTestId('forgot-password-resend'));
      expect(mockResetPasswordForEmail.mock.calls.length).toBe(callsBefore);
    });

    it('shows a friendly error when resend fails', async () => {
      jest.useFakeTimers();
      const { getByTestId } = await getToCheckEmail();
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      mockResetPasswordForEmail.mockResolvedValue({ error: { message: 'Rate limit exceeded' } });
      await act(async () => {
        fireEvent.press(getByTestId('forgot-password-resend'));
      });
      expect(getByTestId('forgot-password-resend-error').props.children).toMatch(
        /too many attempts/i,
      );
    });

    it('"Wrong email? Edit" returns to the form with the typed email still filled', async () => {
      const { getByTestId } = await getToCheckEmail();
      fireEvent.press(getByTestId('forgot-password-edit-email'));
      expect(getByTestId('forgot-password-email').props.value).toBe('  User@Example.COM  ');
    });

    it('clears the cooldown timer on unmount', async () => {
      jest.useFakeTimers();
      const { unmount } = await getToCheckEmail();
      unmount();
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
    });
  });
});

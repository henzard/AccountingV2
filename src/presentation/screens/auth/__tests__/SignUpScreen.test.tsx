/**
 * SignUpScreen.test.tsx — B2 component test
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
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
    right,
    secureTextEntry,
    ...p
  }: {
    label?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    testID?: string;
    right?: React.ReactNode;
    secureTextEntry?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TextInput',
      {
        testID: testID ?? label,
        value,
        onChangeText,
        secureTextEntry,
        ...p,
      },
      right,
    );
  TextInput.Affix = () => null;
  TextInput.Icon = ({
    onPress,
    testID,
    icon,
  }: {
    onPress?: () => void;
    testID?: string;
    icon?: string;
    accessibilityLabel?: string;
  }) =>
    React.createElement('TouchableOpacity', {
      testID: testID ?? `icon-${icon}`,
      onPress,
    });
  const Button = ({
    children,
    onPress,
    testID,
    disabled,
    loading,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    disabled?: boolean;
    loading?: boolean;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, disabled, loading },
      React.createElement('Text', {}, children),
    );
  const HelperText = ({
    children,
    testID,
    visible,
  }: {
    children?: React.ReactNode;
    testID?: string;
    visible?: boolean;
    type?: string;
  }) => (visible !== false ? React.createElement('Text', { testID }, children) : null);
  const ActivityIndicator = () => React.createElement('View', { testID: 'activity-indicator' });
  return { Text, TextInput, Button, HelperText, ActivityIndicator };
});

// ─── supabase mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      resend: jest.fn(),
    },
  },
}));

import { SignUpScreen } from '../SignUpScreen';
import { supabase } from '../../../../data/remote/supabaseClient';

const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockResend = supabase.auth.resend as jest.Mock;

describe('SignUpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResend.mockResolvedValue({ error: null });
  });

  it('renders title and submit button', () => {
    const { getByText } = render(<SignUpScreen />);
    expect(getByText('Create account')).toBeTruthy();
    expect(getByText('Create Account')).toBeTruthy();
  });

  it('shows error when passwords do not match', async () => {
    const { getByTestId, getByText, queryByTestId } = render(<SignUpScreen />);
    fireEvent.changeText(getByTestId('signup-email'), 'test@example.com');
    fireEvent.changeText(getByTestId('signup-password'), 'password123');
    fireEvent.changeText(getByTestId('signup-confirm-password'), 'different');
    fireEvent.press(getByText('Create Account'));
    await waitFor(() => {
      expect(queryByTestId('signup-error')).toBeTruthy();
    });
  });

  it('shows pending-session state when signUp returns a session immediately', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1' }, session: { access_token: 'tok' } },
      error: null,
    });
    const { getByTestId, getByText, queryByTestId } = render(<SignUpScreen />);
    fireEvent.changeText(getByTestId('signup-email'), 'user@example.com');
    fireEvent.changeText(getByTestId('signup-password'), 'securepass1');
    fireEvent.changeText(getByTestId('signup-confirm-password'), 'securepass1');
    fireEvent.press(getByText('Create Account'));
    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'securepass1',
      });
      // Form should be replaced by the non-interactive pending-session view
      expect(queryByTestId('signup-success')).toBeTruthy();
      // navigate must NOT have been called — RootNavigator transitions via auth listener
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  it('shows check-email state when signUp returns no session (email confirmation required)', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'u1' }, session: null },
      error: null,
    });
    const { getByTestId, getByText, queryByTestId } = render(<SignUpScreen />);
    fireEvent.changeText(getByTestId('signup-email'), 'user@example.com');
    fireEvent.changeText(getByTestId('signup-password'), 'securepass1');
    fireEvent.changeText(getByTestId('signup-confirm-password'), 'securepass1');
    fireEvent.press(getByText('Create Account'));
    await waitFor(() => {
      expect(queryByTestId('signup-check-email')).toBeTruthy();
      expect(queryByTestId('signup-success')).toBeNull();
    });
    // Back to sign in button navigates to Login
    fireEvent.press(getByTestId('back-to-signin'));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });

  it('shows supabase error message on failure', async () => {
    mockSignUp.mockResolvedValue({ error: { message: 'Email already registered' } });
    const { getByTestId, getByText, queryByTestId } = render(<SignUpScreen />);
    fireEvent.changeText(getByTestId('signup-email'), 'user@example.com');
    fireEvent.changeText(getByTestId('signup-password'), 'securepass1');
    fireEvent.changeText(getByTestId('signup-confirm-password'), 'securepass1');
    fireEvent.press(getByText('Create Account'));
    await waitFor(() => {
      expect(queryByTestId('signup-error')).toBeTruthy();
    });
  });

  it('toggles password visibility when password icon is pressed', () => {
    const { UNSAFE_root } = render(<SignUpScreen />);
    const inputs = UNSAFE_root.findAllByType('TextInput');
    const passwordInput = inputs[1]; // Password field is second (after email)

    // Initially secureTextEntry should be true
    expect(passwordInput.props.secureTextEntry).toBe(true);

    // Find and press the password icon toggle
    const icons = UNSAFE_root.findAllByType('TouchableOpacity');
    const passwordIcon = icons.find((icon: { props: { testID?: string } }) =>
      icon.props.testID?.includes('eye'),
    );
    expect(passwordIcon).toBeTruthy();

    fireEvent.press(passwordIcon!);

    // After toggle, secureTextEntry should be false
    expect(passwordInput.props.secureTextEntry).toBe(false);

    // Press again to toggle back
    fireEvent.press(passwordIcon!);
    expect(passwordInput.props.secureTextEntry).toBe(true);
  });

  it('toggles confirm password visibility when confirm password icon is pressed', () => {
    const { UNSAFE_root } = render(<SignUpScreen />);
    const inputs = UNSAFE_root.findAllByType('TextInput');
    const confirmInput = inputs[2]; // Confirm password field is third

    // Initially secureTextEntry should be true
    expect(confirmInput.props.secureTextEntry).toBe(true);

    // Find and press the confirm password icon toggle
    const icons = UNSAFE_root.findAllByType('TouchableOpacity');
    const confirmIcon = icons.find(
      (icon: { props: { testID?: string } }, idx: number) =>
        icon.props.testID?.includes('eye') && idx > 0, // Skip first eye icon (password)
    );
    expect(confirmIcon).toBeTruthy();

    fireEvent.press(confirmIcon!);

    // After toggle, secureTextEntry should be false
    expect(confirmInput.props.secureTextEntry).toBe(false);

    // Press again to toggle back
    fireEvent.press(confirmIcon!);
    expect(confirmInput.props.secureTextEntry).toBe(true);
  });

  // AUTH-1: raw Supabase errors must never reach the screen verbatim.
  describe('AUTH-1: friendly error copy', () => {
    it('shows friendly fallback copy for an unrecognised Supabase error, not its raw message', async () => {
      mockSignUp.mockResolvedValue({
        error: { message: 'relation "auth.users" does not exist', code: 'unexpected_failure' },
      });
      const { getByTestId, getByText } = render(<SignUpScreen />);
      fireEvent.changeText(getByTestId('signup-email'), 'user@example.com');
      fireEvent.changeText(getByTestId('signup-password'), 'securepass1');
      fireEvent.changeText(getByTestId('signup-confirm-password'), 'securepass1');
      fireEvent.press(getByText('Create Account'));
      await waitFor(() => {
        const text = getByTestId('signup-error').props.children;
        expect(text).not.toMatch(/relation "auth.users"/);
        expect(text).toMatch(/something went wrong/i);
      });
    });

    it('shows fixed app copy for a weak password (not the provider text, not the generic fallback)', async () => {
      mockSignUp.mockResolvedValue({
        error: { message: 'Password should be at least 6 characters.', code: 'weak_password' },
      });
      const { getByTestId, getByText } = render(<SignUpScreen />);
      fireEvent.changeText(getByTestId('signup-email'), 'user@example.com');
      fireEvent.changeText(getByTestId('signup-password'), 'securepass1');
      fireEvent.changeText(getByTestId('signup-confirm-password'), 'securepass1');
      fireEvent.press(getByText('Create Account'));
      await waitFor(() => {
        expect(getByTestId('signup-error').props.children).toBe(
          'That password is too weak. Use at least 8 characters.',
        );
      });
    });
  });

  // AUTH-3: the confirmation copy must show the normalised (trim+lowercase)
  // email actually sent, not whatever the user typed.
  describe('AUTH-3: confirmation shows the normalised email', () => {
    it('shows the trimmed, lowercased email in the check-your-email copy', async () => {
      mockSignUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
      const { getByTestId, getByText } = render(<SignUpScreen />);
      fireEvent.changeText(getByTestId('signup-email'), '  User@Example.COM  ');
      fireEvent.changeText(getByTestId('signup-password'), 'securepass1');
      fireEvent.changeText(getByTestId('signup-confirm-password'), 'securepass1');
      fireEvent.press(getByText('Create Account'));
      await waitFor(() => {
        expect(getByText(/We've sent a confirmation link to user@example\.com/)).toBeTruthy();
      });
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'securepass1',
      });
    });
  });

  // AUTH-2: resend + edit affordances on the check-your-email state.
  describe('AUTH-2: resend email + edit email on the check-your-email state', () => {
    async function getToCheckEmail() {
      mockSignUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
      const utils = render(<SignUpScreen />);
      fireEvent.changeText(utils.getByTestId('signup-email'), 'user@example.com');
      fireEvent.changeText(utils.getByTestId('signup-password'), 'securepass1');
      fireEvent.changeText(utils.getByTestId('signup-confirm-password'), 'securepass1');
      fireEvent.press(utils.getByText('Create Account'));
      await waitFor(() => {
        expect(utils.queryByTestId('signup-check-email')).toBeTruthy();
      });
      return utils;
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    it('calls supabase.auth.resend with type "signup" and the normalised email', async () => {
      jest.useFakeTimers();
      const { getByTestId } = await getToCheckEmail();
      // Skip past the initial post-signup cooldown so the button is live.
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      await act(async () => {
        fireEvent.press(getByTestId('signup-resend'));
      });
      expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'user@example.com' });
    });

    it('disables the resend button for a 30s cooldown after a successful resend, then re-enables it', async () => {
      jest.useFakeTimers();
      const { getByTestId } = await getToCheckEmail();

      // The cooldown also starts right after the initial signUp.
      expect(getByTestId('signup-resend').props.disabled).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      expect(getByTestId('signup-resend').props.disabled).toBe(false);

      await act(async () => {
        fireEvent.press(getByTestId('signup-resend'));
      });
      expect(getByTestId('signup-resend').props.disabled).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(29000);
      });
      expect(getByTestId('signup-resend').props.disabled).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(getByTestId('signup-resend').props.disabled).toBe(false);
    });

    it('pressing resend while on cooldown does not call supabase.auth.resend', async () => {
      const { getByTestId } = await getToCheckEmail();
      fireEvent.press(getByTestId('signup-resend')); // still on the initial cooldown
      expect(mockResend).not.toHaveBeenCalled();
    });

    it('shows a friendly error if the resend fails, without leaving cooldown running forever', async () => {
      jest.useFakeTimers();
      const { getByTestId } = await getToCheckEmail();
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      mockResend.mockResolvedValue({ error: { message: 'boom', code: 'unexpected_failure' } });
      await act(async () => {
        fireEvent.press(getByTestId('signup-resend'));
      });
      expect(getByTestId('signup-resend-error').props.children).toMatch(/something went wrong/i);
      // Cooldown was NOT restarted on failure — resend is available again.
      expect(getByTestId('signup-resend').props.disabled).toBe(false);
    });

    it('"Wrong email? Edit" returns to the form with the typed fields still filled', async () => {
      const { getByTestId } = await getToCheckEmail();
      fireEvent.press(getByTestId('signup-edit-email'));
      expect(getByTestId('signup-email').props.value).toBe('user@example.com');
      expect(getByTestId('signup-password').props.value).toBe('securepass1');
      expect(getByTestId('signup-confirm-password').props.value).toBe('securepass1');
    });

    it('clears the cooldown timer on unmount (no leaked timer/state update)', async () => {
      jest.useFakeTimers();
      const { unmount } = await getToCheckEmail();
      unmount();
      // Advancing timers after unmount must not throw / warn about updating
      // an unmounted component.
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
    });
  });
});

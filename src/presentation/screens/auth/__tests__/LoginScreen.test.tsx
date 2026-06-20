/**
 * LoginScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

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
    ...p
  }: {
    label?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('TextInput', { testID: testID ?? label, value, onChangeText, ...p });
  TextInput.Affix = () => null;
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
  const Snackbar = ({ children, visible }: { children?: React.ReactNode; visible?: boolean }) =>
    visible ? React.createElement('Text', { testID: 'snackbar' }, children) : null;
  return { Text, TextInput, Button, Snackbar };
});

// ─── Auth service mock ────────────────────────────────────────────────────────
const mockSignIn = jest.fn();
jest.mock('../../../../data/remote/SupabaseAuthService', () => ({
  SupabaseAuthService: jest.fn().mockImplementation(() => ({
    signIn: (...args: unknown[]) => mockSignIn(...args),
  })),
}));

jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {},
}));

// ─── Store mock ───────────────────────────────────────────────────────────────
const mockSetSession = jest.fn();
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { setSession: typeof mockSetSession }) => unknown) =>
    sel({ setSession: mockSetSession }),
  ),
}));

// ─── AccessibilityInfo mock (via react-native top-level mock) ─────────────────
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

import { LoginScreen } from '../LoginScreen';

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: sign in succeeds (overridden per test as needed)
    mockSignIn.mockResolvedValue({ success: false, error: { message: 'Default error' } });
  });

  it('renders email and password fields', () => {
    const { getByTestId } = render(<LoginScreen route={{} as never} navigation={{} as never} />);
    expect(getByTestId('login-email')).toBeTruthy();
    expect(getByTestId('login-password')).toBeTruthy();
  });

  it('shows validation error without network call when email is empty', async () => {
    const { getByTestId, queryByTestId } = render(
      <LoginScreen route={{} as never} navigation={{} as never} />,
    );
    // Leave email blank, just enter password
    fireEvent.changeText(getByTestId('login-password'), 'password123');
    fireEvent.press(getByTestId('login-submit'));
    await waitFor(() => {
      expect(queryByTestId('snackbar')).toBeTruthy();
    });
    // signIn should NOT have been called (client-side validation)
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('password field is present and accepts input', () => {
    const { getByTestId } = render(<LoginScreen route={{} as never} navigation={{} as never} />);
    const passwordField = getByTestId('login-password');
    fireEvent.changeText(passwordField, 'mypassword');
    expect(passwordField.props.value).toBe('mypassword');
  });

  it('navigates to SignUp when sign-up link is pressed', () => {
    const { getByTestId } = render(<LoginScreen route={{} as never} navigation={{} as never} />);
    fireEvent.press(getByTestId('login-signup-link'));
    expect(mockNavigate).toHaveBeenCalledWith('SignUp');
  });

  it('shows validation error when password is empty but email is provided', async () => {
    const { getByTestId, queryByTestId } = render(
      <LoginScreen route={{} as never} navigation={{} as never} />,
    );
    fireEvent.changeText(getByTestId('login-email'), 'user@example.com');
    fireEvent.press(getByTestId('login-submit'));
    await waitFor(() => {
      expect(queryByTestId('snackbar')).toBeTruthy();
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('shows validation error when both email and password are empty', async () => {
    const { getByTestId, queryByTestId } = render(
      <LoginScreen route={{} as never} navigation={{} as never} />,
    );
    fireEvent.press(getByTestId('login-submit'));
    await waitFor(() => {
      expect(queryByTestId('snackbar')).toBeTruthy();
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('displays error message from failed sign-in', async () => {
    mockSignIn.mockResolvedValue({
      success: false,
      error: { message: 'Invalid login credentials' },
    });
    const { getByTestId, queryByTestId } = render(
      <LoginScreen route={{} as never} navigation={{} as never} />,
    );
    fireEvent.changeText(getByTestId('login-email'), 'user@example.com');
    fireEvent.changeText(getByTestId('login-password'), 'wrongpassword');
    fireEvent.press(getByTestId('login-submit'));
    await waitFor(() => {
      expect(queryByTestId('snackbar')).toBeTruthy();
    });
    expect(mockSignIn).toHaveBeenCalledWith('user@example.com', 'wrongpassword');
  });

  it('calls setSession on successful sign-in', async () => {
    const sessionData = { user: { id: '1' }, access_token: 'tok' };
    mockSignIn.mockResolvedValue({ success: true, data: sessionData });
    const { getByTestId } = render(<LoginScreen route={{} as never} navigation={{} as never} />);
    fireEvent.changeText(getByTestId('login-email'), 'user@example.com');
    fireEvent.changeText(getByTestId('login-password'), 'correctpassword');
    fireEvent.press(getByTestId('login-submit'));
    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith(sessionData);
    });
  });

  it('trims and lowercases email before sending', async () => {
    mockSignIn.mockResolvedValue({ success: true, data: {} });
    const { getByTestId } = render(<LoginScreen route={{} as never} navigation={{} as never} />);
    fireEvent.changeText(getByTestId('login-email'), '  User@Example.COM  ');
    fireEvent.changeText(getByTestId('login-password'), 'password');
    fireEvent.press(getByTestId('login-submit'));
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('user@example.com', 'password');
    });
  });

  it('renders title and subtitle text', () => {
    const { getAllByText } = render(<LoginScreen route={{} as never} navigation={{} as never} />);
    expect(getAllByText(/AccountingV2/i).length).toBeGreaterThan(0);
    expect(getAllByText(/Sign in/i).length).toBeGreaterThan(0);
  });
});

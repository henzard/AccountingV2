/**
 * SignUpScreen.test.tsx — B2 component test
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
    },
  },
}));

import { SignUpScreen } from '../SignUpScreen';
import { supabase } from '../../../../data/remote/supabaseClient';

const mockSignUp = supabase.auth.signUp as jest.Mock;

describe('SignUpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and submit button', () => {
    const { getByText } = render(<SignUpScreen />);
    expect(getByText('Create account')).toBeTruthy();
    expect(getByText('Create Account')).toBeTruthy();
  });

  it('shows error when passwords do not match', async () => {
    const { getByTestId, getByText, queryByTestId } = render(<SignUpScreen />);
    fireEvent.changeText(getByTestId('Email'), 'test@example.com');
    fireEvent.changeText(getByTestId('Password'), 'password123');
    fireEvent.changeText(getByTestId('Confirm password'), 'different');
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
    fireEvent.changeText(getByTestId('Email'), 'user@example.com');
    fireEvent.changeText(getByTestId('Password'), 'securepass1');
    fireEvent.changeText(getByTestId('Confirm password'), 'securepass1');
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
    fireEvent.changeText(getByTestId('Email'), 'user@example.com');
    fireEvent.changeText(getByTestId('Password'), 'securepass1');
    fireEvent.changeText(getByTestId('Confirm password'), 'securepass1');
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
    fireEvent.changeText(getByTestId('Email'), 'user@example.com');
    fireEvent.changeText(getByTestId('Password'), 'securepass1');
    fireEvent.changeText(getByTestId('Confirm password'), 'securepass1');
    fireEvent.press(getByText('Create Account'));
    await waitFor(() => {
      expect(queryByTestId('signup-error')).toBeTruthy();
    });
  });
});

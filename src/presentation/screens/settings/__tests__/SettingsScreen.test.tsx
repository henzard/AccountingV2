/**
 * SettingsScreen.test.tsx — B4
 *
 * Tests the sign-out confirmation flow: Alert is shown, destructive action
 * triggers supabase.auth.signOut() and useAppStore.getState().reset().
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── AsyncStorage mock ────────────────────────────────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

// ─── Navigation mocks ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockRootNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockRootNavigate }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('Text', p, children);
  const Button = ({
    children,
    onPress,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, ...p },
      React.createElement('Text', {}, children),
    );
  const List = {
    Section: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', {}, children),
    Subheader: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', {}, children),
    Item: ({
      title,
      description,
      onPress,
    }: {
      title?: string;
      description?: string;
      onPress?: () => void;
      left?: (p: object) => React.ReactNode;
      right?: (p: object) => React.ReactNode;
    }) =>
      React.createElement(
        'TouchableOpacity',
        { onPress },
        React.createElement('Text', {}, title),
        description ? React.createElement('Text', {}, description) : null,
      ),
    Icon: () => null,
  };
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  const Divider = () => React.createElement('View', {});
  return { Text, Button, List, Surface, Divider };
});

// ─── supabase mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: jest.fn(),
    },
  },
}));

// ─── appStore mock ────────────────────────────────────────────────────────────
const mockReset = jest.fn();
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      session: { user: { email: 'test@example.com', id: 'user-1' } },
      householdId: 'hh-1',
      availableHouseholds: [{ id: 'hh-1', name: 'My Household', paydayDay: 25 }],
    }),
  ),
  // getState is called imperatively in SettingsScreen: useAppStore.getState().reset()
  // We expose it here by mutating the mock after import
}));

import { SettingsScreen } from '../SettingsScreen';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../../data/remote/supabaseClient';

const mockSignOut = supabase.auth.signOut as jest.Mock;

// Attach getState to the mocked useAppStore so imperative calls work
(useAppStore as any).getState = () => ({ reset: mockReset });

// Stub navigation props that SettingsScreen expects as component props
const makeNavProps = () => ({
  navigation: {
    navigate: mockNavigate,
    goBack: jest.fn(),
    canGoBack: jest.fn(() => false),
    dispatch: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    removeListener: jest.fn(),
    isFocused: jest.fn(() => true),
    getId: jest.fn(),
    getParent: jest.fn(),
    getState: jest.fn(),
    setParams: jest.fn(),
    setOptions: jest.fn(),
    replace: jest.fn(),
    push: jest.fn(),
    pop: jest.fn(),
    popToTop: jest.fn(),
    reset: jest.fn(),
  } as any,
  route: { key: 'Settings', name: 'Settings', params: undefined } as any,
});

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
    // Re-attach getState after clearAllMocks
    (useAppStore as any).getState = () => ({ reset: mockReset });
  });

  it('renders sign-out button', () => {
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    expect(getByTestId('sign-out-button')).toBeTruthy();
  });

  it('pressing sign-out button calls Alert.alert with correct args', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('sign-out-button'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Sign out?',
      'You will need to sign in again to access your data.',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Sign out', style: 'destructive' }),
      ]),
    );
    alertSpy.mockRestore();
  });

  it('destructive action calls supabase.auth.signOut (reset is handled by auth listener)', async () => {
    // Auto-invoke the destructive button when Alert.alert is called
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('sign-out-button'));

    // handleSignOut is async: awaits signOut. reset() is now the listener's job.
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
    // reset() is NOT called from SettingsScreen — the auth listener owns it.
    expect(mockReset).not.toHaveBeenCalled();
  });
});

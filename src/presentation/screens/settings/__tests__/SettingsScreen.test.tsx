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
      testID,
    }: {
      title?: string;
      description?: string;
      onPress?: () => void;
      left?: (p: object) => React.ReactNode;
      right?: (p: object) => React.ReactNode;
      testID?: string;
    }) =>
      React.createElement(
        'TouchableOpacity',
        { onPress, testID },
        React.createElement('Text', {}, title),
        description ? React.createElement('Text', {}, description) : null,
      ),
    Icon: () => null,
  };
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  const Divider = () => React.createElement('View', {});
  const SegmentedButtons = ({
    onValueChange,
    buttons,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    buttons?: Array<{ value: string; label?: string; testID?: string }>;
  }) =>
    React.createElement(
      'View',
      {},
      (buttons ?? []).map((b) =>
        React.createElement(
          'TouchableOpacity',
          { key: b.value, testID: b.testID, onPress: () => onValueChange?.(b.value) },
          React.createElement('Text', {}, b.label),
        ),
      ),
    );
  return { Text, Button, List, Surface, Divider, SegmentedButtons };
});

// ─── themeStore mock ──────────────────────────────────────────────────────────
jest.mock('../../../stores/themeStore', () => ({
  useThemeStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ preference: 'system', setPreference: jest.fn() }),
  ),
}));

// ─── supabase mock ────────────────────────────────────────────────────────────
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: jest.fn(),
    },
  },
}));

// ─── FcmTokenRegistrar mock (M17) ─────────────────────────────────────────────
const mockUnregisterFcmToken = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../infrastructure/notifications/FcmTokenRegistrar', () => ({
  unregisterFcmToken: (...args: unknown[]) => mockUnregisterFcmToken(...args),
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
    mockUnregisterFcmToken.mockResolvedValue(undefined);
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

  // M17 — sign-out must clear this device's FCM token BEFORE signing out
  // (RLS needs the still-authenticated session), so a shared device's next
  // user doesn't keep receiving the previous user's push notifications.
  it('destructive sign-out action clears this device FCM token before calling supabase.auth.signOut', async () => {
    const callOrder: string[] = [];
    mockUnregisterFcmToken.mockImplementation(async () => {
      callOrder.push('unregisterFcmToken');
    });
    mockSignOut.mockImplementation(async () => {
      callOrder.push('signOut');
      return { error: null };
    });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('sign-out-button'));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });

    expect(mockUnregisterFcmToken).toHaveBeenCalledWith('user-1');
    expect(callOrder).toEqual(['unregisterFcmToken', 'signOut']);
  });

  // M11 — the "Privacy — Slip scanning consent" item must navigate through
  // the nested SlipScanning stack (SlipConsent isn't a route on Settings'
  // own stack), mirroring how the "Slip history" row above reaches the root
  // 'SlipScanning' route.
  it('pressing the slip-consent item navigates into the nested SlipScanning stack', () => {
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('slip-consent-item'));
    expect(mockNavigate).toHaveBeenCalledWith('SlipScanning', { screen: 'SlipConsent' });
  });
});

/**
 * SettingsScreen.test.tsx — B4
 *
 * Tests the sign-out confirmation flow: confirm() is shown (replacing
 * Alert.alert, a no-op on web via react-native-web), destructive action
 * triggers supabase.auth.signOut() and useAppStore.getState().reset().
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── confirm() mock (ConfirmDialogHost) ────────────────────────────────────────
const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

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
  const Portal = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const Dialog = ({
    visible,
    children,
    testID,
  }: {
    visible?: boolean;
    children?: React.ReactNode;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', {}, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', {}, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', {}, children);
  const TextInput = ({
    label,
    testID,
    value,
    onChangeText,
    disabled,
  }: {
    label?: string;
    testID?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    disabled?: boolean;
  }) =>
    React.createElement('TextInput', { testID: testID ?? label, value, onChangeText, disabled });
  const HelperText = ({
    children,
    testID,
    visible,
  }: {
    children?: React.ReactNode;
    testID?: string;
    visible?: boolean;
  }) => (visible ? React.createElement('Text', { testID }, children) : null);
  return {
    Text,
    Button,
    List,
    Surface,
    Divider,
    SegmentedButtons,
    Portal,
    Dialog,
    TextInput,
    HelperText,
  };
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
const mockSetPaydayDay = jest.fn();
let mockPaydayDay = 25;
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      session: { user: { email: 'test@example.com', id: 'user-1' } },
      householdId: 'hh-1',
      availableHouseholds: [{ id: 'hh-1', name: 'My Household', paydayDay: 25 }],
      get paydayDay() {
        return mockPaydayDay;
      },
      setPaydayDay: mockSetPaydayDay,
    }),
  ),
  // getState is called imperatively in SettingsScreen: useAppStore.getState().reset()
  // We expose it here by mutating the mock after import
}));

// ─── toastStore mock ──────────────────────────────────────────────────────────
const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector: (s: { enqueue: () => void }) => unknown) =>
    selector({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
  ),
}));

// ─── db + UpdateHouseholdPaydayDayUseCase mocks ──────────────────────────────
jest.mock('../../../../data/local/db', () => ({ db: {} }));
const mockPaydayExecute = jest.fn();
jest.mock('../../../../domain/households/UpdateHouseholdPaydayDayUseCase', () => ({
  UpdateHouseholdPaydayDayUseCase: jest.fn().mockImplementation(() => ({
    execute: mockPaydayExecute,
  })),
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
    mockConfirm.mockResolvedValue(false);
    mockPaydayDay = 25;
    mockPaydayExecute.mockResolvedValue({
      success: true,
      data: {
        fromPeriodStart: '2026-08-25',
        toPeriodStart: '2026-09-01',
        reKeyedEnvelopeCount: 3,
        collidedEnvelopeCount: 0,
        reKeyedContributionCount: 0,
      },
    });
    // Re-attach getState after clearAllMocks
    (useAppStore as any).getState = () => ({ reset: mockReset });
  });

  it('renders sign-out button', () => {
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    expect(getByTestId('sign-out-button')).toBeTruthy();
  });

  it('pressing sign-out button calls confirm() with correct args', () => {
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('sign-out-button'));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sign out?',
        message: 'You will need to sign in again to access your data.',
        confirmLabel: 'Sign out',
        destructive: true,
      }),
    );
  });

  it('does not sign out when the confirm dialog is dismissed', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('sign-out-button'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('destructive action calls supabase.auth.signOut (reset is handled by auth listener)', async () => {
    mockConfirm.mockResolvedValue(true);

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
    mockConfirm.mockResolvedValue(true);
    const callOrder: string[] = [];
    mockUnregisterFcmToken.mockImplementation(async () => {
      callOrder.push('unregisterFcmToken');
    });
    mockSignOut.mockImplementation(async () => {
      callOrder.push('signOut');
      return { error: null };
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

  it('opens the household members screen from the Household section', () => {
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('household-members-row'));
    expect(mockRootNavigate).toHaveBeenCalledWith(
      'HouseholdMembers',
      expect.objectContaining({ householdId: expect.any(String) }),
    );
  });

  it('opens the delete-account screen from below Sign out', () => {
    const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
    fireEvent.press(getByTestId('delete-account-row'));
    expect(mockNavigate).toHaveBeenCalledWith('DeleteAccount');
  });

  describe('Payday day', () => {
    it('shows the current payday day', () => {
      const { getByText } = render(<SettingsScreen {...makeNavProps()} />);
      expect(getByText('Day 25 of the month')).toBeTruthy();
    });

    it('pressing the row opens the payday dialog prefilled with the current day', () => {
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      expect(getByTestId('payday-dialog')).toBeTruthy();
      expect(getByTestId('payday-day-input').props.value).toBe('25');
    });

    it('rejects a day outside 1-28', async () => {
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.changeText(getByTestId('payday-day-input'), '29');
      fireEvent.press(getByTestId('payday-save'));

      await waitFor(() => expect(getByTestId('payday-error')).toBeTruthy());
      expect(getByTestId('payday-error').props.children).toBe('Enter a day between 1 and 28');
      expect(mockPaydayExecute).not.toHaveBeenCalled();
    });

    it('rejects non-numeric input', async () => {
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.changeText(getByTestId('payday-day-input'), 'abc');
      fireEvent.press(getByTestId('payday-save'));

      await waitFor(() => expect(getByTestId('payday-error')).toBeTruthy());
      expect(mockPaydayExecute).not.toHaveBeenCalled();
    });

    it('saves a valid day, updates the app store, and shows a success toast', async () => {
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.changeText(getByTestId('payday-day-input'), '5');
      fireEvent.press(getByTestId('payday-save'));

      await waitFor(() => expect(mockPaydayExecute).toHaveBeenCalled());
      expect(mockSetPaydayDay).toHaveBeenCalledWith(5);
      expect(mockEnqueue).toHaveBeenCalledWith('Payday updated', 'success');
    });

    it('mentions collided envelopes in the toast when collidedEnvelopeCount > 0', async () => {
      mockPaydayExecute.mockResolvedValue({
        success: true,
        data: {
          fromPeriodStart: '2026-08-25',
          toPeriodStart: '2026-09-01',
          reKeyedEnvelopeCount: 2,
          collidedEnvelopeCount: 2,
          reKeyedContributionCount: 0,
        },
      });
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.changeText(getByTestId('payday-day-input'), '5');
      fireEvent.press(getByTestId('payday-save'));

      await waitFor(() => {
        expect(mockEnqueue).toHaveBeenCalledWith(
          'Payday updated. 2 envelopes already existed in the new month and were left as they were.',
          'success',
        );
      });
    });

    it('shows the use case error message and does not update the store on failure', async () => {
      mockPaydayExecute.mockResolvedValue({
        success: false,
        error: { code: 'INVALID_PAYDAY', message: 'Payday day must be between 1 and 28' },
      });
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.changeText(getByTestId('payday-day-input'), '30');
      fireEvent.press(getByTestId('payday-save'));

      await waitFor(() => {
        expect(getByTestId('payday-error')).toBeTruthy();
      });
      expect(mockSetPaydayDay).not.toHaveBeenCalled();
    });

    it('cancel dismisses the dialog without saving', () => {
      const { getByTestId, queryByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.press(getByTestId('payday-cancel'));
      expect(queryByTestId('payday-dialog')).toBeNull();
      expect(mockPaydayExecute).not.toHaveBeenCalled();
    });

    it('accepts day 28 and calls the use case', async () => {
      const { getByTestId } = render(<SettingsScreen {...makeNavProps()} />);
      fireEvent.press(getByTestId('payday-day-item'));
      fireEvent.changeText(getByTestId('payday-day-input'), '28');
      fireEvent.press(getByTestId('payday-save'));

      await waitFor(() => expect(mockPaydayExecute).toHaveBeenCalled());
      expect(mockSetPaydayDay).toHaveBeenCalledWith(28);
    });
  });
});

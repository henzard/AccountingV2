import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SettingsScreen } from '../SettingsScreen';
import { useThemeStore } from '../../../stores/themeStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));
// SettingsScreen imports FcmTokenRegistrar (M17 sign-out fix), which in turn
// imports the native @react-native-firebase/messaging module — unavailable
// outside a native runtime. This test only exercises the appearance/theme
// section, so the registrar module is mocked out entirely.
jest.mock('../../../../infrastructure/notifications/FcmTokenRegistrar', () => ({
  unregisterFcmToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      session: { user: { id: 'user-1', email: 'a@b.com' } },
      householdId: 'h1',
      availableHouseholds: [{ id: 'h1', name: 'Home', paydayDay: 25, userLevel: 1 }],
    }),
  ),
}));
jest.mock('../../../../infrastructure/storage/userPreferences', () => ({
  loadThemePreference: jest.fn().mockResolvedValue(null),
  saveThemePreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: (): object => ({ navigate: jest.fn() }),
}));

const mockNav = { navigate: jest.fn() };

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

describe('SettingsScreen — Appearance', () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: 'system', hydrated: true });
  });

  it('shows three appearance options', () => {
    const { getByTestId } = render(
      wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />),
    );
    expect(getByTestId('appearance-system')).toBeTruthy();
    expect(getByTestId('appearance-light')).toBeTruthy();
    expect(getByTestId('appearance-dark')).toBeTruthy();
  });

  it('tapping Dark updates themeStore', () => {
    const { getByTestId } = render(
      wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />),
    );
    fireEvent.press(getByTestId('appearance-dark'));
    expect(useThemeStore.getState().preference).toBe('dark');
  });
});

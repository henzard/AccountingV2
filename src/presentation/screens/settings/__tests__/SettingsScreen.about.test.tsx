/**
 * SettingsScreen.about.test.tsx — SET-2
 *
 * There was previously no way to see the installed build: CD stamps the real
 * version (1.1.<run>) natively only, and the JS-side config always says
 * 1.0.0. Adds an "About" row showing EXPO_PUBLIC_APP_VERSION (wired by the
 * CD workflow), falling back to an honest "development build" label when
 * unset. A separate file (not an edit to SettingsScreen.test.tsx, which
 * carries a known encoding hazard — see RULES8 rule 15).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SettingsScreen } from '../SettingsScreen';

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
jest.mock('../../../../infrastructure/notifications/FcmTokenRegistrar', () => ({
  unregisterFcmToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      session: { user: { id: 'user-1', email: 'a@b.com' } },
      householdId: 'h1',
      availableHouseholds: [{ id: 'h1', name: 'Home', paydayDay: 25 }],
    }),
  ),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: (): object => ({ navigate: jest.fn() }),
}));
// Consent state isn't under test here — resolve to "not consented" quietly.
jest.mock('../../../../data/repositories/DrizzleUserConsentRepository', () => ({
  DrizzleUserConsentRepository: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
  })),
}));
jest.mock('../../../../domain/slipScanning/RevokeSlipConsentUseCase', () => ({
  RevokeSlipConsentUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));

const mockNav = { navigate: jest.fn() };

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

describe('SettingsScreen — About (SET-2)', () => {
  const originalEnv = process.env.EXPO_PUBLIC_APP_VERSION;

  afterEach(() => {
    process.env.EXPO_PUBLIC_APP_VERSION = originalEnv;
  });

  it('shows the CD-stamped version when EXPO_PUBLIC_APP_VERSION is set', () => {
    process.env.EXPO_PUBLIC_APP_VERSION = '1.1.142';
    const { getByTestId, getByText } = render(
      wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />),
    );
    expect(getByTestId('about-version')).toBeTruthy();
    expect(getByText('1.1.142')).toBeTruthy();
  });

  it('falls back to "development build" when EXPO_PUBLIC_APP_VERSION is unset', () => {
    delete process.env.EXPO_PUBLIC_APP_VERSION;
    const { getByTestId, getByText } = render(
      wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />),
    );
    expect(getByTestId('about-version')).toBeTruthy();
    expect(getByText('development build')).toBeTruthy();
  });
});

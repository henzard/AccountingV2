/**
 * FinishJoinScreen.test.tsx — F1 (round 6) app-start recovery.
 *
 * A user who force-quits after a half-completed join (active local
 * household_members row, no local households row) must finish the download
 * here — never land on the create/join gate, where "Create Household" would
 * mint a second household for someone who is already a member.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
const mockSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../data/remote/supabaseClient', () => ({
  supabase: { auth: { signOut: (): Promise<void> => mockSignOut() } },
}));
jest.mock('../../../../data/sync/RestoreService', () => ({
  RestoreService: jest.fn().mockImplementation(() => ({})),
}));

const mockHydrateHousehold = jest.fn();
jest.mock('../../../../domain/households/hydrateHousehold', () => ({
  hydrateHousehold: (...args: unknown[]) => mockHydrateHousehold(...args),
}));

const mockMarkOnboarding = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../infrastructure/storage/onboardingFlag', () => ({
  markOnboardingComplete: (...args: unknown[]) => mockMarkOnboarding(...args),
}));

// PUSH-1: FinishJoinScreen's sign-out now goes through the shared
// signOutAndUnregisterFcm helper, which imports FcmTokenRegistrar — which in
// turn imports the native @react-native-firebase/messaging module,
// unavailable under Jest (see SettingsScreen's identical mock for the M17
// fix this mirrors).
const mockUnregisterFcmToken = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../../infrastructure/notifications/FcmTokenRegistrar', () => ({
  unregisterFcmToken: (...args: unknown[]) => mockUnregisterFcmToken(...args),
}));

const mockSetHouseholdId = jest.fn();
const mockSetPaydayDay = jest.fn();
const mockSetAvailableHouseholds = jest.fn();
const mockSetOnboardingCompleted = jest.fn();
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      session: { user: { id: 'user-1' } },
      setHouseholdId: mockSetHouseholdId,
      setPaydayDay: mockSetPaydayDay,
      setAvailableHouseholds: mockSetAvailableHouseholds,
      setOnboardingCompleted: mockSetOnboardingCompleted,
    }),
  ),
}));

import { usePendingJoinStore } from '../../../boot/pendingJoinStore';
import { FinishJoinScreen } from '../FinishJoinScreen';

const hydrated = {
  success: true as const,
  data: { id: 'hh-orphan', name: 'Resumed Household', paydayDay: 7, userLevel: 1 as const },
};
const hydrateFailure = {
  success: false as const,
  error: {
    code: 'HOUSEHOLD_RESTORE_FAILED',
    message:
      "You've joined — we couldn't download the household yet. Check your connection and tap Try again.",
  },
};

describe('FinishJoinScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePendingJoinStore.getState().setPendingJoinHouseholdId('hh-orphan');
  });

  it('hydrates the pending household on mount and enters the app as a normal member', async () => {
    mockHydrateHousehold.mockResolvedValue(hydrated);

    const { getByTestId } = render(<FinishJoinScreen />);
    expect(getByTestId('finish-join-working')).toBeTruthy();

    await waitFor(() => {
      expect(mockSetHouseholdId).toHaveBeenCalledWith('hh-orphan');
    });
    expect(mockHydrateHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'hh-orphan', userId: 'user-1' }),
    );
    expect(mockSetPaydayDay).toHaveBeenCalledWith(7);
    expect(mockSetAvailableHouseholds).toHaveBeenCalledWith([hydrated.data]);
    // Joiners inherit the household's config — no budget-setup wizard.
    expect(mockMarkOnboarding).toHaveBeenCalledWith('user-1', 'hh-orphan');
    expect(mockSetOnboardingCompleted).toHaveBeenCalledWith(true);
    // The recovery flag is cleared so the screen stands down.
    expect(usePendingJoinStore.getState().pendingJoinHouseholdId).toBeNull();
  });

  it('shows the failure message with Try again and Sign out — never a way to create a household', async () => {
    mockHydrateHousehold.mockResolvedValue(hydrateFailure);

    const { getByTestId } = render(<FinishJoinScreen />);

    await waitFor(() => expect(getByTestId('finish-join-error')).toBeTruthy());
    expect(getByTestId('finish-join-retry-btn')).toBeTruthy();
    expect(getByTestId('finish-join-sign-out-btn')).toBeTruthy();
    expect(mockSetHouseholdId).not.toHaveBeenCalled();
    // Still flagged as pending, so the navigator keeps this screen up rather
    // than falling back to the create/join gate.
    expect(usePendingJoinStore.getState().pendingJoinHouseholdId).toBe('hh-orphan');
  });

  it('retries on demand and completes when the connection comes back', async () => {
    mockHydrateHousehold.mockResolvedValueOnce(hydrateFailure).mockResolvedValueOnce(hydrated);

    const { getByTestId } = render(<FinishJoinScreen />);
    await waitFor(() => expect(getByTestId('finish-join-retry-btn')).toBeTruthy());

    fireEvent.press(getByTestId('finish-join-retry-btn'));

    await waitFor(() => {
      expect(mockSetHouseholdId).toHaveBeenCalledWith('hh-orphan');
    });
    expect(mockHydrateHousehold).toHaveBeenCalledTimes(2);
  });

  it('signs out and clears the pending flag when Sign out is pressed', async () => {
    mockHydrateHousehold.mockResolvedValue(hydrateFailure);

    const { getByTestId } = render(<FinishJoinScreen />);
    await waitFor(() => expect(getByTestId('finish-join-sign-out-btn')).toBeTruthy());

    fireEvent.press(getByTestId('finish-join-sign-out-btn'));

    // PUSH-1: sign-out now goes through signOutAndUnregisterFcm, which awaits
    // the FCM unregister before calling supabase.auth.signOut() — no longer
    // synchronous from the button press.
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(usePendingJoinStore.getState().pendingJoinHouseholdId).toBeNull();
  });

  // PUSH-1: on a shared device, the FCM token identifies the device install,
  // not the signed-in user — without deregistering it before sign-out, the
  // next person to sign in here would silently keep receiving this
  // household's pushes.
  it('clears this device FCM token before calling supabase.auth.signOut', async () => {
    mockHydrateHousehold.mockResolvedValue(hydrateFailure);
    const callOrder: string[] = [];
    mockUnregisterFcmToken.mockImplementation(async () => {
      callOrder.push('unregisterFcmToken');
    });
    mockSignOut.mockImplementation(async () => {
      callOrder.push('signOut');
    });

    const { getByTestId } = render(<FinishJoinScreen />);
    await waitFor(() => expect(getByTestId('finish-join-sign-out-btn')).toBeTruthy());

    fireEvent.press(getByTestId('finish-join-sign-out-btn'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockUnregisterFcmToken).toHaveBeenCalledWith('user-1');
    expect(callOrder).toEqual(['unregisterFcmToken', 'signOut']);
  });
});

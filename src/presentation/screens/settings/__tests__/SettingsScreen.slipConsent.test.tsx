/**
 * SettingsScreen.slipConsent.test.tsx — SET-1
 *
 * Slip-scan consent could not be revoked even though the consent copy
 * promises "you can revoke consent in Settings → Privacy at any time".
 * Covers: showing the recorded consent date, the destructive "Withdraw
 * consent" action (confirm() gated, only offered once consent exists), and
 * that a dismissed confirm / failed revoke doesn't clear the shown state.
 *
 * A separate file (not an edit to SettingsScreen.test.tsx, which carries a
 * known encoding hazard — see RULES8 rule 15) so this can freely mock the
 * consent repo/use-case without touching that file.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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

const mockEnqueue = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((selector: (s: { enqueue: () => void }) => unknown) =>
    selector({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
  ),
}));

const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

const mockGet = jest.fn();
jest.mock('../../../../data/repositories/DrizzleUserConsentRepository', () => ({
  DrizzleUserConsentRepository: jest.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockGet(...args),
  })),
}));

const mockRevokeExecute = jest.fn();
jest.mock('../../../../domain/slipScanning/RevokeSlipConsentUseCase', () => ({
  RevokeSlipConsentUseCase: jest.fn().mockImplementation(() => ({
    execute: (...args: unknown[]) => mockRevokeExecute(...args),
  })),
}));

const mockNav = { navigate: jest.fn() };

function wrap(el: React.ReactElement): React.ReactElement {
  return <PaperProvider>{el}</PaperProvider>;
}

function renderScreen() {
  return render(wrap(<SettingsScreen navigation={mockNav as never} route={{} as never} />));
}

describe('SettingsScreen — slip scanning consent (SET-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(false);
  });

  it('does not offer "Withdraw consent" when no consent has been recorded', async () => {
    mockGet.mockResolvedValue(null);
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('user-1'));
    expect(getByTestId('slip-consent-item')).toBeTruthy();
    expect(queryByTestId('withdraw-slip-consent-item')).toBeNull();
  });

  it('shows the recorded consent date and offers "Withdraw consent" once consent exists', async () => {
    mockGet.mockResolvedValue({
      userId: 'user-1',
      slipScanConsentAt: '2026-04-13T00:00:00.000Z',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy());
    expect(getByText(/Consented on/)).toBeTruthy();
  });

  it('pressing "Withdraw consent" asks for confirmation explaining the effect', async () => {
    mockGet.mockResolvedValue({
      userId: 'user-1',
      slipScanConsentAt: '2026-04-13T00:00:00.000Z',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy());

    fireEvent.press(getByTestId('withdraw-slip-consent-item'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Withdraw slip scanning consent?',
        destructive: true,
        message: expect.stringContaining('stop working until you agree again'),
      }),
    );
    // Accuracy requirement: already-scanned slips/transactions must NOT be
    // described as removed — RevokeSlipConsentUseCase only touches
    // user_consent, it never touches slip_queue or transactions.
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('already scanned'),
      }),
    );
    expect(mockRevokeExecute).not.toHaveBeenCalled();
  });

  it('dismissing the confirmation does not revoke and keeps showing the consented state', async () => {
    mockGet.mockResolvedValue({
      userId: 'user-1',
      slipScanConsentAt: '2026-04-13T00:00:00.000Z',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });
    mockConfirm.mockResolvedValue(false);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy());

    fireEvent.press(getByTestId('withdraw-slip-consent-item'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());

    expect(mockRevokeExecute).not.toHaveBeenCalled();
    expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy();
  });

  it('confirming withdrawal calls the revoke use case and hides the withdraw row on success', async () => {
    mockGet.mockResolvedValue({
      userId: 'user-1',
      slipScanConsentAt: '2026-04-13T00:00:00.000Z',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });
    mockConfirm.mockResolvedValue(true);
    mockRevokeExecute.mockResolvedValue({ success: true, data: undefined });
    const { getByTestId, queryByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy());

    fireEvent.press(getByTestId('withdraw-slip-consent-item'));

    await waitFor(() => expect(mockRevokeExecute).toHaveBeenCalledWith({ userId: 'user-1' }));
    await waitFor(() => expect(queryByTestId('withdraw-slip-consent-item')).toBeNull());
    expect(mockEnqueue).toHaveBeenCalledWith('Slip scanning consent withdrawn', 'success');
  });

  it('shows an error toast and keeps the withdraw row when the revoke use case fails', async () => {
    mockGet.mockResolvedValue({
      userId: 'user-1',
      slipScanConsentAt: '2026-04-13T00:00:00.000Z',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
    });
    mockConfirm.mockResolvedValue(true);
    mockRevokeExecute.mockResolvedValue({
      success: false,
      error: { code: 'DB_ERROR', message: 'db' },
    });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy());

    fireEvent.press(getByTestId('withdraw-slip-consent-item'));

    await waitFor(() => expect(mockRevokeExecute).toHaveBeenCalled());
    expect(mockEnqueue).toHaveBeenCalledWith(
      "We couldn't withdraw consent. Please try again.",
      'error',
    );
    expect(getByTestId('withdraw-slip-consent-item')).toBeTruthy();
  });
});

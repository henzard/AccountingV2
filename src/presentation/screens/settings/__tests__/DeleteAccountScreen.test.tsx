/**
 * DeleteAccountScreen.test.tsx — PRIVACY-1
 *
 * Covers the two gates (typed DELETE + destructive confirm()), the offline
 * refusal, the progress state, and the error state.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── confirm() mock (ConfirmDialogHost) ───────────────────────────────────
const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

// ─── syncStore mock (mutable so each test can shape connectivity) ─────────
let mockSyncState = { isOnline: true };
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: Object.assign(
    jest.fn((selector: (s: typeof mockSyncState) => unknown) => selector(mockSyncState)),
    { getState: () => mockSyncState },
  ),
}));

// ─── Infrastructure singletons the screen imports (never exercised here) ──
jest.mock('../../../../data/remote/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../../data/local/db', () => ({ db: {} }));

// ─── DeleteAccountUseCase mock ────────────────────────────────────────────
const mockExecute = jest.fn();
jest.mock('../../../../domain/auth/DeleteAccountUseCase', () => ({
  DeleteAccountUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

import { DeleteAccountScreen } from '../DeleteAccountScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncState = { isOnline: true };
  mockConfirm.mockResolvedValue(true);
  mockExecute.mockResolvedValue({ success: true, data: undefined });
});

describe('DeleteAccountScreen', () => {
  it('keeps the delete button disabled until DELETE is typed', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    expect(getByTestId('delete-account-button').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByTestId('delete-account-input'), 'DELETE');
    expect(getByTestId('delete-account-button').props.accessibilityState.disabled).toBe(false);
  });

  it('stays disabled for a near-miss like "delet"', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-account-input'), 'delet');
    expect(getByTestId('delete-account-button').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the offline notice and keeps the button disabled while offline', () => {
    mockSyncState = { isOnline: false };
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-account-input'), 'DELETE');

    expect(getByTestId('delete-account-offline')).toBeTruthy();
    expect(getByTestId('delete-account-button').props.accessibilityState.disabled).toBe(true);
  });

  it('asks for a destructive confirmation before deleting anything', async () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-account-input'), 'DELETE');
    fireEvent.press(getByTestId('delete-account-button'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
  });

  it('does not run the deletion when the confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-account-input'), 'DELETE');
    fireEvent.press(getByTestId('delete-account-button'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('surfaces the use case error message and clears the progress state', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { code: 'DELETE_FAILED', message: 'We could not delete your account.' },
    });
    const { getByTestId, queryByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-account-input'), 'DELETE');
    fireEvent.press(getByTestId('delete-account-button'));

    await waitFor(() => expect(getByTestId('delete-account-error')).toBeTruthy());
    expect(queryByTestId('delete-account-progress')).toBeNull();
  });

  it('shows a progress indicator while the deletion is in flight', async () => {
    let resolveExecute: (v: unknown) => void = () => undefined;
    mockExecute.mockReturnValue(
      new Promise((resolve) => {
        resolveExecute = resolve;
      }),
    );
    const { getByTestId, queryByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-account-input'), 'DELETE');
    fireEvent.press(getByTestId('delete-account-button'));

    await waitFor(() => expect(getByTestId('delete-account-progress')).toBeTruthy());

    await act(async () => {
      resolveExecute({ success: true, data: undefined });
    });
    expect(queryByTestId('delete-account-progress')).toBeNull();
  });
});

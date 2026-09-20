/**
 * HouseholdMembersScreen.test.tsx — roster, owner-only removal, leaving.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/remote/supabaseClient', () => ({ supabase: {} }));

const mockListExecute = jest.fn();
jest.mock('../../../../domain/households/ListHouseholdMembersUseCase', () => ({
  ListHouseholdMembersUseCase: jest.fn().mockImplementation(() => ({ execute: mockListExecute })),
}));

const mockRemoveExecute = jest.fn();
const mockRemoveCtor = jest.fn();
jest.mock('../../../../domain/households/RemoveHouseholdMemberUseCase', () => ({
  RemoveHouseholdMemberUseCase: jest.fn().mockImplementation((...args: unknown[]) => {
    mockRemoveCtor(...args);
    return { execute: mockRemoveExecute };
  }),
}));

const mockLeaveExecute = jest.fn();
jest.mock('../../../../domain/households/LeaveHouseholdUseCase', () => ({
  LeaveHouseholdUseCase: jest.fn().mockImplementation(() => ({ execute: mockLeaveExecute })),
}));

const mockConfirm = jest.fn();
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

const mockSetAvailableHouseholds = jest.fn();
const mockSetHouseholdId = jest.fn();
const mockSetPaydayDay = jest.fn();
const mockClearHousehold = jest.fn();
let mockAvailableHouseholds: { id: string; name: string; paydayDay: number; userLevel: number }[] =
  [];
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      session: { user: { id: 'u-owner' } },
      availableHouseholds: mockAvailableHouseholds,
      setAvailableHouseholds: mockSetAvailableHouseholds,
      setHouseholdId: mockSetHouseholdId,
      setPaydayDay: mockSetPaydayDay,
      clearHousehold: mockClearHousehold,
    }),
  ),
}));

const mockEnqueue = jest.fn();
const mockToastClear = jest.fn();
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: Object.assign(
    jest.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ enqueue: mockEnqueue })),
    { getState: () => ({ clear: mockToastClear }) },
  ),
}));
jest.mock('../../../stores/celebrationStore', () => ({
  useCelebrationStore: { getState: () => ({ clear: jest.fn() }) },
}));
jest.mock('../../../stores/syncStore', () => ({
  useSyncStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('../../../stores/slipScannerStore', () => ({
  useSlipScannerStore: { getState: () => ({ setInFlight: jest.fn() }) },
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    Surface: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('View', { testID }, children),
    ActivityIndicator: () => React.createElement('ActivityIndicator', null),
    Button: ({
      children,
      testID,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      testID?: string;
      onPress?: () => void;
      disabled?: boolean;
    }) => React.createElement('Pressable', { testID, onPress, disabled }, children),
    IconButton: ({
      testID,
      onPress,
      disabled,
      accessibilityLabel,
    }: {
      testID?: string;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => React.createElement('Pressable', { testID, onPress, disabled, accessibilityLabel }),
  };
});

import { HouseholdMembersScreen } from '../HouseholdMembersScreen';

const OWNER = {
  userId: 'u-owner',
  email: 'owner@test.local',
  role: 'owner' as const,
  joinedAt: '2026-01-01T00:00:00.000Z',
};
const MEMBER = {
  userId: 'u-member',
  email: 'member@test.local',
  role: 'member' as const,
  joinedAt: '2026-03-04T00:00:00.000Z',
};
const CO_OWNER = {
  userId: 'u-owner-2',
  email: 'owner2@test.local',
  role: 'owner' as const,
  joinedAt: '2026-02-01T00:00:00.000Z',
};

const mockNavReset = jest.fn();

function renderScreen(): ReturnType<typeof render> {
  return render(
    <HouseholdMembersScreen
      route={{ params: { householdId: 'hh-1', householdName: 'Kruger Home' } }}
      navigation={{ reset: mockNavReset }}
    />,
  );
}

describe('HouseholdMembersScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailableHouseholds = [
      { id: 'hh-1', name: 'Kruger Home', paydayDay: 25, userLevel: 1 },
      { id: 'hh-2', name: 'Beach House', paydayDay: 1, userLevel: 1 },
    ];
    mockListExecute.mockResolvedValue({ success: true, data: [OWNER, MEMBER] });
    mockRemoveExecute.mockResolvedValue({ success: true, data: undefined });
    mockLeaveExecute.mockResolvedValue({ success: true, data: { householdId: 'hh-1' } });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a loading state before the roster arrives', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('members-loading')).toBeTruthy();
  });

  it('lists each member with email, role, en-ZA join date and a You marker', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('member-row-u-member')).toBeTruthy());
    expect(getByTestId('member-row-u-owner')).toHaveTextContent(/owner@test\.local \(You\)/);
    expect(getByTestId('member-row-u-owner')).toHaveTextContent(/Owner/);
    expect(getByTestId('member-row-u-member')).toHaveTextContent(/member@test\.local/);
    // en-ZA renders 2026-03-04 as 2026/03/04.
    expect(getByTestId('member-row-u-member')).toHaveTextContent(
      new RegExp(`Joined ${new Date(MEMBER.joinedAt).toLocaleDateString('en-ZA')}`),
    );
  });

  it('shows an error state with a retry that re-runs the load', async () => {
    mockListExecute.mockResolvedValueOnce({
      success: false,
      error: { code: 'MEMBERS_LOAD_FAILED', message: 'not a member of this household' },
    });
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('members-error')).toBeTruthy());
    expect(getByTestId('members-error')).toHaveTextContent(/not a member of this household/);
  });

  it('offers an owner a remove action for a non-owner member only', async () => {
    mockListExecute.mockResolvedValue({ success: true, data: [OWNER, CO_OWNER, MEMBER] });
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('member-row-u-member')).toBeTruthy());
    expect(getByTestId('remove-member-u-member')).toBeTruthy();
    expect(queryByTestId('remove-member-u-owner')).toBeNull();
    expect(queryByTestId('remove-member-u-owner-2')).toBeNull();
  });

  it('hides every remove action from a plain member', async () => {
    mockListExecute.mockResolvedValue({
      success: true,
      data: [
        { ...OWNER, userId: 'u-someone-else' },
        { ...MEMBER, userId: 'u-owner' },
      ],
    });
    const { getByTestId, queryByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('member-row-u-owner')).toBeTruthy());
    expect(queryByTestId('remove-member-u-someone-else')).toBeNull();
  });

  it('confirms destructively, removes, then reloads the roster', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('remove-member-u-member')).toBeTruthy());

    fireEvent.press(getByTestId('remove-member-u-member'));

    await waitFor(() => expect(mockRemoveExecute).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, confirmLabel: 'Remove' }),
    );
    expect(mockRemoveCtor).toHaveBeenCalledWith(expect.anything(), {
      householdId: 'hh-1',
      memberUserId: 'u-member',
    });
    // Initial load + the reload after a successful removal.
    expect(mockListExecute).toHaveBeenCalledTimes(2);
  });

  it('does not remove when the confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('remove-member-u-member')).toBeTruthy());

    fireEvent.press(getByTestId('remove-member-u-member'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockRemoveExecute).not.toHaveBeenCalled();
  });

  it('toasts the failure when removal is refused by the server', async () => {
    mockRemoveExecute.mockResolvedValue({
      success: false,
      error: { code: 'NOT_OWNER', message: 'Only a household owner can remove members.' },
    });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('remove-member-u-member')).toBeTruthy());

    fireEvent.press(getByTestId('remove-member-u-member'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(
        'Only a household owner can remove members.',
        'error',
      ),
    );
  });

  it('disables Leave with an explanation for a sole owner who still has members', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('leave-household-btn')).toBeTruthy());
    expect(getByTestId('leave-household-btn').props.disabled).toBe(true);
    expect(getByTestId('leave-blocked-reason')).toHaveTextContent(
      /Another member has to become an owner before you can leave\./,
    );
  });

  it('explains differently for a sole owner who is also the only member', async () => {
    mockListExecute.mockResolvedValue({ success: true, data: [OWNER] });
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('leave-blocked-reason')).toBeTruthy());
    expect(getByTestId('leave-blocked-reason')).toHaveTextContent(/nobody to hand it over to/);
  });

  it('leaves, drops the household from the list and switches to the next one', async () => {
    mockListExecute.mockResolvedValue({ success: true, data: [OWNER, CO_OWNER] });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('leave-household-btn')).toBeTruthy());

    fireEvent.press(getByTestId('leave-household-btn'));

    await waitFor(() => expect(mockLeaveExecute).toHaveBeenCalled());
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, confirmLabel: 'Leave' }),
    );
    expect(mockSetAvailableHouseholds).toHaveBeenCalledWith([
      { id: 'hh-2', name: 'Beach House', paydayDay: 1, userLevel: 1 },
    ]);
    expect(mockSetHouseholdId).toHaveBeenCalledWith('hh-2');
    expect(mockSetPaydayDay).toHaveBeenCalledWith(1);
    expect(mockNavReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  });

  it('falls through to the no-household gate when the last household is left', async () => {
    mockAvailableHouseholds = [{ id: 'hh-1', name: 'Kruger Home', paydayDay: 25, userLevel: 1 }];
    mockListExecute.mockResolvedValue({ success: true, data: [OWNER, CO_OWNER] });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('leave-household-btn')).toBeTruthy());

    fireEvent.press(getByTestId('leave-household-btn'));

    await waitFor(() => expect(mockClearHousehold).toHaveBeenCalled());
    expect(mockSetAvailableHouseholds).toHaveBeenCalledWith([]);
    expect(mockNavReset).not.toHaveBeenCalled();
  });

  it('toasts and stays put when leaving is rejected', async () => {
    mockListExecute.mockResolvedValue({ success: true, data: [OWNER, CO_OWNER] });
    mockLeaveExecute.mockResolvedValue({
      success: false,
      error: { code: 'LAST_OWNER', message: 'You are the only owner of this household.' },
    });
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(getByTestId('leave-household-btn')).toBeTruthy());

    fireEvent.press(getByTestId('leave-household-btn'));

    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(
        'You are the only owner of this household.',
        'error',
      ),
    );
    expect(mockSetAvailableHouseholds).not.toHaveBeenCalled();
    expect(mockClearHousehold).not.toHaveBeenCalled();
  });
});

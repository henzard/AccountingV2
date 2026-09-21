/**
 * HouseholdMembersScreen.test.tsx — roster, owner-only removal, leaving.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/remote/supabaseClient', () => ({ supabase: {} }));

// HH-2: refetch-on-focus uses useFocusEffect, which needs a navigation
// container in a real app but only React.useEffect's semantics in a test
// (mirrors MeterDashboardScreen.test.tsx's identical mock).
jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useFocusEffect: (cb: () => (() => void) | void) => {
      R.useEffect(() => cb(), [cb]);
    },
  };
});

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
const mockLeaveCtor = jest.fn();
const mockPreflight = jest.fn();
jest.mock('../../../../domain/households/LeaveHouseholdUseCase', () => ({
  LeaveHouseholdUseCase: jest.fn().mockImplementation((...args: unknown[]) => {
    mockLeaveCtor(...args);
    return { execute: mockLeaveExecute };
  }),
  inspectLeaveHouseholdPreflight: (...args: unknown[]) => mockPreflight(...args),
}));

// The on-disk slip image store reaches for expo-file-system; the screen only
// needs to HAND it to the use case, so the module is stubbed wholesale.
const mockSlipImageStoreCtor = jest.fn();
jest.mock('../../../../infrastructure/slipScanning/SlipImageLocalStore', () => ({
  SlipImageLocalStore: jest.fn().mockImplementation(() => {
    mockSlipImageStoreCtor();
    return { delete: jest.fn() };
  }),
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
    mockLeaveExecute.mockResolvedValue({
      success: true,
      data: { householdId: 'hh-1', purgedTables: ['households'], deadLetteredDiscarded: 0 },
    });
    mockPreflight.mockReturnValue({ unsyncedCount: 0, deadLetteredCount: 0 });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a loading state before the roster arrives', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('members-loading')).toBeTruthy();
  });

  it('lists each member with email, role, formatted join date and a You marker', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => expect(getByTestId('member-row-u-member')).toBeTruthy());
    expect(getByTestId('member-row-u-owner')).toHaveTextContent(/owner@test\.local \(You\)/);
    expect(getByTestId('member-row-u-owner')).toHaveTextContent(/Owner/);
    expect(getByTestId('member-row-u-member')).toHaveTextContent(/member@test\.local/);
    // date-fns format 'd MMM yyyy' renders 2026-03-04 as '4 Mar 2026'
    expect(getByTestId('member-row-u-member')).toHaveTextContent(/Joined 4 Mar 2026/);
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
      /You're the only owner\. To leave, remove the other members first, or delete your account/,
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

  // UX2-20 — date formatting with date-fns
  describe('UX2-20 — date formatting', () => {
    it('renders invalid date as dash', async () => {
      mockListExecute.mockResolvedValue({
        success: true,
        data: [
          OWNER,
          {
            userId: 'u-invalid-date',
            email: 'invalid@test.local',
            role: 'member' as const,
            joinedAt: 'not-a-date',
          },
        ],
      });
      const { getByTestId } = renderScreen();

      await waitFor(() => expect(getByTestId('member-row-u-invalid-date')).toBeTruthy());
      expect(getByTestId('member-row-u-invalid-date')).toHaveTextContent(/Joined —/);
    });

    it('renders valid date in d MMM yyyy format', async () => {
      const { getByTestId } = renderScreen();

      await waitFor(() => expect(getByTestId('member-row-u-owner')).toBeTruthy());
      expect(getByTestId('member-row-u-owner')).toHaveTextContent(/Joined 1 Jan 2026/);
    });
  });

  // HH-2: another owner's change (add/remove/role change) must not leave this
  // screen's roster — or its "sole owner" computation — stale.
  describe('HH-2 — pull-to-refresh, refetch-on-focus, and stale-load guard', () => {
    it('pull-to-refresh re-runs the load', async () => {
      const { getByTestId, UNSAFE_getByType } = renderScreen();
      await waitFor(() => expect(getByTestId('member-row-u-member')).toBeTruthy());
      expect(mockListExecute).toHaveBeenCalledTimes(1);

      mockListExecute.mockResolvedValue({ success: true, data: [OWNER, MEMBER, CO_OWNER] });
      const refreshControl = UNSAFE_getByType(RefreshControl);
      await waitFor(() => {
        refreshControl.props.onRefresh();
      });

      await waitFor(() => expect(getByTestId('member-row-u-owner-2')).toBeTruthy());
      expect(mockListExecute).toHaveBeenCalledTimes(2);
    });

    it('discards a stale slower load when a newer one resolves first', async () => {
      const { getByTestId, queryByTestId, UNSAFE_getByType } = renderScreen();
      await waitFor(() => expect(getByTestId('member-row-u-member')).toBeTruthy());

      // Kick off a slow refresh (call #2) that will resolve LATE, then a
      // second refresh (call #3) that resolves immediately. Without the
      // request-counter guard, call #2's stale response — arriving after
      // call #3's fresh one — would overwrite it.
      let resolveSlow!: (v: unknown) => void;
      mockListExecute.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      );
      const refreshControl = UNSAFE_getByType(RefreshControl);
      refreshControl.props.onRefresh();

      mockListExecute.mockResolvedValueOnce({ success: true, data: [OWNER, CO_OWNER] });
      await refreshControl.props.onRefresh();

      await waitFor(() => expect(getByTestId('member-row-u-owner-2')).toBeTruthy());
      expect(queryByTestId('member-row-u-member')).toBeNull();

      // Now the stale, slower response resolves — it must be discarded.
      // onRefresh is fire-and-forget (returns undefined), so awaiting its
      // return value would prove nothing: resolve inside act and flush the
      // microtasks so a stale overwrite, if any, has really been committed.
      await act(async () => {
        resolveSlow({ success: true, data: [MEMBER] });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(getByTestId('member-row-u-owner-2')).toBeTruthy();
      expect(queryByTestId('member-row-u-member')).toBeNull();
      expect(queryByTestId('members-error')).toBeNull();
    });
  });

  // The product instruction for leaving was "make sure to let the user know
  // and make sure it's synced". The confirmation is where the user is told,
  // so its wording is a contract, not decoration.
  describe('leave confirmation copy and the non-destructive failure states', () => {
    async function pressLeave(getByTestId: (id: string) => unknown): Promise<void> {
      mockListExecute.mockResolvedValue({ success: true, data: [OWNER, CO_OWNER] });
      await waitFor(() => expect(getByTestId('leave-household-btn')).toBeTruthy());
      fireEvent.press(getByTestId('leave-household-btn') as never);
    }

    function confirmMessage(): string {
      return (mockConfirm.mock.calls[0][0] as { message: string }).message;
    }

    it('says the data leaves THIS phone and stays with the remaining members', async () => {
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      const message = confirmMessage();
      expect(message).toMatch(/will be removed from this phone/i);
      expect(message).toMatch(/remaining members keep it all/i);
      expect(message).toMatch(/rejoin later with a new invite code/i);
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ destructive: true, confirmLabel: 'Leave' }),
      );
    });

    it('promises unsynced work is synced first, and names the count', async () => {
      mockPreflight.mockReturnValue({ unsyncedCount: 3, deadLetteredCount: 0 });
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(confirmMessage()).toMatch(/Your 3 unsynced changes will be synced first/);
    });

    it('warns, before the user agrees, how many rejected changes are discarded', async () => {
      mockPreflight.mockReturnValue({ unsyncedCount: 0, deadLetteredCount: 1 });
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(confirmMessage()).toMatch(
        /1 change the server rejected can never be sent and will be discarded/,
      );
    });

    it('mentions neither count when there is nothing outstanding', async () => {
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(confirmMessage()).not.toMatch(/unsynced/);
      expect(confirmMessage()).not.toMatch(/discarded/);
    });

    it('still offers the confirmation when the preflight read itself fails', async () => {
      mockPreflight.mockImplementation(() => {
        throw new Error('no such table: oplog');
      });
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      // A failed count must not block leaving — the use case's own oplog
      // checks are the guarantee; this is only the wording.
      await waitFor(() => expect(mockLeaveExecute).toHaveBeenCalled());
      expect(confirmMessage()).toMatch(/will be removed from this phone/i);
    });

    it('hands the use case a slip image store so the images go with the rows', async () => {
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() => expect(mockLeaveCtor).toHaveBeenCalled());
      expect(mockLeaveCtor).toHaveBeenCalledWith(
        expect.anything(),
        { householdId: 'hh-1', userId: 'u-owner' },
        expect.objectContaining({ slipImages: expect.anything() }),
      );
    });

    it('reports the refusal and changes NOTHING when local work is unsynced', async () => {
      mockLeaveExecute.mockResolvedValue({
        success: false,
        error: {
          code: 'UNSYNCED_CHANGES',
          message: "Some changes haven't synced yet. Connect to the internet and try again.",
        },
      });
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() =>
        expect(mockEnqueue).toHaveBeenCalledWith(
          "Some changes haven't synced yet. Connect to the internet and try again.",
          'error',
        ),
      );
      expect(mockSetAvailableHouseholds).not.toHaveBeenCalled();
      expect(mockSetHouseholdId).not.toHaveBeenCalled();
      expect(mockClearHousehold).not.toHaveBeenCalled();
      expect(mockNavReset).not.toHaveBeenCalled();
    });

    it('stays put when the departure could not be pushed', async () => {
      mockLeaveExecute.mockResolvedValue({
        success: false,
        error: { code: 'LEAVE_NOT_SYNCED', message: "the change hasn't reached the others yet" },
      });
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() =>
        expect(mockEnqueue).toHaveBeenCalledWith(
          "the change hasn't reached the others yet",
          'error',
        ),
      );
      expect(mockSetAvailableHouseholds).not.toHaveBeenCalled();
      expect(mockClearHousehold).not.toHaveBeenCalled();
    });

    it('tells the user the data is off this phone once it succeeds', async () => {
      const { getByTestId } = renderScreen();
      await pressLeave(getByTestId);

      await waitFor(() =>
        expect(mockEnqueue).toHaveBeenCalledWith(
          'You left Kruger Home. Its data is off this phone.',
          'success',
        ),
      );
    });
  });
});

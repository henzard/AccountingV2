/**
 * HouseholdPickerScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

let mockAvailableHouseholds: { id: string; name: string; paydayDay: number; userLevel: number }[] =
  [];
let mockSession: { user: { id: string } } | null = { user: { id: 'u-1' } };
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      availableHouseholds: mockAvailableHouseholds,
      setHouseholdId: jest.fn(),
      setPaydayDay: jest.fn(),
      session: mockSession,
    }),
  ),
}));

// HH-4: HouseholdSummary carries no role, so the screen reads active
// household_members rows for the signed-in user directly from the local db.
const mockMembershipRows = jest.fn();
jest.mock('../../../../data/local/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mockMembershipRows(),
      }),
    }),
  },
}));
jest.mock('../../../../data/local/schema', () => ({
  householdMembers: { householdId: 'household_id', userId: 'user_id', role: 'role' },
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
    Surface: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('View', { testID }, children),
    TouchableRipple: ({
      children,
      onPress,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
    }) => React.createElement('Pressable', { onPress }, children),
    FAB: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab' }),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        'Pressable',
        { onPress, testID },
        React.createElement('Text', null, children),
      ),
  };
});

const mockNavigate = jest.fn();
const mockReset = jest.fn();
import { HouseholdPickerScreen } from '../HouseholdPickerScreen';

describe('HouseholdPickerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailableHouseholds = [];
    mockSession = { user: { id: 'u-1' } };
    mockMembershipRows.mockResolvedValue([]);
  });

  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <HouseholdPickerScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate, reset: mockReset } as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });

  it('displays create new household button', () => {
    const { getByText } = render(
      <HouseholdPickerScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate, reset: mockReset } as never}
      />,
    );
    expect(getByText('Create New Household')).toBeTruthy();
  });

  it('displays join with invite code button', () => {
    const { getByText } = render(
      <HouseholdPickerScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate, reset: mockReset } as never}
      />,
    );
    expect(getByText('Join with Invite Code')).toBeTruthy();
  });

  // HH-4: HouseholdSummary carries no role, so each row must show whether the
  // signed-in user is an Owner or Member of THAT household, read from the
  // local household_members rows.
  describe('HH-4 — per-household owner/member label', () => {
    it('labels a household the user owns as Owner, with an accessibilityLabel', async () => {
      mockAvailableHouseholds = [{ id: 'hh-1', name: 'Kruger Home', paydayDay: 25, userLevel: 1 }];
      mockMembershipRows.mockResolvedValue([{ householdId: 'hh-1', role: 'owner' }]);

      const { getByTestId } = render(
        <HouseholdPickerScreen
          route={{} as never}
          navigation={{ navigate: mockNavigate, reset: mockReset } as never}
        />,
      );

      await waitFor(() => expect(getByTestId('household-role-hh-1')).toBeTruthy());
      expect(getByTestId('household-role-hh-1')).toHaveTextContent('Owner');
      expect(getByTestId('household-role-hh-1').props.accessibilityLabel).toBe('Your role: Owner');
    });

    it('labels a household the user only belongs to as Member', async () => {
      mockAvailableHouseholds = [
        { id: 'hh-1', name: 'Kruger Home', paydayDay: 25, userLevel: 1 },
        { id: 'hh-2', name: 'Beach House', paydayDay: 1, userLevel: 1 },
      ];
      mockMembershipRows.mockResolvedValue([
        { householdId: 'hh-1', role: 'owner' },
        { householdId: 'hh-2', role: 'member' },
      ]);

      const { getByTestId } = render(
        <HouseholdPickerScreen
          route={{} as never}
          navigation={{ navigate: mockNavigate, reset: mockReset } as never}
        />,
      );

      await waitFor(() => expect(getByTestId('household-role-hh-2')).toBeTruthy());
      expect(getByTestId('household-role-hh-2')).toHaveTextContent('Member');
      expect(getByTestId('household-role-hh-1')).toHaveTextContent('Owner');
    });

    it('shows no role badge for a household with no local membership row yet', async () => {
      mockAvailableHouseholds = [{ id: 'hh-3', name: 'New Home', paydayDay: 10, userLevel: 1 }];
      mockMembershipRows.mockResolvedValue([]);

      const { queryByTestId, getByTestId } = render(
        <HouseholdPickerScreen
          route={{} as never}
          navigation={{ navigate: mockNavigate, reset: mockReset } as never}
        />,
      );

      await waitFor(() => expect(getByTestId('household-row-hh-3')).toBeTruthy());
      expect(queryByTestId('household-role-hh-3')).toBeNull();
    });
  });
});

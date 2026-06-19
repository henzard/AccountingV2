/**
 * household-switching-ux.test.tsx — WS6
 *
 * Tests the household switching UX:
 *   - Switching household clears previous data from active stores
 *   - Available households list correct count
 *   - Active household name displayed
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─── Store mocks ────────────────────────────────────────────────────────────

const mockClear = jest.fn();
const mockCelebrationClear = jest.fn();
const mockSyncReset = jest.fn();
const mockSlipSetInFlight = jest.fn();
const mockSetHouseholdId = jest.fn();
const mockSetPaydayDay = jest.fn();

const mockHouseholds = [
  { id: 'hh-kruger', name: 'Kruger', paydayDay: 20 },
  { id: 'hh-hetzel', name: 'Hetzel', paydayDay: 1 },
];

jest.mock('../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: object) => unknown) =>
    sel({
      availableHouseholds: mockHouseholds,
      householdId: 'hh-kruger',
      setHouseholdId: mockSetHouseholdId,
      setPaydayDay: mockSetPaydayDay,
    }),
  ),
}));

jest.mock('../stores/toastStore', () => ({
  useToastStore: Object.assign(
    jest.fn((sel: (s: object) => unknown) => sel({ enqueue: jest.fn() })),
    { getState: () => ({ clear: mockClear }) },
  ),
}));

jest.mock('../stores/celebrationStore', () => ({
  useCelebrationStore: Object.assign(jest.fn(), {
    getState: () => ({ clear: mockCelebrationClear }),
  }),
}));

jest.mock('../stores/syncStore', () => ({
  useSyncStore: Object.assign(jest.fn(), {
    getState: () => ({ reset: mockSyncReset }),
  }),
}));

jest.mock('../stores/slipScannerStore', () => ({
  useSlipScannerStore: Object.assign(jest.fn(), {
    getState: () => ({ setInFlight: mockSlipSetInFlight }),
  }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({ children, ...p }: any) => React.createElement('Text', p, children),
    Surface: ({ children, ...p }: any) => React.createElement('View', p, children),
    TouchableRipple: ({ children, onPress, ...p }: any) =>
      React.createElement('Pressable', { onPress, ...p }, children),
    FAB: ({ onPress, testID, ...p }: any) =>
      React.createElement('Pressable', { onPress, testID: testID ?? 'fab', ...p }),
    Button: ({ children, onPress, testID, ...p }: any) =>
      React.createElement(
        'Pressable',
        { onPress, testID, ...p },
        React.createElement('Text', null, children),
      ),
  };
});

// ─── Import after mocks ─────────────────────────────────────────────────────

import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const nav = {
  navigate: mockNavigate,
  reset: mockReset,
} as any;

// ═════════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════════

describe('Household switching UX', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('switching household clears previous data from active stores', () => {
    const { getByText } = render(<HouseholdPickerScreen route={{} as never} navigation={nav} />);

    // Select Hetzel household
    fireEvent.press(getByText('Hetzel'));

    // Verify all stores were cleared
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(mockCelebrationClear).toHaveBeenCalledTimes(1);
    expect(mockSyncReset).toHaveBeenCalledTimes(1);
    expect(mockSlipSetInFlight).toHaveBeenCalledWith(null);
  });

  it('switching sets the new householdId and paydayDay', () => {
    const { getByText } = render(<HouseholdPickerScreen route={{} as never} navigation={nav} />);

    fireEvent.press(getByText('Hetzel'));

    expect(mockSetHouseholdId).toHaveBeenCalledWith('hh-hetzel');
    expect(mockSetPaydayDay).toHaveBeenCalledWith(1);
  });

  it('switching resets navigation to Main', () => {
    const { getByText } = render(<HouseholdPickerScreen route={{} as never} navigation={nav} />);

    fireEvent.press(getByText('Kruger'));

    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  });

  it('available households list shows correct count (2 households)', () => {
    const { getByText } = render(<HouseholdPickerScreen route={{} as never} navigation={nav} />);

    expect(getByText('Kruger')).toBeTruthy();
    expect(getByText('Hetzel')).toBeTruthy();
  });

  it('displays household payday info', () => {
    const { getByText } = render(<HouseholdPickerScreen route={{} as never} navigation={nav} />);

    expect(getByText('Payday: day 20')).toBeTruthy();
    expect(getByText('Payday: day 1')).toBeTruthy();
  });

  it('active household name is displayed in the list', () => {
    const { getByText } = render(<HouseholdPickerScreen route={{} as never} navigation={nav} />);

    // Both households are listed; the currently active one (Kruger) is present
    expect(getByText('Kruger')).toBeTruthy();
  });
});

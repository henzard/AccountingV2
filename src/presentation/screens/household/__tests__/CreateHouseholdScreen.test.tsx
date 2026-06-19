/**
 * CreateHouseholdScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));

const mockExecute = jest.fn();
jest.mock('../../../../domain/households/CreateHouseholdUseCase', () => ({
  CreateHouseholdUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

const mockSetHouseholdId = jest.fn();
const mockSetPaydayDay = jest.fn();
const mockSetAvailableHouseholds = jest.fn();
const mockEnqueue = jest.fn();

let mockSession: { user: { id: string } } | null = { user: { id: 'user-1' } };
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn(
    (
      sel: (s: {
        session: { user: { id: string } } | null;
        setHouseholdId: typeof mockSetHouseholdId;
        setPaydayDay: typeof mockSetPaydayDay;
        setAvailableHouseholds: typeof mockSetAvailableHouseholds;
        availableHouseholds: never[];
      }) => unknown,
    ) =>
      sel({
        session: mockSession,
        setHouseholdId: mockSetHouseholdId,
        setPaydayDay: mockSetPaydayDay,
        setAvailableHouseholds: mockSetAvailableHouseholds,
        availableHouseholds: [],
      }),
  ),
}));
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: typeof mockEnqueue }) => unknown) =>
    sel({ enqueue: mockEnqueue }),
  ),
}));
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
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
    React.createElement('TextInput', {
      testID: testID ?? label,
      value,
      onChangeText,
      accessibilityState: disabled ? { disabled: true } : undefined,
    });
  TextInput.Affix = () => null;
  TextInput.Icon = () => null;
  return {
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    TextInput,
    Button: ({
      children,
      testID,
      onPress,
      loading: _loading,
      disabled,
    }: {
      children?: React.ReactNode;
      testID?: string;
      onPress?: () => void;
      loading?: boolean;
      disabled?: boolean;
    }) =>
      React.createElement(
        'Pressable',
        {
          testID,
          onPress: disabled ? undefined : onPress,
          accessibilityState: disabled ? { disabled: true } : undefined,
        },
        React.createElement('Text', {}, children),
      ),
  };
});

import { CreateHouseholdScreen } from '../CreateHouseholdScreen';

describe('CreateHouseholdScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = { user: { id: 'user-1' } };
    mockExecute.mockResolvedValue({
      success: true,
      data: { id: 'hh-new', paydayDay: 25 },
    });
  });

  it('renders household name input', () => {
    const { getByTestId } = render(<CreateHouseholdScreen />);
    expect(getByTestId('Household name')).toBeTruthy();
  });

  it('renders payday day input', () => {
    const { getByTestId } = render(<CreateHouseholdScreen />);
    expect(getByTestId('Payday day of month (1–28)')).toBeTruthy();
  });

  it('does not call execute when session is null', async () => {
    mockSession = null;
    const { getByText } = render(<CreateHouseholdScreen />);
    fireEvent.press(getByText('Create Household'));
    await waitFor(() => {
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  it('calls use case and sets store on success', async () => {
    const { getByTestId, getByText } = render(<CreateHouseholdScreen />);
    fireEvent.changeText(getByTestId('Household name'), 'Test Home');
    fireEvent.press(getByText('Create Household'));
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockSetHouseholdId).toHaveBeenCalledWith('hh-new');
      expect(mockSetPaydayDay).toHaveBeenCalledWith(25);
    });
  });

  it('shows error toast on failure', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      error: { message: 'Name is required' },
    });
    const { getByText } = render(<CreateHouseholdScreen />);
    fireEvent.press(getByText('Create Household'));
    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith('Name is required', 'error');
    });
    expect(mockSetHouseholdId).not.toHaveBeenCalled();
  });
});

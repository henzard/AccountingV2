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
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
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
    expect(getByTestId('household-name-input')).toBeTruthy();
  });

  it('renders payday day input', () => {
    const { getByTestId } = render(<CreateHouseholdScreen />);
    expect(getByTestId('household-payday-input')).toBeTruthy();
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
    fireEvent.changeText(getByTestId('household-name-input'), 'Test Home');
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

  // Regression: `parseInt(paydayDay, 10)` on a cleared/invalid field yields
  // NaN, and NaN fails both `< 1` and `> 28` — so CreateHouseholdUseCase's
  // range guard silently let it through. The screen must now validate BEFORE
  // calling the use case at all.
  it('shows an inline error and does not call the use case when payday is cleared', async () => {
    const { getByTestId, getByText, queryByText } = render(<CreateHouseholdScreen />);
    fireEvent.changeText(getByTestId('household-name-input'), 'Test Home');
    fireEvent.changeText(getByTestId('household-payday-input'), '');
    fireEvent.press(getByText('Create Household'));

    await waitFor(() => {
      expect(getByTestId('household-payday-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSetHouseholdId).not.toHaveBeenCalled();
    expect(queryByText(/whole number between 1 and 28/)).toBeTruthy();
  });

  it('shows an inline error and does not call the use case when payday is out of range', async () => {
    const { getByTestId, getByText } = render(<CreateHouseholdScreen />);
    fireEvent.changeText(getByTestId('household-name-input'), 'Test Home');
    fireEvent.changeText(getByTestId('household-payday-input'), '29');
    fireEvent.press(getByText('Create Household'));

    await waitFor(() => {
      expect(getByTestId('household-payday-error')).toBeTruthy();
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('clears the inline payday error once the user edits the field again', async () => {
    const { getByTestId, getByText, queryByTestId } = render(<CreateHouseholdScreen />);
    fireEvent.changeText(getByTestId('household-payday-input'), '');
    fireEvent.press(getByText('Create Household'));
    await waitFor(() => {
      expect(getByTestId('household-payday-error')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('household-payday-input'), '10');
    await waitFor(() => {
      expect(queryByTestId('household-payday-error')).toBeNull();
    });
  });
});

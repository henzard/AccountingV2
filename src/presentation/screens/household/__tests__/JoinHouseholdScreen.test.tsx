/**
 * JoinHouseholdScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/remote/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../../data/sync/RestoreService', () => ({
  RestoreService: jest
    .fn()
    .mockImplementation(() => ({ restore: jest.fn().mockResolvedValue([]) })),
}));
jest.mock('../../../../domain/households/AcceptInviteUseCase', () => ({
  AcceptInviteUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn(
    (
      sel: (s: {
        session: { user: { id: string } };
        setHouseholdId: () => void;
        setPaydayDay: () => void;
        setAvailableHouseholds: () => void;
        availableHouseholds: [];
      }) => unknown,
    ) =>
      sel({
        session: { user: { id: 'user-1' } },
        setHouseholdId: jest.fn(),
        setPaydayDay: jest.fn(),
        setAvailableHouseholds: jest.fn(),
        availableHouseholds: [],
      }),
  ),
}));
jest.mock('../../../stores/toastStore', () => ({
  useToastStore: jest.fn((sel: (s: { enqueue: () => void }) => unknown) =>
    sel({ enqueue: jest.fn() }),
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
  }: {
    label?: string;
    testID?: string;
    value?: string;
    onChangeText?: (v: string) => void;
  }) => React.createElement('TextInput', { testID: testID ?? label, value, onChangeText });
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
    }: {
      children?: React.ReactNode;
      testID?: string;
      onPress?: () => void;
    }) => React.createElement('Pressable', { testID, onPress }, children),
    Snackbar: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? React.createElement('Text', { testID: 'snackbar' }, children) : null,
  };
});

const mockNavigate = jest.fn();
import { JoinHouseholdScreen } from '../JoinHouseholdScreen';

describe('JoinHouseholdScreen', () => {
  it('renders invite code input', () => {
    const { getByTestId } = render(
      <JoinHouseholdScreen route={{} as never} navigation={{ navigate: mockNavigate } as never} />,
    );
    expect(getByTestId('Invite code')).toBeTruthy();
  });
});

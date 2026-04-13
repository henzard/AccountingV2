/**
 * CreateHouseholdScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../../domain/households/CreateHouseholdUseCase', () => ({
  CreateHouseholdUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
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

import { CreateHouseholdScreen } from '../CreateHouseholdScreen';

describe('CreateHouseholdScreen', () => {
  it('renders household name input', () => {
    const { getByTestId } = render(
      <CreateHouseholdScreen route={{} as never} navigation={{} as never} />,
    );
    expect(getByTestId('Household name')).toBeTruthy();
  });
});

/**
 * AddDebtScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../../domain/debtSnowball/CreateDebtUseCase', () => ({
  CreateDebtUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
}));
jest.mock('../../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: { householdId: string }) => unknown) =>
    sel({ householdId: 'hh-1' }),
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
    HelperText: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
    SegmentedButtons: () => React.createElement('View', null),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
import { AddDebtScreen } from '../AddDebtScreen';

describe('AddDebtScreen', () => {
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <AddDebtScreen
        route={{} as never}
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });
});

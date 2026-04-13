/**
 * LogPaymentScreen.test.tsx — C8 screen test
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../../data/local/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));
jest.mock('../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../../domain/debtSnowball/LogDebtPaymentUseCase', () => ({
  LogDebtPaymentUseCase: jest.fn().mockImplementation(() => ({ execute: jest.fn() })),
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
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));
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
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
import { LogPaymentScreen } from '../LogPaymentScreen';

describe('LogPaymentScreen', () => {
  it('renders without crashing', () => {
    const { UNSAFE_root } = render(
      <LogPaymentScreen
        route={{ params: { debtId: 'debt-1' } } as never}
        navigation={{ navigate: mockNavigate, goBack: mockGoBack } as never}
      />,
    );
    expect(UNSAFE_root).toBeTruthy();
  });
});

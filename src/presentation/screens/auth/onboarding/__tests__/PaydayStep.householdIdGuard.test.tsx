import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: (): object => ({ navigate: jest.fn() }),
}));

jest.mock('../../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../../domain/households/UpdateHouseholdPaydayDayUseCase', () => ({
  UpdateHouseholdPaydayDayUseCase: jest.fn(),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  const TextInput = ({ label }: { label?: string }) =>
    React.createElement('TextInput', { testID: label });
  TextInput.Affix = () => null;
  const Button = ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) =>
    React.createElement('TouchableOpacity', { onPress }, children);
  const HelperText = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  return { Text, TextInput, Button, HelperText };
});

jest.mock('../../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({ householdId: null, paydayDay: 25 }),
  ),
}));

import { PaydayStep } from '../PaydayStep';

describe('PaydayStep householdId guard', () => {
  it('shows loading splash when householdId is null', () => {
    const { getByTestId } = render(<PaydayStep />);
    expect(getByTestId('loading-splash')).toBeTruthy();
  });
});

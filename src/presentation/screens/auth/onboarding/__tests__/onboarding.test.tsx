/**
 * onboarding.test.tsx — B1 component tests
 *
 * Tests: WelcomeStep, IncomeStep, PaydayStep render + CTA behaviour.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
const mockReset = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, reset: mockReset }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    ...p
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }): React.JSX.Element => React.createElement('Text', p, children);
  const Button = ({
    children,
    onPress,
    testID,
    disabled,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    loading?: boolean;
    disabled?: boolean;
    [key: string]: unknown;
  }): React.JSX.Element =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, disabled, ...p },
      React.createElement('Text', {}, children),
    );
  const TextInput = ({
    label,
    value,
    onChangeText,
    testID,
    ...p
  }: {
    label?: string;
    value?: string;
    onChangeText?: (v: string) => void;
    testID?: string;
    [key: string]: unknown;
  }): React.JSX.Element =>
    React.createElement('TextInput', {
      testID: testID ?? label,
      value,
      onChangeText,
      ...p,
    });
  // Affix sub-component
  TextInput.Affix = (): null => null;
  const HelperText = ({
    children,
    type,
  }: {
    children?: React.ReactNode;
    type?: string;
  }): React.JSX.Element => React.createElement('Text', { testID: `helper-${type}` }, children);
  const Chip = ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }): React.JSX.Element => React.createElement('TouchableOpacity', { onPress, testID }, children);
  const List = {
    Item: ({
      title,
      right,
    }: {
      title?: string;
      right?: (p: object) => React.JSX.Element;
    }): React.JSX.Element =>
      React.createElement(
        'View',
        {},
        React.createElement('Text', {}, title),
        right ? right({}) : null,
      ),
  };
  const Switch = ({
    value,
    onValueChange,
    testID,
  }: {
    value?: boolean;
    onValueChange?: (v: boolean) => void;
    testID?: string;
  }): React.JSX.Element =>
    React.createElement('View', {
      testID,
      accessibilityState: { checked: value },
      onTouchEnd: () => onValueChange?.(!value),
    });
  const Surface = ({
    children,
    ...p
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }): React.JSX.Element => React.createElement('View', p, children);
  return { Text, Button, TextInput, HelperText, Chip, List, Switch, Surface };
});

// ─── appStore mock ────────────────────────────────────────────────────────────
const mockSetPaydayDay = jest.fn();
jest.mock('../../../../stores/appStore', () => ({
  useAppStore: jest.fn((selector: (s: object) => unknown) =>
    selector({
      householdId: 'hh-test',
      paydayDay: 25,
      session: { user: { id: 'user-1' } },
      setPaydayDay: mockSetPaydayDay,
    }),
  ),
}));

// ─── CreateEnvelopeUseCase mock ───────────────────────────────────────────────
const mockExecute = jest.fn().mockResolvedValue({ success: true, data: { id: 'env-1' } });
jest.mock('../../../../../domain/envelopes/CreateEnvelopeUseCase', () => ({
  CreateEnvelopeUseCase: jest.fn().mockImplementation(() => ({ execute: mockExecute })),
}));

// ─── UpdateHouseholdPaydayDayUseCase mock ────────────────────────────────────
const mockPaydayExecute = jest.fn().mockResolvedValue({ success: true, data: undefined });
jest.mock('../../../../../domain/households/UpdateHouseholdPaydayDayUseCase', () => ({
  UpdateHouseholdPaydayDayUseCase: jest
    .fn()
    .mockImplementation(() => ({ execute: mockPaydayExecute })),
}));

// ─── onboardingFlag mock ──────────────────────────────────────────────────────
jest.mock('../../../../../infrastructure/storage/onboardingFlag', () => ({
  markOnboardingComplete: jest.fn().mockResolvedValue(undefined),
}));

// ─── DB / AuditLogger mocks ───────────────────────────────────────────────────
jest.mock('../../../../../data/local/db', () => ({ db: {} }));
jest.mock('../../../../../data/audit/AuditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ log: jest.fn() })),
}));
jest.mock('../../../../../domain/shared/BudgetPeriodEngine', () => ({
  BudgetPeriodEngine: jest.fn().mockImplementation(() => ({
    getCurrentPeriod: jest.fn(() => ({
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-30'),
      label: 'April 2026',
    })),
  })),
}));

import { WelcomeStep } from '../WelcomeStep';
import { IncomeStep } from '../IncomeStep';
import { PaydayStep } from '../PaydayStep';
import { FinishStep } from '../FinishStep';
import { markOnboardingComplete } from '../../../../../infrastructure/storage/onboardingFlag';

describe('WelcomeStep', () => {
  it('renders welcome title and CTA', () => {
    const { getByText } = render(<WelcomeStep />);
    expect(getByText('Welcome.')).toBeTruthy();
    expect(getByText("Let's begin")).toBeTruthy();
  });

  it('navigates to Income on CTA press', () => {
    mockNavigate.mockClear();
    const { getByText } = render(<WelcomeStep />);
    fireEvent.press(getByText("Let's begin"));
    expect(mockNavigate).toHaveBeenCalledWith('Income');
  });
});

describe('IncomeStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue({ success: true, data: { id: 'env-1' } });
  });

  it('renders title and amount input', () => {
    const { getByText } = render(<IncomeStep />);
    expect(getByText("What's your monthly income?")).toBeTruthy();
  });

  it('shows error when amount is 0', async () => {
    const { getByText, queryByTestId } = render(<IncomeStep />);
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
  });

  it('calls CreateEnvelopeUseCase with income type and navigates on success', async () => {
    const { getByText, getByTestId } = render(<IncomeStep />);
    fireEvent.changeText(getByTestId('Monthly income (R)'), '5000');
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('ExpenseCategories');
    });
  });
});

describe('PaydayStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPaydayExecute.mockResolvedValue({ success: true, data: undefined });
  });

  it('renders title and day input', () => {
    const { getByText } = render(<PaydayStep />);
    expect(getByText('When do you get paid?')).toBeTruthy();
  });

  it('shows error when day is out of range', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<PaydayStep />);
    fireEvent.changeText(getByTestId('Day of month (1–28)'), '32');
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(queryByTestId('helper-error')).toBeTruthy();
    });
  });

  it('calls UpdateHouseholdPaydayDayUseCase and navigates on valid input', async () => {
    const { getByText, getByTestId } = render(<PaydayStep />);
    fireEvent.changeText(getByTestId('Day of month (1–28)'), '20');
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(mockPaydayExecute).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('MeterSetup');
    });
  });
});

describe('FinishStep', () => {
  beforeEach(() => {
    mockReset.mockClear();
    (markOnboardingComplete as jest.Mock).mockClear();
  });

  it('renders completion title and CTA', () => {
    const { getByText } = render(<FinishStep />);
    expect(getByText('Your budget is ready.')).toBeTruthy();
    expect(getByText('Go to Dashboard')).toBeTruthy();
  });

  it('marks onboarding complete and navigates on CTA press', async () => {
    const { getByText } = render(<FinishStep />);
    fireEvent.press(getByText('Go to Dashboard'));
    await waitFor(() => {
      expect(markOnboardingComplete).toHaveBeenCalledWith('user-1', 'hh-test');
      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'Main' }],
      });
    });
  });
});

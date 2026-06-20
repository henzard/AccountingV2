import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Text: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('Text', { testID, ...p }, children),
    Surface: ({
      children,
      testID,
      ...p
    }: {
      children?: React.ReactNode;
      testID?: string;
      [k: string]: unknown;
    }) => React.createElement('View', { testID, ...p }, children),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement('Pressable', { onPress, testID }, children),
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Circle: () => React.createElement('View'),
    Rect: () => React.createElement('View'),
    Path: () => React.createElement('View'),
    Line: () => React.createElement('View'),
    G: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('View', null, children),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('Text', null, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

import { CurrentStepHero } from '../components/CurrentStepHero';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';

describe('CurrentStepHero', () => {
  const baseProps = {
    onToggleManual: jest.fn(),
    onNavigateToAddEnvelope: jest.fn(),
    onNavigateToAddDebt: jest.fn(),
  };

  it('renders auto step with progress (cents)', () => {
    const status: BabyStepStatus = {
      stepNumber: 1,
      isCompleted: false,
      isManual: false,
      progress: { current: 50000, target: 100000, unit: 'cents' },
      completedAt: null,
      celebratedAt: null,
    };
    const { getByTestId, getByText } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByTestId('current-step-hero')).toBeTruthy();
    expect(getByText(/R500.*R1/)).toBeTruthy();
  });

  it('renders auto step with count progress (debts)', () => {
    const status: BabyStepStatus = {
      stepNumber: 2,
      isCompleted: false,
      isManual: false,
      progress: { current: 2, target: 5, unit: 'count' },
      completedAt: null,
      celebratedAt: null,
    };
    const { getByText } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByText('2 of 5 debts cleared')).toBeTruthy();
  });

  it('renders manual step panel for step 4', () => {
    const status: BabyStepStatus = {
      stepNumber: 4,
      isCompleted: false,
      isManual: true,
      progress: null,
      completedAt: null,
      celebratedAt: null,
    };
    const { getByTestId } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByTestId('current-step-hero')).toBeTruthy();
  });

  it('renders no-data CTA for step 1 (no EMF)', () => {
    const status: BabyStepStatus = {
      stepNumber: 1,
      isCompleted: false,
      isManual: false,
      progress: null,
      completedAt: null,
      celebratedAt: null,
    };
    const { getByTestId } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByTestId('cta-no-emf')).toBeTruthy();
  });

  it('renders no-data CTA for step 3 (no income)', () => {
    const status: BabyStepStatus = {
      stepNumber: 3,
      isCompleted: false,
      isManual: false,
      progress: null,
      completedAt: null,
      celebratedAt: null,
    };
    const { getByTestId } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByTestId('cta-no-income')).toBeTruthy();
  });

  it('renders no-data CTA for step 2 (no debts)', () => {
    const status: BabyStepStatus = {
      stepNumber: 2,
      isCompleted: false,
      isManual: false,
      progress: null,
      completedAt: null,
      celebratedAt: null,
    };
    const { getByTestId } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByTestId('cta-no-debts')).toBeTruthy();
  });

  it('renders generic CTA for step 7 without progress when not manual', () => {
    const status: BabyStepStatus = {
      stepNumber: 7,
      isCompleted: false,
      isManual: false,
      progress: null,
      completedAt: null,
      celebratedAt: null,
    };
    const { getByTestId } = render(<CurrentStepHero {...baseProps} status={status} />);
    expect(getByTestId('cta-generic')).toBeTruthy();
  });
});

/**
 * OnboardingNavigator route order (UX-5/DOM-6, UX-15).
 *
 * The order is load-bearing, not cosmetic: `Payday` MUST come before
 * `AllocateEnvelopes`, because AllocateEnvelopes stamps every envelope it
 * creates with the `period_start` the current payday implies. With Payday
 * after it, the payday change moved the current-period key one screen later
 * and the whole freshly-created budget disappeared from the dashboard.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { ONBOARDING_STEP_ORDER } from '../onboardingSteps';

// Capture the registered route names in registration order. Every step is
// stubbed so this test does not drag in the real screens (and, through
// FinishStep, AsyncStorage) just to read a route list.
const mockRegisteredNames: string[] = [];

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: (): object => ({
    Navigator: ({ children }: { children?: React.ReactNode }): React.ReactNode => children,
    Screen: ({ name }: { name: string }): null => {
      mockRegisteredNames.push(name);
      return null;
    },
  }),
}));

jest.mock('../WelcomeStep', () => ({ WelcomeStep: (): null => null }));
jest.mock('../IncomeStep', () => ({ IncomeStep: (): null => null }));
jest.mock('../PaydayStep', () => ({ PaydayStep: (): null => null }));
jest.mock('../ExpenseCategoriesStep', () => ({ ExpenseCategoriesStep: (): null => null }));
jest.mock('../AllocateEnvelopesStep', () => ({ AllocateEnvelopesStep: (): null => null }));
jest.mock('../ScoreIntroStep', () => ({ ScoreIntroStep: (): null => null }));
jest.mock('../FinishStep', () => ({ FinishStep: (): null => null }));

import { OnboardingNavigator } from '../OnboardingNavigator';

describe('OnboardingNavigator', () => {
  beforeEach(() => {
    mockRegisteredNames.length = 0;
  });

  it('registers exactly the steps in ONBOARDING_STEP_ORDER, in that order', () => {
    render(<OnboardingNavigator />);
    expect(mockRegisteredNames).toEqual([...ONBOARDING_STEP_ORDER]);
  });

  it('puts Payday before AllocateEnvelopes', () => {
    render(<OnboardingNavigator />);
    expect(mockRegisteredNames.indexOf('Payday')).toBeLessThan(
      mockRegisteredNames.indexOf('AllocateEnvelopes'),
    );
  });

  it('no longer registers the placebo MeterSetup step', () => {
    render(<OnboardingNavigator />);
    expect(mockRegisteredNames).not.toContain('MeterSetup');
  });

  it('numbers every step consistently with the registered route list', () => {
    render(<OnboardingNavigator />);
    expect(ONBOARDING_STEP_ORDER).toHaveLength(mockRegisteredNames.length);
  });
});

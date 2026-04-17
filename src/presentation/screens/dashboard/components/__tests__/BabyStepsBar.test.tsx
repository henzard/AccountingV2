/**
 * BabyStepsBar.test.tsx — smoke tests for the PULSE baby steps bar.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BabyStepsBar } from '../BabyStepsBar';
import type { BabyStepStatus } from '../../../../../domain/babySteps/types';

function makeStatuses(completedCount: number): BabyStepStatus[] {
  return Array.from({ length: 7 }, (_, i) => ({
    stepNumber: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: i < completedCount,
    isManual: false,
    progress: null,
    completedAt: null,
    celebratedAt: null,
  }));
}

describe('BabyStepsBar', () => {
  it('renders without crashing', () => {
    const onPress = jest.fn();
    const { getByText } = render(<BabyStepsBar statuses={makeStatuses(0)} onPress={onPress} />);
    expect(getByText('BABY STEPS')).toBeTruthy();
  });

  it('shows completed count', () => {
    const { getByText } = render(<BabyStepsBar statuses={makeStatuses(3)} onPress={jest.fn()} />);
    expect(getByText('3 / 7')).toBeTruthy();
  });

  it('shows current step name', () => {
    const { getByText } = render(<BabyStepsBar statuses={makeStatuses(0)} onPress={jest.fn()} />);
    // Step 1 should be shown as current
    expect(getByText(/Step 1:/)).toBeTruthy();
  });

  it('shows all steps complete when all done', () => {
    const { getByText } = render(<BabyStepsBar statuses={makeStatuses(7)} onPress={jest.fn()} />);
    expect(getByText('All Baby Steps complete! 🎉')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<BabyStepsBar statuses={makeStatuses(2)} onPress={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows count progress line when step has count progress', () => {
    const statuses: BabyStepStatus[] = makeStatuses(0).map((s, i) =>
      i === 0 ? { ...s, progress: { unit: 'count' as const, current: 2, target: 5 } } : s,
    );
    const { getByText } = render(<BabyStepsBar statuses={statuses} onPress={jest.fn()} />);
    expect(getByText('2 of 5 debts cleared')).toBeTruthy();
  });

  it('shows currency progress line when step has money progress', () => {
    const statuses: BabyStepStatus[] = makeStatuses(0).map((s, i) =>
      i === 0
        ? { ...s, progress: { unit: 'cents' as const, current: 100000, target: 1000000 } }
        : s,
    );
    const { getByText } = render(<BabyStepsBar statuses={statuses} onPress={jest.fn()} />);
    // 100000 cents = R1 000 formatted
    expect(getByText(/R1/)).toBeTruthy();
  });
});

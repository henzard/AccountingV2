/**
 * ScoreBreakdownDialog.test.tsx — C8 component test
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import type { HabitScoreResult } from '../../../../../domain/scoring/RamseyScoreCalculator';

jest.mock('react-native-paper', () => {
  const React = jest.requireActual('react');
  const Dialog = ({
    children,
    visible,
    testID,
  }: {
    children?: React.ReactNode;
    visible?: boolean;
    testID?: string;
  }) => (visible ? React.createElement('View', { testID }, children) : null);
  Dialog.Title = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('Text', null, children);
  Dialog.Content = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  Dialog.Actions = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  return {
    Portal: ({ children }: { children?: React.ReactNode }) => children,
    Dialog,
    Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID }, children),
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

import { ScoreBreakdownDialog } from '../ScoreBreakdownDialog';

const RESULT = {
  score: 62,
  loggingPoints: 20,
  disciplinePoints: 22,
  metersPoints: 0,
  babyStepPoints: 20,
  metersApplicable: true,
};

/** The same household, but one that has never used meters at all. */
const RESULT_METERS_NOT_APPLICABLE: HabitScoreResult = {
  score: 78,
  loggingPoints: 20,
  disciplinePoints: 22,
  metersPoints: null,
  babyStepPoints: 20,
  metersApplicable: false,
};

describe('ScoreBreakdownDialog', () => {
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <ScoreBreakdownDialog visible={false} onDismiss={jest.fn()} result={RESULT} />,
    );
    expect(queryByTestId('score-breakdown-dialog')).toBeNull();
  });

  it('shows every point component the calculator returned', () => {
    const { getByText } = render(
      <ScoreBreakdownDialog visible onDismiss={jest.fn()} result={RESULT} />,
    );
    expect(getByText('20 / 30')).toBeTruthy(); // loggingPoints
    expect(getByText('22 / 30')).toBeTruthy(); // disciplinePoints
    expect(getByText('0 / 20')).toBeTruthy(); // metersPoints
    expect(getByText('20 / 20')).toBeTruthy(); // babyStepPoints
    expect(getByText('62 / 100')).toBeTruthy(); // total
  });

  it('says a never-used component was not counted, instead of reporting it as 0 / 20', () => {
    const { getByText, queryByText } = render(
      <ScoreBreakdownDialog visible onDismiss={jest.fn()} result={RESULT_METERS_NOT_APPLICABLE} />,
    );
    expect(getByText('not used, not counted')).toBeTruthy();
    expect(queryByText('0 / 20')).toBeNull();
    // The other components, and the re-normalised total, still read normally.
    expect(getByText('20 / 30')).toBeTruthy();
    expect(getByText('78 / 100')).toBeTruthy();
  });

  it('calls onDismiss when Close is pressed', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <ScoreBreakdownDialog visible onDismiss={onDismiss} result={RESULT} />,
    );
    fireEvent.press(getByTestId('score-breakdown-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

/**
 * ScoreIntroStep.test.tsx — B1
 *
 * Tests:
 *   - Renders explainer body text and continue button.
 *   - Continue button navigates to Finish.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─── Navigation mock ──────────────────────────────────────────────────────────
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// ─── react-native-paper mocks ─────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('Text', p, children);
  const Button = ({
    children,
    onPress,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
    [k: string]: unknown;
  }) =>
    React.createElement(
      'TouchableOpacity',
      { onPress, testID, ...p },
      React.createElement('Text', {}, children),
    );
  const Surface = ({ children, ...p }: { children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('View', p, children);
  return { Text, Button, Surface };
});

import { ScoreIntroStep } from '../ScoreIntroStep';

describe('ScoreIntroStep', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders the explainer title', () => {
    const { getByText } = render(<ScoreIntroStep />);
    expect(getByText('Your Habit Score')).toBeTruthy();
  });

  it('renders explainer body content', () => {
    const { getByText } = render(<ScoreIntroStep />);
    expect(getByText('How it works')).toBeTruthy();
    // Check at least one score band label
    expect(getByText('0–49')).toBeTruthy();
  });

  it('renders Continue button', () => {
    const { getByText } = render(<ScoreIntroStep />);
    expect(getByText('Continue')).toBeTruthy();
  });

  it('pressing Continue navigates to Finish', () => {
    const { getByText } = render(<ScoreIntroStep />);
    fireEvent.press(getByText('Continue'));
    expect(mockNavigate).toHaveBeenCalledWith('Finish');
  });
});

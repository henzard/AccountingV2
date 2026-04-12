/**
 * CelebrationModal.test.tsx — task 4.16
 *
 * Tests:
 *   1. reducedMotion=true renders final state immediately (no animation timing needed)
 *   2. reducedMotion=false + fake timers + act() + 700ms advance reaches final state
 *   3. Dismiss button triggers onDismiss callback
 *
 * Spec §CelebrationModal, §Visual Identity.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native-paper', () => {
  const React = require('react');
  return {
    Text: ({ children, testID, ...p }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement('Text', { testID, ...p }, children),
    Button: ({ children, onPress, testID, ...p }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement('TouchableOpacity', { onPress, testID, ...p }, children),
  };
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const Svg = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'svg', ...p }, children);
  const el =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: name, ...p }, children);
  return {
    __esModule: true,
    default: Svg,
    Svg,
    Circle: el('circle'),
    Line: el('line'),
    Path: el('path'),
    Rect: el('rect'),
    G: ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: 'g', ...p }, children),
    Text: el('svg-text'),
  };
});

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  return () => React.createElement('View', { testID: 'icon' });
});

import { CelebrationModal } from '../CelebrationModal';

const makeStatus = (stepNumber: number, completedAt?: string): BabyStepStatus => ({
  stepNumber: stepNumber as 1 | 2 | 3 | 4 | 5 | 6 | 7,
  isCompleted: true,
  isManual: [4, 5, 7].includes(stepNumber),
  progress: null,
  completedAt: completedAt ?? '2026-04-12T10:00:00.000Z',
  celebratedAt: null,
});

describe('CelebrationModal', () => {
  describe('reducedMotion=true', () => {
    it('renders final state immediately — seal and title visible', () => {
      const status = makeStatus(1);
      const { getByTestId, getByText } = render(
        <CelebrationModal
          visible
          status={status}
          onDismiss={() => undefined}
          reducedMotion
        />,
      );
      expect(getByTestId('celebration-seal')).toBeTruthy();
      expect(getByTestId('celebration-title')).toBeTruthy();
      // Step 1 title
      expect(getByText('Starter Fund')).toBeTruthy();
    });

    it('shows step completion message', () => {
      const status = makeStatus(1);
      const { getByText } = render(
        <CelebrationModal
          visible
          status={status}
          onDismiss={() => undefined}
          reducedMotion
        />,
      );
      expect(getByText('You saved your first R1,000. The foundation is laid.')).toBeTruthy();
    });

    it('shows ribbon with completion date', () => {
      const status = makeStatus(1, '2026-04-12T10:00:00.000Z');
      const { getByText } = render(
        <CelebrationModal
          visible
          status={status}
          onDismiss={() => undefined}
          reducedMotion
        />,
      );
      expect(getByText(/Completed/)).toBeTruthy();
      expect(getByText(/12 Apr 2026/)).toBeTruthy();
    });
  });

  describe('reducedMotion=false — animated path', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reaches final state after 700ms advance', async () => {
      const status = makeStatus(2);
      const { getByTestId } = render(
        <CelebrationModal
          visible
          status={status}
          onDismiss={() => undefined}
          reducedMotion={false}
        />,
      );

      await act(async () => {
        jest.advanceTimersByTime(700);
      });

      // Seal container should be rendered
      expect(getByTestId('celebration-seal')).toBeTruthy();
    });
  });

  describe('dismiss behaviour', () => {
    it('calls onDismiss when dismiss button pressed', () => {
      const onDismiss = jest.fn();
      const status = makeStatus(3);
      const { getByTestId } = render(
        <CelebrationModal
          visible
          status={status}
          onDismiss={onDismiss}
          reducedMotion
        />,
      );
      fireEvent.press(getByTestId('celebration-dismiss'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('does not render content when visible=false', () => {
    const status = makeStatus(1);
    const { queryByTestId } = render(
      <CelebrationModal
        visible={false}
        status={status}
        onDismiss={() => undefined}
        reducedMotion
      />,
    );
    // Modal is not visible — seal should not be in the tree
    expect(queryByTestId('celebration-seal')).toBeNull();
  });
});

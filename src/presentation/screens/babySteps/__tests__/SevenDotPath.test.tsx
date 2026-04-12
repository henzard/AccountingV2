/**
 * SevenDotPath.test.tsx — task 4.19
 *
 * Tests:
 *   - Compact fallback renders at width < 360dp
 *   - Full layout renders at width >= 360dp
 *
 * Spec §SevenDotPath.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native-svg', () => {
  const React = require('react');
  const MockSvg = ({ children, ...p }: { children?: React.ReactNode }) =>
    React.createElement('View', { testID: 'svg', ...p }, children);
  const el =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: name, ...p }, children);
  return {
    __esModule: true,
    default: MockSvg,
    Svg: MockSvg,
    Circle: el('circle'),
    Line: el('line'),
    Path: el('path'),
    Rect: el('rect'),
    G: ({ children, ...p }: { children?: React.ReactNode }) =>
      React.createElement('View', { testID: 'g', ...p }, children),
    Text: el('svg-text'),
  };
});

let mockWindowWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  default: jest.fn(() => ({ width: mockWindowWidth, height: 844 })),
}));

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  return () => React.createElement('View', { testID: 'icon' });
});

import { SevenDotPath } from '../components/SevenDotPath';

const makeStatuses = (completedCount: number): BabyStepStatus[] =>
  Array.from({ length: 7 }, (_, i) => ({
    stepNumber: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: i < completedCount,
    isManual: [4, 5, 7].includes(i + 1),
    progress: null,
    completedAt: i < completedCount ? '2026-04-12T10:00:00.000Z' : null,
    celebratedAt: null,
  }));

describe('SevenDotPath', () => {
  describe('compact fallback (width < 360)', () => {
    beforeEach(() => {
      mockWindowWidth = 320;
    });

    it('renders compact text with step number and title', () => {
      const statuses = makeStatuses(2);
      const { getByText } = render(
        <SevenDotPath statuses={statuses} reducedMotion />,
      );
      // Current step is step 3 (first incomplete)
      expect(getByText(/Step 3 of 7/)).toBeTruthy();
    });

    it('renders filled/empty dot ratio string', () => {
      const statuses = makeStatuses(2);
      const { getByText } = render(
        <SevenDotPath statuses={statuses} reducedMotion />,
      );
      // 2 filled, 5 empty
      expect(getByText('●●○○○○○')).toBeTruthy();
    });

    it('renders all filled when all complete', () => {
      const statuses = makeStatuses(7);
      const { getByText } = render(
        <SevenDotPath statuses={statuses} reducedMotion />,
      );
      expect(getByText('●●●●●●●')).toBeTruthy();
    });
  });

  describe('full layout (width >= 360)', () => {
    beforeEach(() => {
      mockWindowWidth = 390;
    });

    it('renders without compact text', () => {
      const statuses = makeStatuses(2);
      const { queryByText } = render(
        <SevenDotPath statuses={statuses} reducedMotion />,
      );
      // The compact dot string should NOT appear
      expect(queryByText('●●○○○○○')).toBeNull();
    });

    it('has the correct accessibilityLabel', () => {
      const statuses = makeStatuses(2);
      const { getByLabelText } = render(
        <SevenDotPath statuses={statuses} reducedMotion />,
      );
      expect(
        getByLabelText('Baby Steps progress: 2 of 7 steps complete, currently on Step 3'),
      ).toBeTruthy();
    });
  });
});

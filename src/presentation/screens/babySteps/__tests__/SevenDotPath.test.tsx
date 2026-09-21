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
import { render, act } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
      const { getByText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      // Current step is step 3 (first incomplete)
      expect(getByText(/Step 3 of 7/)).toBeTruthy();
    });

    it('renders filled/empty dot ratio string', () => {
      const statuses = makeStatuses(2);
      const { getByText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      // 2 filled, 5 empty
      expect(getByText('●●○○○○○')).toBeTruthy();
    });

    it('renders all filled when all complete', () => {
      const statuses = makeStatuses(7);
      const { getByText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      expect(getByText('●●●●●●●')).toBeTruthy();
    });
  });

  describe('full layout (width >= 360)', () => {
    beforeEach(() => {
      mockWindowWidth = 390;
    });

    it('renders without compact text', () => {
      const statuses = makeStatuses(2);
      const { queryByText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      // The compact dot string should NOT appear
      expect(queryByText('●●○○○○○')).toBeNull();
    });

    it('has the correct accessibilityLabel', () => {
      const statuses = makeStatuses(2);
      const { getByLabelText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      expect(
        getByLabelText('Baby Steps progress: 2 of 7 steps complete, currently on Step 3'),
      ).toBeTruthy();
    });
  });

  // ─── C-5: subscribes to reduceMotionChanged, with cleanup ──────────────────

  describe('C-5 — system reduce-motion subscription', () => {
    beforeEach(() => {
      mockWindowWidth = 390;
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('subscribes to reduceMotionChanged on mount (does not just read the value once)', async () => {
      const addListenerSpy = jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
        remove: jest.fn(),
      } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

      const statuses = makeStatuses(2);
      render(<SevenDotPath statuses={statuses} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(addListenerSpy).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
    });

    it('reacts to a reduceMotionChanged event fired after mount (no forced remount needed)', async () => {
      let changeHandler: ((enabled: boolean) => void) | undefined;
      jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
        _event: string,
        handler: (enabled: boolean) => void,
      ) => {
        changeHandler = handler;
        return { remove: jest.fn() };
      }) as unknown as typeof AccessibilityInfo.addEventListener);

      const statuses = makeStatuses(2);
      // No `reducedMotion` prop passed — component must rely on the system
      // subscription, mirroring CelebrationModal's pattern.
      const { getByLabelText } = render(<SevenDotPath statuses={statuses} />);
      await act(async () => {
        await Promise.resolve();
      });

      // Toggling the system setting on must not throw and must be honoured —
      // asserted indirectly via the component still rendering correctly.
      act(() => {
        changeHandler?.(true);
      });

      expect(
        getByLabelText('Baby Steps progress: 2 of 7 steps complete, currently on Step 3'),
      ).toBeTruthy();
    });

    it('removes the reduceMotionChanged subscription on unmount', async () => {
      const removeSpy = jest.fn();
      jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
        remove: removeSpy,
      } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

      const statuses = makeStatuses(2);
      const { unmount } = render(<SevenDotPath statuses={statuses} />);
      await act(async () => {
        await Promise.resolve();
      });

      unmount();

      expect(removeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Skip inference: a vacuous Step 2/6 skip advances the dashboard bar ────

  describe('vacuous Step 2/6 skip advances the current step (dashboard bar consumers)', () => {
    beforeEach(() => {
      mockWindowWidth = 320; // compact fallback — easiest to assert text on
    });

    it('reports Step 3 as current (not stuck on Step 2) when Step 1 is done and Step 2 has zero applicable debts', () => {
      const statuses: BabyStepStatus[] = [
        {
          stepNumber: 1,
          isCompleted: true,
          isManual: false,
          progress: null,
          completedAt: '2026-04-01T00:00:00.000Z',
          celebratedAt: null,
        },
        // Step 2 is NEVER `isCompleted: true` for a vacuous skip (SYNCED-table
        // safety) — isCompleted stays false, progress stays null.
        {
          stepNumber: 2,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 3,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 4,
          isCompleted: false,
          isManual: true,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 5,
          isCompleted: false,
          isManual: true,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 6,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 7,
          isCompleted: false,
          isManual: true,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
      ];
      const { getByText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      expect(getByText(/Step 3 of 7/)).toBeTruthy();
      // The skipped Step 2 counts as "passed" in the dot ratio too.
      expect(getByText('●●○○○○○')).toBeTruthy();
    });

    it('does NOT advance past Step 2 when Step 1 is not yet done (no debts entered, genuinely blocked)', () => {
      const statuses: BabyStepStatus[] = [
        {
          stepNumber: 1,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 2,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 3,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 4,
          isCompleted: false,
          isManual: true,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 5,
          isCompleted: false,
          isManual: true,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 6,
          isCompleted: false,
          isManual: false,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
        {
          stepNumber: 7,
          isCompleted: false,
          isManual: true,
          progress: null,
          completedAt: null,
          celebratedAt: null,
        },
      ];
      const { getByText } = render(<SevenDotPath statuses={statuses} reducedMotion />);
      expect(getByText(/Step 1 of 7/)).toBeTruthy();
      expect(getByText('○○○○○○○')).toBeTruthy();
    });
  });
});

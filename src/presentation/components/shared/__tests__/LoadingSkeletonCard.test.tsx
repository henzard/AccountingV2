import React from 'react';
import { render, act } from '@testing-library/react-native';
import { Animated, AccessibilityInfo } from 'react-native';
import { LoadingSkeletonCard } from '../LoadingSkeletonCard';

describe('LoadingSkeletonCard', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: jest.fn(),
    } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders without crashing', () => {
    const { toJSON } = render(<LoadingSkeletonCard />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders multiple skeleton lines', () => {
    const tree = render(<LoadingSkeletonCard />);
    const json = tree.toJSON() as { children?: unknown[] };
    expect(json).toBeTruthy();
    expect(json.children?.length).toBe(3);
  });

  // ─── C-4: stop the Animated.loop on unmount ────────────────────────────────

  it('C-4: stops the shimmer Animated.loop on unmount (does not keep animating forever)', async () => {
    const stopSpy = jest.fn();
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue({
      start: jest.fn(),
      stop: stopSpy,
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation);

    const { unmount } = render(<LoadingSkeletonCard />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(loopSpy).toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();

    unmount();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  // ─── C-4: reduce-motion — no animation, static skeleton ────────────────────

  it('C-4: does not start Animated.loop when AccessibilityInfo.isReduceMotionEnabled() resolves true', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const loopSpy = jest.spyOn(Animated, 'loop');

    render(<LoadingSkeletonCard />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loopSpy).not.toHaveBeenCalled();
  });

  it('C-4: reacts to reduceMotionChanged while mounted — stops an in-progress loop', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(false);
    let changeHandler: ((enabled: boolean) => void) | undefined;
    (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(
      (_event: string, handler: (enabled: boolean) => void) => {
        changeHandler = handler;
        return { remove: jest.fn() };
      },
    );
    const stopSpy = jest.fn();
    jest.spyOn(Animated, 'loop').mockReturnValue({
      start: jest.fn(),
      stop: stopSpy,
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation);

    render(<LoadingSkeletonCard />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(stopSpy).not.toHaveBeenCalled();

    act(() => {
      changeHandler?.(true);
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('C-4: removes the reduceMotionChanged subscription on unmount', async () => {
    const removeSpy = jest.fn();
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: removeSpy,
    } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);

    const { unmount } = render(<LoadingSkeletonCard />);
    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});

import { renderHook, act } from '@testing-library/react-native';

let mockUserLevel = 1;
const mockSetUserLevel = jest.fn();

jest.mock('../../stores/appStore', () => ({
  useAppStore: (sel: (s: { userLevel: number; setUserLevel: (n: number) => void }) => unknown) =>
    sel({ userLevel: mockUserLevel, setUserLevel: mockSetUserLevel }),
}));

import { useLevelAdvancement } from '../useLevelAdvancement';

describe('useLevelAdvancement', () => {
  beforeEach(() => {
    mockUserLevel = 1;
    mockSetUserLevel.mockClear();
  });

  it('advances to level 2 when 3 consecutive scores >= 70', () => {
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([75, 80, 90]);
    });
    expect(mockSetUserLevel).toHaveBeenCalledWith(2);
  });

  it('does not advance when scores are below threshold', () => {
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([50, 60, 40]);
    });
    expect(mockSetUserLevel).not.toHaveBeenCalled();
  });

  it('does not advance when already at level 2', () => {
    mockUserLevel = 2;
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([90, 95, 85]);
    });
    expect(mockSetUserLevel).not.toHaveBeenCalled();
  });

  it('does not advance with fewer than 3 scores', () => {
    const { result } = renderHook(() => useLevelAdvancement());
    act(() => {
      result.current.check([80, 90]);
    });
    expect(mockSetUserLevel).not.toHaveBeenCalled();
  });
});

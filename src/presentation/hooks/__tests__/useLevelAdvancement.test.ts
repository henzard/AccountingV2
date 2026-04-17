import { renderHook, act } from '@testing-library/react-native';

jest.mock('../../../data/local/db', () => ({ db: {} }));

const mockSetUserLevel = jest.fn();

jest.mock('../../stores/appStore', () => ({
  useAppStore: jest.fn((sel: (s: object) => unknown) =>
    sel({
      householdId: 'hh-1',
      userLevel: 1,
      setUserLevel: mockSetUserLevel,
    }),
  ),
}));

import { useLevelAdvancement } from '../useLevelAdvancement';

beforeEach(() => {
  mockSetUserLevel.mockClear();
});

it('exports a check function', () => {
  const { result } = renderHook(() => useLevelAdvancement());
  expect(typeof result.current.check).toBe('function');
});

it('does not advance when scores are too low', () => {
  const { result } = renderHook(() => useLevelAdvancement());
  act(() => {
    result.current.check([50, 55, 60]);
  });
  expect(mockSetUserLevel).not.toHaveBeenCalled();
});

it('advances to level 2 when last 3 scores all >= 70', () => {
  const { result } = renderHook(() => useLevelAdvancement());
  act(() => {
    result.current.check([80, 75, 70]);
  });
  expect(mockSetUserLevel).toHaveBeenCalledWith(2);
});

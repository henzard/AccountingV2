import { renderHook, act } from '@testing-library/react-native';

let mockUserLevel = 1;
const mockSetUserLevel = jest.fn();

jest.mock('../../stores/appStore', () => ({
  useAppStore: (sel: (s: { userLevel: number; setUserLevel: (n: number) => void }) => unknown) =>
    sel({ userLevel: mockUserLevel, setUserLevel: mockSetUserLevel }),
}));

jest.mock('../../../data/local/db', () => ({ db: {} }));

const mockGetPeriodScoresAscending = jest.fn();
jest.mock('../../../domain/scoring/getPeriodScoresAscending', () => ({
  getPeriodScoresAscending: (...args: unknown[]) => mockGetPeriodScoresAscending(...args),
}));

import { useLevelAdvancement } from '../useLevelAdvancement';

function scoreRows(scores: number[]): { periodStart: string; score: number }[] {
  return scores.map((score, i) => ({
    periodStart: `2026-0${i + 1}-01`,
    score,
  }));
}

describe('useLevelAdvancement', () => {
  beforeEach(() => {
    mockUserLevel = 1;
    mockSetUserLevel.mockClear();
    mockGetPeriodScoresAscending.mockReset();
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

  // ── hydrate: derives the level from durable local score_history (VAL-14/DOM-13 follow-up) ──
  //
  // NOTE on scope: `LevelAdvancementEvaluator` only defines a Level 1 -> 2
  // rule today. There is no Level 2 -> 3 (Mentor) rule anywhere in the
  // codebase or product spec — the PRD (_bmad-output/planning-artifacts/prd.md,
  // FR-34/FR-50) instead describes Mentor as an invited/linked advisor role,
  // not one reached by score, and a planning doc explicitly notes "no
  // current spec" for it. So there is no "history that earns Lv3" case to
  // test against real code — `hydrate` is written to advance one level per
  // pass and stop when nothing further qualifies, which today always means
  // it settles at Lv1 or Lv2 (asserted below), and needs no changes if a
  // real Lv2->Lv3 rule is ever added.
  describe('hydrate', () => {
    it('stays at Lv1 when the household has no recorded score history', async () => {
      mockGetPeriodScoresAscending.mockResolvedValue([]);
      const { result } = renderHook(() => useLevelAdvancement());

      await act(async () => {
        await result.current.hydrate('hh-1');
      });

      expect(mockGetPeriodScoresAscending).toHaveBeenCalledWith(expect.anything(), 'hh-1');
      expect(mockSetUserLevel).toHaveBeenCalledWith(1);
    });

    it('hydrates to Lv2 from a fresh store when history qualifies (last 3 scores >= 70)', async () => {
      mockGetPeriodScoresAscending.mockResolvedValue(scoreRows([40, 75, 80, 90]));
      const { result } = renderHook(() => useLevelAdvancement());

      await act(async () => {
        await result.current.hydrate('hh-1');
      });

      expect(mockSetUserLevel).toHaveBeenCalledWith(2);
    });

    it('does not advance past Lv2 even for a long, uniformly high-scoring history (no Lv2->3 rule exists yet)', async () => {
      mockGetPeriodScoresAscending.mockResolvedValue(scoreRows(Array(12).fill(95)));
      const { result } = renderHook(() => useLevelAdvancement());

      await act(async () => {
        await result.current.hydrate('hh-1');
      });

      expect(mockSetUserLevel).toHaveBeenCalledWith(2);
      expect(mockSetUserLevel).not.toHaveBeenCalledWith(3);
    });

    it('is idempotent — hydrating twice for the same unchanged history yields the same level', async () => {
      mockGetPeriodScoresAscending.mockResolvedValue(scoreRows([75, 80, 90]));
      const { result } = renderHook(() => useLevelAdvancement());

      await act(async () => {
        await result.current.hydrate('hh-1');
      });
      await act(async () => {
        await result.current.hydrate('hh-1');
      });

      expect(mockSetUserLevel).toHaveBeenNthCalledWith(1, 2);
      expect(mockSetUserLevel).toHaveBeenNthCalledWith(2, 2);
    });

    it('switching household re-hydrates for the new household — one with no history drops back to Lv1', async () => {
      mockGetPeriodScoresAscending.mockImplementation((_db: unknown, householdId: string) =>
        Promise.resolve(householdId === 'hh-1' ? scoreRows([75, 80, 90]) : []),
      );
      const { result } = renderHook(() => useLevelAdvancement());

      await act(async () => {
        await result.current.hydrate('hh-1');
      });
      expect(mockSetUserLevel).toHaveBeenLastCalledWith(2);

      await act(async () => {
        await result.current.hydrate('hh-2');
      });
      expect(mockSetUserLevel).toHaveBeenLastCalledWith(1);
    });
  });
});

export interface LevelEvaluationResult {
  shouldAdvanceToLevel2: boolean;
  shouldAdvanceToLevel3: boolean;
  shouldShowCoachingWarning: boolean;
}

/** `households.user_level`'s three values, as the UI names them. */
export const LEVEL_NAMES: Record<1 | 2 | 3, string> = {
  1: 'Learner',
  2: 'Practitioner',
  3: 'Mentor',
};

/** Highest level reachable from score history. */
export const MAX_LEVEL = 3;

/**
 * Every level threshold in one place, so "what does it take to level up" is
 * a single readable block rather than magic numbers scattered through the
 * evaluator and the progress copy.
 *
 * `level2` and `coachingWarning` are the rules that have always shipped:
 * three consecutive periods scoring 70+, and two consecutive periods under
 * 60 respectively.
 *
 * PRODUCT DEFAULT, AWAITING CONFIRMATION — `level3`: no Level 2 -> 3 rule
 * has ever been specified anywhere in this codebase or the PRD (the PRD's
 * only mention of "Mentor" is FR-50's invited-advisor role, which is a
 * different thing entirely), and the level therefore could never be reached.
 * This is the most natural extension of the SAME shape as `level2` — "N
 * consecutive periods at or above S" — with both dials turned up: twice the
 * streak (6 periods, half a year of sustained habit) at a stricter score
 * (85+, which on this scoring formula means near-total logging AND nearly
 * every envelope on budget, not merely a passing grade). Change these two
 * numbers, and nothing else, once product confirms the real rule.
 */
export const LEVEL_RULES = {
  /** Learner -> Practitioner. */
  level2: { streak: 3, minScore: 70 },
  /** Practitioner -> Mentor. See the PRODUCT DEFAULT note above. */
  level3: { streak: 6, minScore: 85 },
  /** Two consecutive periods below this ask the coach to step in. */
  coachingWarning: { streak: 2, belowScore: 60 },
} as const;

/** True when the LAST `streak` entries of `scores` all reach `minScore`. */
function hasTrailingStreak(scores: number[], streak: number, minScore: number): boolean {
  const tail = scores.slice(-streak);
  return tail.length >= streak && tail.every((s) => s >= minScore);
}

/** How many of the final entries of `scores` reach `minScore`, counting back from the newest. */
function trailingStreakLength(scores: number[], minScore: number): number {
  let count = 0;
  for (let i = scores.length - 1; i >= 0; i -= 1) {
    if (scores[i] < minScore) break;
    count += 1;
  }
  return count;
}

export class LevelAdvancementEvaluator {
  evaluate(recentScores: number[]): LevelEvaluationResult {
    const shouldAdvanceToLevel2 = hasTrailingStreak(
      recentScores,
      LEVEL_RULES.level2.streak,
      LEVEL_RULES.level2.minScore,
    );

    const shouldAdvanceToLevel3 = hasTrailingStreak(
      recentScores,
      LEVEL_RULES.level3.streak,
      LEVEL_RULES.level3.minScore,
    );

    const lastTwo = recentScores.slice(-LEVEL_RULES.coachingWarning.streak);
    const shouldShowCoachingWarning =
      lastTwo.length >= LEVEL_RULES.coachingWarning.streak &&
      lastTwo.every((s) => s < LEVEL_RULES.coachingWarning.belowScore);

    return { shouldAdvanceToLevel2, shouldAdvanceToLevel3, shouldShowCoachingWarning };
  }
}

/**
 * The level `scores` (oldest period first) earns, replayed from Level 1.
 *
 * Pure, and deliberately NOT anchored to whatever level is already stored:
 * callers that must never demote (see `PersistUserLevelUseCase`) take the
 * max of this and the stored level themselves, so the "never go down" rule
 * lives in exactly one place instead of being baked into the maths.
 */
export function deriveLevelFromScores(scores: number[]): 1 | 2 | 3 {
  const { shouldAdvanceToLevel2, shouldAdvanceToLevel3 } = new LevelAdvancementEvaluator().evaluate(
    scores,
  );
  if (shouldAdvanceToLevel2 && shouldAdvanceToLevel3) return 3;
  if (shouldAdvanceToLevel2) return 2;
  return 1;
}

export interface LevelProgress {
  level: 1 | 2 | 3;
  levelName: string;
  /** The level this household is working towards, or null at the ceiling. */
  nextLevelName: string | null;
  /** Periods still needed at `minScore`, or null at the ceiling. */
  periodsRemaining: number | null;
  /** The score each of those periods has to reach, or null at the ceiling. */
  minScore: number | null;
  /** Plain-language progress line, e.g. "2 more periods scoring 70+ to reach Practitioner". */
  message: string;
}

/**
 * What this household still has to do to reach the next level, in the words
 * the UI shows. `scores` is oldest period first.
 *
 * "Periods remaining" counts the CURRENT trailing run: a household with two
 * consecutive 70+ periods needs one more, and one whose last period dipped
 * below the threshold starts the run again — which is exactly how
 * `evaluate` decides, so the promise this line makes is the promise the
 * evaluator keeps.
 */
export function describeLevelProgress(level: 1 | 2 | 3, scores: number[]): LevelProgress {
  const levelName = LEVEL_NAMES[level];

  if (level >= MAX_LEVEL) {
    return {
      level,
      levelName,
      nextLevelName: null,
      periodsRemaining: null,
      minScore: null,
      message: `${levelName} is the highest level — keep it up.`,
    };
  }

  const rule = level === 1 ? LEVEL_RULES.level2 : LEVEL_RULES.level3;
  const nextLevelName = LEVEL_NAMES[(level + 1) as 2 | 3];
  const done = Math.min(trailingStreakLength(scores, rule.minScore), rule.streak);
  const periodsRemaining = Math.max(0, rule.streak - done);

  return {
    level,
    levelName,
    nextLevelName,
    periodsRemaining,
    minScore: rule.minScore,
    message:
      periodsRemaining === 0
        ? `Ready for ${nextLevelName}.`
        : `${periodsRemaining} more period${periodsRemaining === 1 ? '' : 's'} scoring ${rule.minScore}+ to reach ${nextLevelName}.`,
  };
}

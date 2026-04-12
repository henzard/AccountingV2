/**
 * Shared Baby Steps domain types.
 * Exported from src/domain/babySteps/types.ts — also re-exported via index if added.
 */

export type BabyStepStatus = {
  stepNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  isCompleted: boolean;
  isManual: boolean;
  progress: { current: number; target: number; unit: 'cents' | 'count' } | null;
  completedAt: string | null;
  celebratedAt: string | null;
};

export type ReconcileResult = {
  statuses: BabyStepStatus[];
  newlyCompleted: number[];
  newlyRegressed: number[];
};

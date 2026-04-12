/**
 * CelebrationModalHost — reads celebrationStore.queue head and presents the
 * CelebrationModal. On dismiss: stamps celebrated_at via StampCelebratedUseCase,
 * then dequeues and repeats while queue is non-empty.
 *
 * Mounted at navigator root so it appears regardless of the current screen.
 * Spec §Host mounting, task 4.7.
 */

import React, { useCallback } from 'react';
import { useCelebrationStore } from '../../stores/celebrationStore';
import { CelebrationModal } from './CelebrationModal';
import { db } from '../../../data/local/db';
import { StampCelebratedUseCase } from '../../../domain/babySteps/StampCelebratedUseCase';
import { useAppStore } from '../../stores/appStore';
import type { BabyStepStatus } from '../../../domain/babySteps/types';
import { BABY_STEP_RULES } from '../../../domain/babySteps/BabyStepRules';

const stampUseCase = new StampCelebratedUseCase(db);

function makePlaceholderStatus(stepNumber: number): BabyStepStatus {
  return {
    stepNumber: stepNumber as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: true,
    isManual: BABY_STEP_RULES[stepNumber as keyof typeof BABY_STEP_RULES]?.isManual ?? false,
    progress: null,
    completedAt: new Date().toISOString(),
    celebratedAt: null,
  };
}

export const CelebrationModalHost: React.FC = () => {
  const queue = useCelebrationStore((s) => s.queue);
  const dequeue = useCelebrationStore((s) => s.dequeue);
  const householdId = useAppStore((s) => s.householdId);

  const head = queue[0] ?? null;

  const handleDismiss = useCallback(async () => {
    if (!head || !householdId) return;

    // 1. Stamp celebrated_at
    await stampUseCase.execute(householdId, head.stepNumber);

    // 2. Dequeue — next head will render automatically
    dequeue();
  }, [head, householdId, dequeue]);

  if (!head || !householdId) {
    return null;
  }

  const status = makePlaceholderStatus(head.stepNumber);

  return (
    <CelebrationModal
      visible
      status={status}
      onDismiss={handleDismiss}
    />
  );
};

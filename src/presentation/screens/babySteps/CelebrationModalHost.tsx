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
import { logger } from '../../../infrastructure/logging/Logger';
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
  const householdId = useAppStore((s) => s.householdId);

  const head = queue[0] ?? null;

  const handleDismiss = useCallback(() => {
    const currentHead = useCelebrationStore.getState().queue[0];
    if (!currentHead || !householdId) return;

    // Fire-and-forget; dequeue unconditionally so a stamp failure never freezes UI.
    (async (): Promise<void> => {
      try {
        await stampUseCase.execute(householdId, currentHead.stepNumber);
      } catch (e) {
        logger.warn('[CelebrationModalHost] stamp failed', { err: e });
      } finally {
        useCelebrationStore.getState().dequeue();
      }
    })();
  }, [householdId]);

  if (!head || !householdId) {
    return null;
  }

  const status = makePlaceholderStatus(head.stepNumber);

  return <CelebrationModal visible status={status} onDismiss={handleDismiss} />;
};

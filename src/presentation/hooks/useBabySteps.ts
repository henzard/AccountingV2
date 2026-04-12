/**
 * useBabySteps — presentation hook for Baby Steps domain.
 *
 * Exposes { statuses, reconcile, toggleManualStep }.
 *
 * Design:
 * - Reconcile is coalesced via useRef<Promise | null> — a second concurrent call
 *   returns the in-flight promise rather than starting a new DB sequence.
 * - Runs reconcile() on mount and when triggered externally, but ONLY when
 *   AppState.currentState === 'active'.
 * - Subscribes to AppState 'change' events; on 'active' transition, re-reconciles.
 * - On newlyCompleted: enqueues to celebrationStore (store handles dedup).
 * - On newlyRegressed: enqueues regression toast to toastStore with canonical copy
 *   from BabyStepRules.
 * - Background path (task 3.7): if reconcile runs while backgrounded and finds newly
 *   completed steps, calls LocalNotificationScheduler.fireBabyStepCelebration(n) as
 *   a preview signal. On next foreground, re-reconcile picks up celebrated_at=null and
 *   enqueues the modal.
 *
 * Spec §Presentation layer — useBabySteps, §Concurrency guards, §Data flow.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { db } from '../../data/local/db';
import { ReconcileBabyStepsUseCase } from '../../domain/babySteps/ReconcileBabyStepsUseCase';
import { ToggleManualStepUseCase } from '../../domain/babySteps/ToggleManualStepUseCase';
import { BABY_STEP_RULES } from '../../domain/babySteps/BabyStepRules';
import type { BabyStepStatus, ReconcileResult } from '../../domain/babySteps/types';
import { useCelebrationStore } from '../stores/celebrationStore';
import { useToastStore } from '../stores/toastStore';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';

export interface UseBabyStepsDeps {
  reconcileUseCase: Pick<ReconcileBabyStepsUseCase, 'execute'>;
  toggleUseCase: Pick<ToggleManualStepUseCase, 'execute'>;
  scheduler: Pick<LocalNotificationScheduler, 'fireBabyStepCelebration'>;
}

function createDefaultDeps(): UseBabyStepsDeps {
  return {
    reconcileUseCase: new ReconcileBabyStepsUseCase(db),
    toggleUseCase: new ToggleManualStepUseCase(db),
    scheduler: new LocalNotificationScheduler(),
  };
}

export interface UseBabyStepsResult {
  statuses: BabyStepStatus[];
  loading: boolean;
  error: Error | null;
  reconcile: () => Promise<ReconcileResult | null>;
  toggleManualStep: (stepNumber: number, completed: boolean) => Promise<void>;
}

export function useBabySteps(
  householdId: string,
  currentPeriodStart: string,
  deps?: UseBabyStepsDeps,
): UseBabyStepsResult {
  const resolvedDeps = useMemo(() => deps ?? createDefaultDeps(), [deps]);

  const [statuses, setStatuses] = useState<BabyStepStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /** Coalesce guard — if a reconcile is in flight, return same promise. */
  const inFlightRef = useRef<Promise<ReconcileResult | null> | null>(null);

  const enqueue = useCelebrationStore((s) => s.enqueue);
  const enqueueToast = useToastStore((s) => s.enqueue);

  const reconcile = useCallback((): Promise<ReconcileResult | null> => {
    // Coalesce: return the same promise if one is in-flight
    if (inFlightRef.current !== null) {
      return inFlightRef.current;
    }

    const { reconcileUseCase, scheduler } = resolvedDeps;
    const isActive = AppState.currentState === 'active';

    const promise = (async (): Promise<ReconcileResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await reconcileUseCase.execute(householdId, currentPeriodStart);

        if (!result.success) {
          throw new Error(result.error.message);
        }

        const { statuses: newStatuses, newlyCompleted, newlyRegressed } = result.data;
        setStatuses(newStatuses);

        if (isActive) {
          // Foreground path: enqueue celebration modals
          for (const stepNumber of newlyCompleted) {
            await enqueue(stepNumber);
          }
        } else {
          // Background path: fire notification as preview signal.
          // celebrated_at stays null; modal fires on next foreground re-reconcile.
          for (const stepNumber of newlyCompleted) {
            await scheduler.fireBabyStepCelebration(stepNumber);
          }
        }

        // Regression toasts — always enqueue (will surface on next UI tick)
        for (const stepNumber of newlyRegressed) {
          const rule = BABY_STEP_RULES[stepNumber as keyof typeof BABY_STEP_RULES];
          if (rule?.regressionToast) {
            enqueueToast(rule.regressionToast, 'regression');
          }
        }

        return result.data;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        return null;
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, [householdId, currentPeriodStart, enqueue, enqueueToast, resolvedDeps]);

  // Reconcile on mount — only when active
  useEffect(() => {
    if (AppState.currentState === 'active') {
      void reconcile();
    }
  }, [reconcile]);

  // Subscribe to AppState changes — re-reconcile on foreground transition
  useEffect(() => {
    const previousStateRef = { current: AppState.currentState };

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasBackground =
        previousStateRef.current === 'background' ||
        previousStateRef.current === 'inactive';
      const isNowActive = nextState === 'active';

      if (wasBackground && isNowActive) {
        void reconcile();
      }

      previousStateRef.current = nextState;
    });

    return () => {
      subscription.remove();
    };
  }, [reconcile]);

  const toggleManualStep = useCallback(
    async (stepNumber: number, completed: boolean): Promise<void> => {
      const { toggleUseCase } = resolvedDeps;
      const result = await toggleUseCase.execute(householdId, stepNumber, completed);
      if (!result.success && result.error) {
        setError(new Error(result.error.message));
        return;
      }
      // Re-reconcile after manual toggle to refresh statuses
      if (AppState.currentState === 'active') {
        await reconcile();
      }
    },
    [householdId, reconcile, resolvedDeps],
  );

  return { statuses, loading, error, reconcile, toggleManualStep };
}

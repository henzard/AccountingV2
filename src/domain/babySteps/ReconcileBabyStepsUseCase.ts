/**
 * ReconcileBabyStepsUseCase — impure orchestrator.
 *
 * Reads envelopes + debts + baby_steps rows, calls BudgetBalanceCalculator to derive
 * monthlyExpenseBaseline, calls BabyStepEvaluator, diffs vs persisted rows, writes
 * transitions, returns { statuses, newlyCompleted, newlyRegressed }.
 *
 * Invariants enforced here:
 * - Every write to baby_steps sets isSynced=false.
 * - celebrated_at is never cleared (preserved on regression AND re-completion).
 * - On regression: is_completed=false, completed_at=null (cleared), celebrated_at preserved.
 * - On completion: is_completed=true, completed_at=now, celebrated_at unchanged.
 *
 * Spec §ReconcileBabyStepsUseCase, §Sync integration / isSynced=false invariant.
 */

import { eq, and } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes, debts, babySteps } from '../../data/local/schema';
import { calculateBudgetBalance } from '../budgets/BudgetBalanceCalculator';
import { evaluate } from './BabyStepEvaluator';
import type { BabyStepStatus, ReconcileResult } from './types';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import type { DebtEntity } from '../debtSnowball/DebtEntity';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export class ReconcileBabyStepsUseCase {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async execute(householdId: string, currentPeriodStart: string): Promise<Result<ReconcileResult>> {
    try {
      // 1. Read current-period envelopes
      const envelopeRows = await this.db
        .select()
        .from(envelopes)
        .where(
          and(
            eq(envelopes.householdId, householdId),
            eq(envelopes.periodStart, currentPeriodStart),
          ),
        );

      const envelopeEntities: EnvelopeEntity[] = envelopeRows.map((row) => ({
        id: row.id,
        householdId: row.householdId,
        name: row.name,
        allocatedCents: row.allocatedCents,
        spentCents: row.spentCents,
        envelopeType: row.envelopeType as EnvelopeEntity['envelopeType'],
        isSavingsLocked: row.isSavingsLocked,
        isArchived: row.isArchived,
        periodStart: row.periodStart,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      // 2. Read all non-archived debts for this household
      const debtRows = await this.db.select().from(debts).where(eq(debts.householdId, householdId));

      const debtEntities: DebtEntity[] = debtRows.map((row) => ({
        id: row.id,
        householdId: row.householdId,
        creditorName: row.creditorName,
        debtType: row.debtType as DebtEntity['debtType'],
        outstandingBalanceCents: row.outstandingBalanceCents,
        initialBalanceCents: row.initialBalanceCents,
        interestRatePercent: row.interestRatePercent,
        minimumPaymentCents: row.minimumPaymentCents,
        sortOrder: row.sortOrder,
        isPaidOff: row.isPaidOff,
        totalPaidCents: row.totalPaidCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isSynced: row.isSynced,
      }));

      // 3. Compute INCOME_TOTAL and monthlyExpenseBaseline via BudgetBalanceCalculator
      const budgetBalance = calculateBudgetBalance(envelopeEntities);
      const monthlyExpenseBaseline = budgetBalance.incomeTotal / 100;

      // 4. Read persisted baby_steps rows
      const persistedRows = await this.db
        .select()
        .from(babySteps)
        .where(eq(babySteps.householdId, householdId));

      const persistedByStep = new Map(persistedRows.map((row) => [row.stepNumber, row]));

      // 5. Build manual flags from persisted rows
      const manualFlags: { 4: boolean; 5: boolean; 7: boolean } = {
        4: persistedByStep.get(4)?.isCompleted ?? false,
        5: persistedByStep.get(5)?.isCompleted ?? false,
        7: persistedByStep.get(7)?.isCompleted ?? false,
      };

      // 6. Evaluate current state
      const evaluated = evaluate({
        envelopes: envelopeEntities,
        debts: debtEntities,
        monthlyExpenseBaseline,
        manualFlags,
      });

      // 7. Diff vs persisted and write transitions
      const now = new Date().toISOString();
      const newlyCompleted: number[] = [];
      const newlyRegressed: number[] = [];
      const statuses: BabyStepStatus[] = [];

      for (const current of evaluated) {
        const persisted = persistedByStep.get(current.stepNumber);
        const previouslyCompleted = persisted?.isCompleted ?? false;

        // Thread through timestamps from persisted row
        const celebratedAt = persisted?.celebratedAt ?? null;
        const existingCompletedAt = persisted?.completedAt ?? null;

        let completedAt = existingCompletedAt;

        if (current.isCompleted && !previouslyCompleted) {
          // Transition: incomplete → complete
          newlyCompleted.push(current.stepNumber);
          completedAt = now;

          if (persisted) {
            await this.db
              .update(babySteps)
              .set({
                isCompleted: true,
                completedAt,
                // celebrated_at is never written here — preserved as-is
                updatedAt: now,
                isSynced: false,
              })
              .where(
                and(
                  eq(babySteps.householdId, householdId),
                  eq(babySteps.stepNumber, current.stepNumber),
                ),
              );
          }
        } else if (!current.isCompleted && previouslyCompleted) {
          // Transition: complete → incomplete (regression)
          newlyRegressed.push(current.stepNumber);
          completedAt = null;

          if (persisted) {
            await this.db
              .update(babySteps)
              .set({
                isCompleted: false,
                completedAt: null,
                // celebrated_at preserved — NOT cleared
                updatedAt: now,
                isSynced: false,
              })
              .where(
                and(
                  eq(babySteps.householdId, householdId),
                  eq(babySteps.stepNumber, current.stepNumber),
                ),
              );
          }
        }

        statuses.push({
          stepNumber: current.stepNumber as BabyStepStatus['stepNumber'],
          isCompleted: current.isCompleted,
          isManual: current.isManual,
          progress: current.progress,
          completedAt,
          celebratedAt,
        });
      }

      return createSuccess({ statuses, newlyCompleted, newlyRegressed });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createFailure({ code: 'DB_ERROR', message });
    }
  }
}

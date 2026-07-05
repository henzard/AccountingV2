/**
 * ReconcileBabyStepsUseCase — impure orchestrator.
 *
 * Reads envelopes + debts + baby_steps rows, calls BudgetBalanceCalculator to derive
 * monthlyExpenseBaseline, calls BabyStepEvaluator, diffs vs persisted rows, writes
 * transitions, returns { statuses, newlyCompleted, newlyRegressed }.
 *
 * Invariants enforced here:
 * - celebrated_at is never cleared (preserved on regression AND re-completion).
 * - On regression: is_completed=false, completed_at=null (cleared), celebrated_at preserved.
 * - On completion: is_completed=true, completed_at=now, celebrated_at unchanged.
 *
 * Spec §ReconcileBabyStepsUseCase.
 */

import { eq, and, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { envelopes, debts, babySteps } from '../../data/local/schema';
import { calculateBudgetBalance } from '../budgets/BudgetBalanceCalculator';
import { evaluate } from './BabyStepEvaluator';
import type { BabyStepStatus, ReconcileResult } from './types';
import type { EnvelopeEntity } from '../envelopes/EnvelopeEntity';
import type { DebtEntity } from '../debtSnowball/DebtEntity';
import {
  envelopeScopeCondition,
  getEnvelopeSpentCents,
} from '../../data/local/balances/EnvelopeBalanceQuery';
import { resolveSyncedRepo, resolveSyncedRepoCtx } from '../shared/syncWrite';
import type { SyncWriteDeps } from '../shared/syncWrite';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

export class ReconcileBabyStepsUseCase {
  constructor(
    private readonly db: ExpoSQLiteDatabase<typeof schema>,
    private readonly deps: SyncWriteDeps = {},
  ) {}

  async execute(householdId: string, currentPeriodStart: string): Promise<Result<ReconcileResult>> {
    try {
      // 1. Read "current" envelopes: period-scoped types matching currentPeriodStart,
      // PLUS persistent types (emergency_fund, sinking_fund, savings, baby_step)
      // unconditionally — see `envelopeScopeCondition`. A plain
      // `eq(envelopes.periodStart, currentPeriodStart)` would wrongly exclude the
      // persistent emergency_fund envelope the moment a rollover moves the
      // household onto a new period (its row's period_start is fixed at whatever
      // period it was created in and never changes), which is exactly the "Baby
      // Step 1/3 regress every month" bug: findEMF() in BabyStepEvaluator would see
      // no envelopes at all and report Step 1/3 as incomplete even though the EMF
      // balance never moved. Using the shared scope condition (same predicate
      // StartNewPeriodUseCase and getEnvelopeSpentCents already use) reads the EMF
      // period-agnostically instead.
      const envelopeRows = await this.db
        .select()
        .from(envelopes)
        .where(
          and(
            eq(envelopes.householdId, householdId),
            isNull(envelopes.deletedAt),
            envelopeScopeCondition(currentPeriodStart),
          ),
        );

      // Balance is derived from the transaction ledger (see EnvelopeBalanceQuery),
      // not read from a stored column — scoped by this reconciliation's own period.
      const spentByEnvelope = await getEnvelopeSpentCents(this.db, householdId, currentPeriodStart);
      const envelopeEntities: EnvelopeEntity[] = envelopeRows.map((row) => ({
        id: row.id,
        householdId: row.householdId,
        name: row.name,
        allocatedCents: row.allocatedCents,
        spentCents: spentByEnvelope.get(row.id) ?? 0,
        envelopeType: row.envelopeType as EnvelopeEntity['envelopeType'],
        isSavingsLocked: row.isSavingsLocked,
        isArchived: row.isArchived,
        periodStart: row.periodStart,
        targetAmountCents: row.targetAmountCents ?? null,
        targetDate: row.targetDate ?? null,
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
      const repo = resolveSyncedRepo(this.db, 'baby_steps', this.deps);
      const ctx = resolveSyncedRepoCtx(this.deps);

      for (const current of evaluated) {
        const persisted = persistedByStep.get(current.stepNumber);
        const previouslyCompleted = persisted?.isCompleted ?? false;

        // Thread through timestamps from persisted row
        const celebratedAt = persisted?.celebratedAt ?? null;
        const existingCompletedAt = persisted?.completedAt ?? null;

        let completedAt = existingCompletedAt;

        if (current.isCompleted && !previouslyCompleted) {
          // Transition: incomplete → complete
          completedAt = now;

          if (persisted) {
            // celebrated_at is never written here — preserved as-is
            repo.update(
              persisted.id,
              householdId,
              { is_completed: 1, completed_at: completedAt, updated_at: now },
              ctx,
            );
            // L5 (exhaustive audit): only report the step as newly-completed
            // AFTER confirming the row actually persisted. Pushing this
            // unconditionally (the old behavior) meant a MISSING baby_steps
            // row (e.g. a joining device whose baby_steps restore hasn't
            // landed yet) still triggered a celebration even though nothing
            // was written — since the persisted `is_completed` flag never
            // flips, the very next reconcile re-detects the same
            // incomplete→complete transition and re-enqueues the
            // celebration modal in a loop, with no persistence ever backing
            // it.
            newlyCompleted.push(current.stepNumber);
          }
        } else if (!current.isCompleted && previouslyCompleted) {
          // Transition: complete → incomplete (regression)
          newlyRegressed.push(current.stepNumber);
          completedAt = null;

          if (persisted) {
            // celebrated_at preserved — NOT cleared
            repo.update(
              persisted.id,
              householdId,
              { is_completed: 0, completed_at: null, updated_at: now },
              ctx,
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

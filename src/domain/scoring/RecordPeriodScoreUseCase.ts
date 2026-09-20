import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import type * as schema from '../../data/local/schema';
import { scoreHistory } from '../../data/local/schema';
import { uuidv5, APP_NAMESPACE } from '../../infrastructure/crypto/uuidv5';
import type { HabitScoreResult } from './RamseyScoreCalculator';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

/**
 * A point-in-time snapshot of the household's debt-snowball plan, taken at
 * rollover (VAL2-10) so a later period can say "N months sooner/later than
 * last month" and "R… paid off since last month" — see
 * `computeDebtProgressMessage` (src/presentation/screens/debtSnowball) and
 * `getLatestDebtSnapshot`, which reads this back.
 */
export interface DebtSnapshot {
  /** Sum of `outstandingBalanceCents` across the household's non-deleted debts. */
  totalDebtCents: number;
  /** `SnowballPayoffProjector.project(...).debtFreeDate` as an ISO string, or null when unpayable/no debts. */
  debtFreeDateISO: string | null;
}

export interface RecordPeriodScoreInput {
  householdId: string;
  /** ISO date (YYYY-MM-DD) of the period being CLOSED. */
  periodStart: string;
  /** ISO date (YYYY-MM-DD) of the period being CLOSED — kept alongside `periodStart` for callers/tests, even though `score_history` has no `period_end` column to persist it in (see schema). */
  periodEnd: string;
  /** The closing period's computed score breakdown, e.g. from `HabitScoreCalculator.calculate`. */
  score: HabitScoreResult;
  /**
   * Optional debt-plan snapshot (VAL2-10), folded additively into the
   * `components` JSON alongside `score` — see the class doc comment.
   * Omitted (or its computation having failed) is expected and safe: older
   * rows, and any row written without it, simply have no `debtSnapshot` key
   * for readers to find.
   */
  debtSnapshot?: DebtSnapshot;
}

export interface RecordPeriodScoreOutput {
  id: string;
  /** false when a row for this (household, periodStart) already existed — a safe replayed no-op, not an error. */
  created: boolean;
}

/**
 * Deterministic `score_history` row id for `(householdId, periodStart)` —
 * mirrors `rolloverEnvelopeId`'s pattern (see `StartNewPeriodUseCase`) so a
 * retried rollover, or two devices independently closing the same period,
 * converge on the same row instead of duplicating a period's score snapshot.
 */
export function periodScoreId(householdId: string, periodStart: string): string {
  return uuidv5(`${householdId}:${periodStart}:score`, APP_NAMESPACE);
}

/**
 * RecordPeriodScoreUseCase — writes one `score_history` row per
 * `(household, periodStart)` when a budget period closes (called from
 * `RolloverWizard` right after a successful `StartNewPeriodUseCase` commit).
 *
 * LOCAL-ONLY WRITE — NOT ROUTED THROUGH THE SYNCED REPO: `score_history` is
 * absent from the server's `apply_one_op` table allowlist (`c_tables` in
 * `supabase/migrations/0010_server_writes_via_oplog.sql`). The server table
 * exists (`supabase/migrations/0001_baseline.sql`) with a SELECT-only RLS
 * policy, but there is no INSERT policy and no write path through the oplog
 * RPC. Writing this via `createSyncedRepo`/`resolveSyncedRepo` would still
 * succeed locally, but the resulting oplog row would be permanently
 * dead-lettered — rejected with `{status: 'rejected', code: 'unsupported'}`
 * the moment it's pushed, since `v_table = ANY(c_tables)` fails server-side.
 * So this writes straight to local SQLite with a plain `db.insert(...)`,
 * the same local-only pattern `AuditLogger` uses for `audit_events` (also
 * absent from `c_tables`): this data is device-local for now, until/unless a
 * future migration adds `score_history` to the sync allowlist.
 *
 * Idempotent: `id` is a deterministic hash of `(householdId, periodStart)`
 * (see `periodScoreId`) — an existing row for that id is left untouched
 * (`onConflictDoNothing`) instead of throwing on the primary key or
 * duplicating the snapshot, so a second rollover attempt for the same period
 * (crash/retry, or the wizard reopened) is a safe no-op.
 *
 * Best-effort: recording a period's score is a nice-to-have, not part of the
 * rollover's correctness contract. `execute` never throws — every failure is
 * caught and returned as a `Result` failure — so a caller can (and must, per
 * the rollover's contract) treat this as fire-and-forget and never let a
 * failure here block or roll back the period rollover itself.
 *
 * `components` is additive JSON: it always carries the score breakdown, and
 * — when the caller supplies one — a `debtSnapshot` alongside it. Every
 * reader must tolerate rows written before VAL2-10 (or any row whose
 * snapshot computation failed) having no `debtSnapshot` key at all.
 */
export class RecordPeriodScoreUseCase {
  constructor(private readonly db: ExpoSQLiteDatabase<typeof schema>) {}

  async execute(input: RecordPeriodScoreInput): Promise<Result<RecordPeriodScoreOutput>> {
    try {
      const id = periodScoreId(input.householdId, input.periodStart);

      const existing = await this.db
        .select({ id: scoreHistory.id })
        .from(scoreHistory)
        .where(eq(scoreHistory.id, id))
        .limit(1);

      if (existing.length > 0) {
        return createSuccess({ id, created: false });
      }

      const components = input.debtSnapshot
        ? { ...input.score, debtSnapshot: input.debtSnapshot }
        : input.score;

      await this.db
        .insert(scoreHistory)
        .values({
          id,
          householdId: input.householdId,
          periodStart: input.periodStart,
          score: input.score.score,
          components: JSON.stringify(components),
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing({ target: scoreHistory.id });

      return createSuccess({ id, created: true });
    } catch (err) {
      return createFailure({
        code: 'record_period_score_failed',
        message: err instanceof Error ? err.message : 'Failed to record period score',
      });
    }
  }
}

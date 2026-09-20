import { sql } from 'drizzle-orm';
import type { EnvelopeBalanceDb } from '../../../data/local/balances/EnvelopeBalanceQuery';

interface MaxPeriodRow {
  period_start: string | null;
}

/**
 * The most recent budget period, strictly before `beforePeriodStart`, that
 * has at least one non-deleted, non-archived PERIOD-scoped envelope
 * ('spending' | 'income' | 'utility' — see `getEnvelopeScope` /
 * `StartNewPeriodUseCase.isRolloverSource`) for `householdId`. Returns null
 * when no such period exists (e.g. a brand-new household that has never had
 * a period-scoped envelope).
 *
 * Used to pick `RolloverWizard`'s `fromPeriodStart`: the wizard should roll
 * forward from whichever earlier period actually has envelopes to copy, not
 * always the immediately-previous calendar period — which may be empty if a
 * period was skipped (app not opened that month) or the household is new.
 */
export async function findLatestPeriodWithEnvelopes(
  db: EnvelopeBalanceDb,
  householdId: string,
  beforePeriodStart: string,
): Promise<string | null> {
  const [row] = (await db.all(
    sql`SELECT MAX(period_start) AS period_start
        FROM envelopes
        WHERE household_id = ${householdId}
          AND period_start < ${beforePeriodStart}
          AND deleted_at IS NULL
          AND is_archived = 0
          AND envelope_type IN ('spending', 'income', 'utility')`,
  )) as MaxPeriodRow[];
  return row?.period_start ?? null;
}

interface AnyPeriodStartRow {
  period_start: string | null;
}

/**
 * True when `householdId` has at least one non-deleted, non-archived
 * PERIOD-scoped envelope whose `period_start` is strictly AFTER
 * `afterPeriodStart` — used as a belt-and-braces guard against a stale
 * payday making the dashboard compute the wrong (empty) "current" period
 * while envelopes for a genuinely later period already exist (UX2-2). That
 * is a mis-keyed read, not a real empty new period, so the rollover wizard
 * must not auto-open on top of it.
 */
export async function hasPeriodScopedEnvelopeAfter(
  db: EnvelopeBalanceDb,
  householdId: string,
  afterPeriodStart: string,
): Promise<boolean> {
  const [row] = (await db.all(
    sql`SELECT period_start
        FROM envelopes
        WHERE household_id = ${householdId}
          AND period_start > ${afterPeriodStart}
          AND deleted_at IS NULL
          AND is_archived = 0
          AND envelope_type IN ('spending', 'income', 'utility')
        LIMIT 1`,
  )) as AnyPeriodStartRow[];
  return row !== undefined;
}

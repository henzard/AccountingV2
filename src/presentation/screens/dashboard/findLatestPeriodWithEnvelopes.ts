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

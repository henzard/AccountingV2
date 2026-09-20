import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Money MOVED INTO a persistent envelope (`sinking_fund` | `emergency_fund` |
 * `savings` | `baby_step`).
 *
 * Persistent envelopes keep one row across every budget period, so before
 * this table existed nothing recorded that a period had actually funded them:
 * `envelopes.allocated_cents` is the MONTHLY contribution the user budgets,
 * and reading it as "saved" meant a fund showed R500 saved forever no matter
 * how many months had been budgeted (and Baby Step 1 "completed" the moment
 * someone typed R1,000 into the allocation field).
 *
 * A persistent envelope's saved balance is therefore derived, exactly like
 * period-envelope spend is (see `EnvelopeBalanceQuery`):
 *
 *   savedCents = SUM(envelope_contributions.amount_cents)
 *              - SUM(transactions.amount_cents)
 *
 * Rows are append-only and carry DETERMINISTIC ids (see
 * `PersistentContributions.periodContributionId` /
 * `openingContributionId`) so a double rollover, and two offline devices
 * rolling the same period transition over independently, converge on ONE row
 * instead of double-funding the envelope.
 */
export const envelopeContributions = sqliteTable(
  'envelope_contributions',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull(),
    envelopeId: text('envelope_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** ISO date (YYYY-MM-DD) of the budget period this contribution funded. */
    periodStart: text('period_start').notNull(),
    /** 'opening_balance' | 'rollover' — see `ContributionSource`. */
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => ({
    householdEnvelopeIdx: index('envelope_contributions_household_envelope_idx').on(
      t.householdId,
      t.envelopeId,
    ),
  }),
);

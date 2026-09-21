import { getEnvelopeScope } from '../envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../envelopes/EnvelopeEntity';

/**
 * The single source of truth for "is this row money IN or money OUT".
 *
 * The app itself refuses to book a transaction against an `income` envelope
 * (see AddTransactionScreen), but imported/synced history contains them: a
 * salary deposit recorded as a transaction on the household's income
 * envelope. Nothing in the app was written with those rows in mind, so every
 * place that totals "spent" by summing transactions would count an entire
 * month's income as spending unless it asks this module first.
 *
 * Three kinds, deliberately distinct:
 *  - 'income' — a row on an `income`-type envelope. Money IN. NEVER part of
 *    any spent total, pace, or over-budget check.
 *  - 'refund' — a NEGATIVE amount on a spending envelope. Money coming back
 *    INTO a spend envelope, so it stays inside the spent total and nets it
 *    down (that is what makes an envelope's remaining balance correct).
 *  - 'spend'  — everything else.
 *
 * `envelopeType` is optional because callers resolve it from a lookup that
 * can legitimately miss (a deleted envelope, a row loaded before the envelope
 * map arrived). An unknown envelope is treated as NOT income: never silently
 * drop money from a spent total on the strength of a missing lookup.
 */
export type MoneyKind = 'income' | 'refund' | 'spend';

/** The two fields any classification needs. */
export interface MoneyRow {
  amountCents: number;
  envelopeType?: EnvelopeType | null;
}

export function isIncomeEnvelopeType(envelopeType?: EnvelopeType | null): boolean {
  return envelopeType === 'income';
}

export function classifyMoney(row: MoneyRow): MoneyKind {
  if (isIncomeEnvelopeType(row.envelopeType)) return 'income';
  return row.amountCents < 0 ? 'refund' : 'spend';
}

/** True when the row belongs in a "spent" total (refunds do; income never does). */
export function countsAsSpending(row: MoneyRow): boolean {
  return classifyMoney(row) !== 'income';
}

export interface MoneySummary {
  /**
   * Signed sum of every NON-income row — refunds net it down, exactly as
   * before this module existed. Income is absent, not subtracted: a salary
   * deposit is not a refund of the grocery budget.
   */
  spentCents: number;
  /**
   * Total money IN: income-envelope rows summed SIGNED, then made positive
   * once — the same net-then-absolute rule as `summariseEnvelopePeriodMoney`,
   * so a reversed deposit lowers the total here exactly as it does there.
   */
  receivedCents: number;
  /** How many income rows were seen — lets a caller hide a "Received" line. */
  incomeCount: number;
}

export function summariseMoney(rows: readonly MoneyRow[]): MoneySummary {
  let spentCents = 0;
  let signedIncomeCents = 0;
  let incomeCount = 0;
  for (const row of rows) {
    if (classifyMoney(row) === 'income') {
      signedIncomeCents += row.amountCents;
      incomeCount += 1;
    } else {
      spentCents += row.amountCents;
    }
  }
  return { spentCents, receivedCents: Math.abs(signedIncomeCents), incomeCount };
}

/** The envelope fields the period summary below reads. */
export interface EnvelopeMoneyRow {
  envelopeType: EnvelopeType;
  allocatedCents: number;
  spentCents: number;
  isArchived?: boolean;
}

export interface EnvelopePeriodMoney {
  /** Budgeted OUT: every non-income, non-archived envelope's allocation. */
  allocatedCents: number;
  /**
   * Spent OUT: PERIOD-scoped non-income envelopes only. A persistent fund's
   * `spentCents` is an ALL-TIME withdrawal total, so mixing it in would read
   * years of a fund's spend as one period's spending.
   */
  spentCents: number;
  /** Money IN actually recorded against income envelopes (ledger-derived). */
  receivedCents: number;
  /** Money IN the household BUDGETED for — income envelopes' allocation. */
  expectedIncomeCents: number;
}

/**
 * A whole period's headline numbers from its envelope rows, using the same
 * income/spend split as `classifyMoney` so a screen's "Spent"/"Budget" and
 * "Received" can never drift apart from the transaction list's.
 */
export function summariseEnvelopePeriodMoney(
  envelopes: readonly EnvelopeMoneyRow[],
): EnvelopePeriodMoney {
  let allocatedCents = 0;
  let spentCents = 0;
  let receivedCents = 0;
  let expectedIncomeCents = 0;
  for (const envelope of envelopes) {
    if (envelope.isArchived) continue;
    if (isIncomeEnvelopeType(envelope.envelopeType)) {
      receivedCents += Math.abs(envelope.spentCents);
      expectedIncomeCents += envelope.allocatedCents;
      continue;
    }
    allocatedCents += envelope.allocatedCents;
    if (getEnvelopeScope(envelope) === 'period') {
      spentCents += envelope.spentCents;
    }
  }
  return { allocatedCents, spentCents, receivedCents, expectedIncomeCents };
}

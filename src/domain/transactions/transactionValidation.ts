import { format, parseISO, isValid, addDays } from 'date-fns';
import type { Result } from '../shared/types';
import { createSuccess, createFailure } from '../shared/types';

const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shared transaction validation — the SINGLE source of truth for these rules.
 * `CreateTransactionUseCase` and `UpdateTransactionUseCase` both call into
 * this module (neither inlines its own copy any more), so the two can never
 * drift apart.
 */

/**
 * Amount must be a NON-ZERO safe integer (money is integer cents).
 *
 * REFUNDS: a negative amount is a refund / reversal / store credit, and is
 * as valid as a purchase. Every balance in the app is a derived
 * `SUM(amount_cents)` (see `EnvelopeBalanceQuery`), so a negative row simply
 * nets out — no schema change, and an older build that pulls one via sync
 * stores and sums it correctly even though it cannot create one.
 *
 * Zero is still rejected: a R0 row moves nothing and is never what the user
 * meant. The magnitude guard is `Number.isSafeInteger`, which is inherently
 * SYMMETRIC — an absurd -1e18 refund is rejected on exactly the same footing
 * as an absurd +1e18 purchase.
 */
export function validateTransactionAmountCents(amountCents: number): Result<void> {
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) {
    return createFailure({
      code: 'INVALID_AMOUNT',
      message: 'Amount must be a non-zero whole number of cents',
    });
  }
  return createSuccess(undefined);
}

/**
 * `transactionDate` must be a real calendar date in strict YYYY-MM-DD form,
 * and no more than 1 day in the future (local time, not UTC) — mirrors
 * `CreateTransactionUseCase`'s rules exactly.
 */
export function validateTransactionDate(transactionDate: string): Result<void> {
  if (!DATE_FORMAT_REGEX.test(transactionDate)) {
    return createFailure({
      code: 'INVALID_DATE',
      message: 'Transaction date must be in YYYY-MM-DD format',
    });
  }
  if (!isValid(parseISO(transactionDate))) {
    return createFailure({
      code: 'INVALID_DATE',
      message: 'Transaction date is not a valid calendar date',
    });
  }
  const today = format(new Date(), 'yyyy-MM-dd');
  const maxFutureDate = format(addDays(parseISO(today), 1), 'yyyy-MM-dd');
  if (transactionDate > maxFutureDate) {
    return createFailure({
      code: 'FUTURE_DATE',
      message: 'Transaction date cannot be more than 1 day in the future',
    });
  }
  return createSuccess(undefined);
}

/** The subset of an `envelopes` row this validation needs — matches the shape a `select()` for it returns. */
export interface TargetEnvelopeRow {
  envelopeType: string;
  isArchived: boolean;
  deletedAt: string | null;
}

/**
 * A transaction may only target an existing, non-income, non-archived,
 * non-deleted envelope (scoped to the caller's household by the query that
 * produced `envelope`, e.g. CRITICAL-2 in `CreateTransactionUseCase`).
 */
export function validateTargetEnvelope(envelope: TargetEnvelopeRow | undefined): Result<void> {
  if (!envelope) {
    return createFailure({ code: 'ENVELOPE_NOT_FOUND', message: 'Envelope does not exist' });
  }
  if (envelope.envelopeType === 'income') {
    return createFailure({
      code: 'INVALID_ENVELOPE_TYPE',
      message: 'Cannot record a transaction against an income envelope',
    });
  }
  if (envelope.isArchived) {
    return createFailure({ code: 'ENVELOPE_ARCHIVED', message: 'Envelope is archived' });
  }
  if (envelope.deletedAt) {
    return createFailure({ code: 'ENVELOPE_ARCHIVED', message: 'Envelope has been deleted' });
  }
  return createSuccess(undefined);
}

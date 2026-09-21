/**
 * Household activity push notifications — VAL-6 / DB-7, hardened by REG-15
 * and SEC2-12.
 *
 * `notify-event`'s contract is now per-EVENT, not per-recipient:
 * `{ householdId, event: { kind, ...typed fields } }`. The function resolves
 * the recipients itself (every active member except the caller) and renders
 * the notification title/body SERVER-SIDE — the client never authors the
 * words that appear on another member's lock screen, and one event costs one
 * unit of the sender's hourly budget no matter how big the household is.
 *
 * Every free-text field is bounded (60 characters) and sanitized server-side;
 * money is integer cents and formatted by the server.
 */
export type HouseholdNotificationKind =
  | 'transaction_created'
  | 'envelope_over_budget'
  | 'slip_confirmed'
  | 'refund_recorded';

interface HouseholdNotificationBase {
  householdId: string;
  /** Excluded from the recipient list — never notify the person who caused the event. */
  senderId: string;
}

export type HouseholdNotificationEvent =
  | (HouseholdNotificationBase & {
      kind: 'transaction_created';
      /** Integer cents, greater than zero. */
      amountCents: number;
      envelopeName: string;
      payee?: string;
    })
  | (HouseholdNotificationBase & {
      kind: 'envelope_over_budget';
      envelopeName: string;
      /** Integer cents the envelope is over its allocation by, greater than zero. */
      overByCents: number;
    })
  | (HouseholdNotificationBase & {
      kind: 'slip_confirmed';
      /** 1..200 line items. */
      itemCount: number;
      merchant?: string;
    })
  | (HouseholdNotificationBase & {
      kind: 'refund_recorded';
      /** Integer cents, the POSITIVE magnitude of the refund (never negative or zero). */
      amountCents: number;
      envelopeName: string;
      payee?: string;
    });

/**
 * Fire-and-forget: implementations must never throw and must never delay the
 * caller (the caller does not await meaningful completion). Failures are
 * logged internally and swallowed.
 */
export interface IHouseholdNotifier {
  notifyHousehold(event: HouseholdNotificationEvent): void;
}

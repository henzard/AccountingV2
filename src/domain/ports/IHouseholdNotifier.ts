/**
 * Household activity push notifications — VAL-6 / DB-7.
 *
 * `notify-event`'s actual contract (supabase/functions/notify-event/index.ts)
 * is deliberately minimal: `{ userId, householdId, title, body }`, sent to
 * ONE target member at a time (no server-side "event type" or fan-out — the
 * caller decides who to notify and what to say). `HouseholdNotificationEvent`
 * is a CLIENT-side concept only, used to pick a debounce key and to build the
 * title/body; it is never sent to the server as-is.
 */
export type HouseholdNotificationKind =
  | 'transaction_created'
  | 'envelope_over_budget'
  | 'slip_confirmed';

export interface HouseholdNotificationEvent {
  kind: HouseholdNotificationKind;
  householdId: string;
  /** Excluded from the recipient list — never notify the person who caused the event. */
  senderId: string;
  title: string;
  body: string;
}

/**
 * Fire-and-forget: implementations must never throw and must never delay the
 * caller (the caller does not await meaningful completion). Failures are
 * logged internally and swallowed.
 */
export interface IHouseholdNotifier {
  notifyHousehold(event: HouseholdNotificationEvent): void;
}

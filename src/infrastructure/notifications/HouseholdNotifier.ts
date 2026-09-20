import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { and, eq, isNull } from 'drizzle-orm';
import NetInfo from '@react-native-community/netinfo';
import { supabase as defaultSupabase } from '../../data/remote/supabaseClient';
import { db as defaultDb } from '../../data/local/db';
import * as schema from '../../data/local/schema';
import { NotificationPreferencesRepository } from './NotificationPreferencesRepository';
import { logger } from '../logging/Logger';
import type {
  HouseholdNotificationEvent,
  IHouseholdNotifier,
} from '../../domain/ports/IHouseholdNotifier';

/** Two rapid saves (e.g. a double-tap on Save) within this window collapse
 * into a single push — same reasoning as AddTransactionScreen's `isSaving`
 * guard, just for the notification side-effect rather than the write. */
const DEBOUNCE_MS = 5_000;

export interface HouseholdNotifierDeps {
  supabase: SupabaseClient;
  db: ExpoSQLiteDatabase<typeof schema>;
  preferencesRepository: NotificationPreferencesRepository;
  now: () => number;
}

/**
 * HouseholdNotifier — VAL-6/DB-7 client side of the "push notifications are
 * fully dead" gap.
 *
 * notify-event/index.ts's contract is per-target-member:
 * `{ userId, householdId, title, body }`. There is no server-side fan-out or
 * "event type" — this class is the thing that decides WHO in the household
 * to notify (every active member except the sender) and calls the function
 * once per recipient.
 *
 * Fire-and-forget by design: `notifyHousehold` returns immediately and never
 * throws into the caller. A push is a nice-to-have; it must never block or
 * fail a transaction/slip save. Every failure (network, auth, function
 * error) is caught and logged via the app logger, never console.log.
 */
export class HouseholdNotifier implements IHouseholdNotifier {
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly deps: HouseholdNotifierDeps) {}

  notifyHousehold(event: HouseholdNotificationEvent): void {
    const key = `${event.kind}:${event.householdId}:${event.senderId}:${event.title}:${event.body}`;
    const now = this.deps.now();
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < DEBOUNCE_MS) {
      return; // double-tap / duplicate save within the debounce window
    }
    // Record BEFORE the async work starts so two synchronous calls in the
    // same tick (e.g. a double-tap) both see the debounce window, not just
    // the second one to resolve.
    this.lastSentAt.set(key, now);

    this.send(event).catch((err: unknown) => {
      logger.warn('[HouseholdNotifier] send failed', { kind: event.kind, err: String(err) });
    });
  }

  private async send(event: HouseholdNotificationEvent): Promise<void> {
    try {
      const netState = await NetInfo.fetch();
      if (!(netState.isConnected && netState.isInternetReachable !== false)) {
        return; // offline — no point waking the edge function
      }

      const prefs = await this.deps.preferencesRepository.load();
      if (!prefs.householdActivityEnabled) {
        return; // user turned household-activity pushes off on this device
      }

      const members = await this.deps.db
        .select({ userId: schema.householdMembers.userId })
        .from(schema.householdMembers)
        .where(
          and(
            eq(schema.householdMembers.householdId, event.householdId),
            isNull(schema.householdMembers.deletedAt),
          ),
        );

      const recipients = members.map((m) => m.userId).filter((userId) => userId !== event.senderId);

      if (recipients.length === 0) {
        return; // solo household — nothing to wake the function for
      }

      for (const userId of recipients) {
        try {
          const { error } = await this.deps.supabase.functions.invoke('notify-event', {
            body: {
              userId,
              householdId: event.householdId,
              title: event.title,
              body: event.body,
            },
          });
          if (error) {
            logger.warn('[HouseholdNotifier] notify-event returned an error', {
              kind: event.kind,
              error: error.message,
            });
          }
        } catch (err) {
          logger.warn('[HouseholdNotifier] notify-event invoke threw', {
            kind: event.kind,
            err: String(err),
          });
        }
      }
    } catch (err) {
      logger.warn('[HouseholdNotifier] unexpected failure building/sending notification', {
        kind: event.kind,
        err: String(err),
      });
    }
  }
}

export const householdNotifier: IHouseholdNotifier = new HouseholdNotifier({
  supabase: defaultSupabase,
  db: defaultDb,
  preferencesRepository: new NotificationPreferencesRepository(),
  now: () => Date.now(),
});

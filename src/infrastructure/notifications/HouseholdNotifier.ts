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

/** Mirrors notify-event's MAX_FREE_TEXT. Truncating here rather than letting
 * the function reject the whole request keeps an unusually long envelope or
 * merchant name from silently costing the household its notification. */
const MAX_FREE_TEXT = 60;

export interface HouseholdNotifierDeps {
  supabase: SupabaseClient;
  db: ExpoSQLiteDatabase<typeof schema>;
  preferencesRepository: NotificationPreferencesRepository;
  now: () => number;
}

/** The `event` object sent to notify-event: the kind plus its typed fields,
 * and nothing else — the function rejects unknown keys. */
type NotifyEventBody = Record<string, string | number>;

function trimText(value: string): string {
  return value.trim().slice(0, MAX_FREE_TEXT);
}

/**
 * Projects a client event onto notify-event's wire shape. Optional free-text
 * fields are omitted entirely when empty rather than sent as '' (the function
 * treats an empty string as nothing renderable, and omitting keeps the
 * request minimal).
 */
function toRequestEvent(event: HouseholdNotificationEvent): NotifyEventBody {
  switch (event.kind) {
    case 'transaction_created': {
      const payee = event.payee ? trimText(event.payee) : '';
      return {
        kind: event.kind,
        amountCents: event.amountCents,
        envelopeName: trimText(event.envelopeName),
        ...(payee ? { payee } : {}),
      };
    }
    case 'envelope_over_budget':
      return {
        kind: event.kind,
        envelopeName: trimText(event.envelopeName),
        overByCents: event.overByCents,
      };
    case 'slip_confirmed': {
      const merchant = event.merchant ? trimText(event.merchant) : '';
      return {
        kind: event.kind,
        itemCount: event.itemCount,
        ...(merchant ? { merchant } : {}),
      };
    }
  }
}

/**
 * HouseholdNotifier — VAL-6/DB-7 client side of the "push notifications are
 * fully dead" gap.
 *
 * REG-15: ONE request per event. The function resolves the recipients itself
 * and charges the sender a single unit of their hourly budget, so a busy
 * three-person household no longer burns the whole budget on chatter and gets
 * its over-budget alert rejected.
 *
 * SEC2-12: this class no longer builds a title or body. It describes what
 * happened with typed, bounded fields and the server writes the words — a
 * member cannot put arbitrary text on another member's lock screen.
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
    const requestEvent = toRequestEvent(event);
    const key = `${event.householdId}:${event.senderId}:${JSON.stringify(requestEvent)}`;
    const now = this.deps.now();

    // The map is keyed by event content, so a long session would otherwise
    // grow it without bound (one entry per distinct transaction ever saved).
    // Anything older than the window can never suppress anything again.
    this.pruneDebounceMap(now);

    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < DEBOUNCE_MS) {
      return; // double-tap / duplicate save within the debounce window
    }
    // Record BEFORE the async work starts so two synchronous calls in the
    // same tick (e.g. a double-tap) both see the debounce window, not just
    // the second one to resolve.
    this.lastSentAt.set(key, now);

    this.send(event, requestEvent).catch((err: unknown) => {
      logger.warn('[HouseholdNotifier] send failed', { kind: event.kind, err: String(err) });
    });
  }

  private pruneDebounceMap(now: number): void {
    for (const [key, sentAt] of this.lastSentAt) {
      if (now - sentAt >= DEBOUNCE_MS) {
        this.lastSentAt.delete(key);
      }
    }
  }

  private async send(
    event: HouseholdNotificationEvent,
    requestEvent: NotifyEventBody,
  ): Promise<void> {
    try {
      const netState = await NetInfo.fetch();
      if (!(netState.isConnected && netState.isInternetReachable !== false)) {
        return; // offline — no point waking the edge function
      }

      const prefs = await this.deps.preferencesRepository.load();
      if (!prefs.householdActivityEnabled) {
        return; // user turned household-activity pushes off on this device
      }

      // The server resolves the real recipient list; this local read only
      // avoids waking the function at all for a solo household.
      const members = await this.deps.db
        .select({ userId: schema.householdMembers.userId })
        .from(schema.householdMembers)
        .where(
          and(
            eq(schema.householdMembers.householdId, event.householdId),
            isNull(schema.householdMembers.deletedAt),
          ),
        );

      const hasOtherMember = members.some((m) => m.userId !== event.senderId);
      if (!hasOtherMember) {
        return; // solo household — nothing to wake the function for
      }

      try {
        const { error } = await this.deps.supabase.functions.invoke('notify-event', {
          body: { householdId: event.householdId, event: requestEvent },
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

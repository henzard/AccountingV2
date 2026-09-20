import {
  consumeHouseholdEviction,
  subscribeHouseholdEviction,
} from '../../data/sync/householdEviction';
import { useAppStore } from '../stores/appStore';
import { useCelebrationStore } from '../stores/celebrationStore';
import { useSyncStore } from '../stores/syncStore';
import { useToastStore } from '../stores/toastStore';

/**
 * Reacts to the sync layer confirming this user is no longer a member of a
 * household (removed by an owner from another device). The sync layer has
 * already made the household unreachable locally; this moves the UI off it:
 * drop it from the picker, switch to another household or fall back to the
 * create/join gate, and tell the user why.
 */
export function handleHouseholdEviction({ householdId }: { householdId: string }): void {
  const store = useAppStore.getState();
  const name =
    store.availableHouseholds.find((h) => h.id === householdId)?.name ?? 'that household';
  const remaining = store.availableHouseholds.filter((h) => h.id !== householdId);
  store.setAvailableHouseholds(remaining);

  if (store.householdId === householdId) {
    useCelebrationStore.getState().clear();
    useSyncStore.getState().reset();
    const next = remaining[0];
    if (next) {
      store.setHouseholdId(next.id);
      store.setPaydayDay(next.paydayDay);
    } else {
      store.clearHousehold();
    }
  }
  useToastStore.getState().enqueue(`You're no longer a member of ${name}.`, 'error');
}

/**
 * App-lifetime subscription. Subscribes BEFORE draining the latch so an
 * eviction landing between the two is not lost; the eviction module guarantees
 * only one of the two paths fires for any given eviction.
 */
export function subscribeToHouseholdEvictions(): () => void {
  const unsubscribe = subscribeHouseholdEviction(handleHouseholdEviction);
  const pending = consumeHouseholdEviction();
  if (pending) handleHouseholdEviction(pending);
  return unsubscribe;
}

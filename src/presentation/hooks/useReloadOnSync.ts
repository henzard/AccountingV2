import { useEffect, useRef } from 'react';
import { useSyncStore } from '../stores/syncStore';

/**
 * Re-runs `reload` whenever a sync round has genuinely SUCCEEDED (VAL-5).
 *
 * Screens only reload on focus, so a partner's spending landed in local
 * SQLite but stayed invisible until you navigated away and back. The puller
 * has no per-table change feed, but `syncStore.lastSyncAt` is now stamped
 * ONLY on a round that actually reached the server (see SyncScheduler /
 * SYNC-10), which makes "that value changed" a sound trigger: it fires after
 * new data can have arrived, and never for a failed or offline round.
 *
 * Deliberately NOT a mount trigger. The first render records the current
 * timestamp as the baseline and reloads nothing, because every caller either
 * loads on mount itself or loads on focus — reloading here too would double
 * the initial query.
 *
 * A change arriving while a reload is still in flight is skipped rather than
 * queued: the reload in flight reads the same local tables and will see the
 * newly applied rows, so a second pass would only re-render with identical
 * data.
 */
export function useReloadOnSync(reload: () => Promise<void>): void {
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  // `undefined` = not yet baselined (first render); `string | null` = the
  // value this hook has already reacted to.
  const seenRef = useRef<string | null | undefined>(undefined);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (seenRef.current === undefined) {
      seenRef.current = lastSyncAt;
      return;
    }
    if (seenRef.current === lastSyncAt) return;
    seenRef.current = lastSyncAt;

    if (reloadingRef.current) return;
    reloadingRef.current = true;
    void reload().finally(() => {
      reloadingRef.current = false;
    });
  }, [lastSyncAt, reload]);
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Chip, FAB } from 'react-native-paper';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { format, isValid, parseISO } from 'date-fns';
import { useSlipHistory } from '../../hooks/useSlipHistory';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { useToastStore } from '../../stores/toastStore';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { formatCurrency } from '../../utils/currency';
import { db } from '../../../data/local/db';
import { getConfirmedSlipIds } from '../../../domain/slipScanning/SlipTransactionStatusQuery';
import type {
  SlipQueueRow,
  ISlipQueueRepository,
} from '../../../domain/ports/ISlipQueueRepository';
import type { SlipExtraction, SlipStatus } from '../../../domain/slipScanning/types';

const PAGE_SIZE = 20;

/**
 * Map a slip row's stored `rawResponseJson` into a camelCase `SlipExtraction`
 * that SlipConfirmScreen can consume.
 *
 * The edge function persists `raw_response_json` as `JSON.stringify(parsed)`
 * where `parsed` is the SNAKE_CASE OpenAI structured output
 * (`slip_date` / `amount_cents` / `suggested_envelope_id`). The camelCase
 * `SlipExtraction` shape is otherwise only ever built in-memory by
 * EdgeFunctionSlipExtractor and is never persisted — so passing the raw parsed
 * object straight through as `extraction` (the old H6 behaviour) produced
 * items whose `amountCents`/`suggestedEnvelopeId` were all `undefined`,
 * rendering "RNaN" and corrupting the ledger on save. This normalises it and
 * returns `null` when the JSON is absent, unparseable, or the wrong shape so
 * callers can fall back to a re-scan instead of crashing.
 */
function hydrateExtraction(item: SlipQueueRow): SlipExtraction | null {
  if (!item.rawResponseJson) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(item.rawResponseJson);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as {
    merchant?: string | null;
    slip_date?: string | null;
    total_cents?: number | null;
    items?: Array<{
      description?: string;
      amount_cents?: number;
      quantity?: number;
      suggested_envelope_id?: string | null;
      confidence?: number;
    }>;
  };
  if (!Array.isArray(r.items)) return null;
  return {
    merchant: r.merchant ?? null,
    slipDate: r.slip_date ?? null,
    totalCents: r.total_cents ?? null,
    items: r.items.map((i) => ({
      description: i.description ?? '',
      amountCents: i.amount_cents ?? 0,
      quantity: i.quantity ?? 1,
      suggestedEnvelopeId: i.suggested_envelope_id ?? null,
      confidence: i.confidence ?? 0,
    })),
    rawResponseJson: item.rawResponseJson,
    openaiCostCents: item.openaiCostCents,
  };
}

export type SlipQueueScreenProps = {
  repo: ISlipQueueRepository;
  householdId: string;
  /**
   * Whether the current user has already granted slip-scan AI-processing
   * consent (DrizzleUserConsentRepository / RecordSlipConsentUseCase).
   * Defaults to false (the safe default — an unresolved/unknown consent
   * state routes through the consent screen rather than skipping it).
   */
  hasConsented?: boolean;
};

/**
 * REG-2: `status` alone can't distinguish "extracted, not yet confirmed"
 * from "confirmed and saved" — both are `slip_queue.status = 'completed'`
 * (see ExtractSlipUseCase). `isConfirmed` (whether this slip has a live
 * transaction — see `getConfirmedSlipIds`) is what tells them apart, so a
 * 'completed' row's label depends on it instead of being a fixed string.
 */
function statusLabel(status: SlipStatus, isConfirmed: boolean): string {
  switch (status) {
    case 'processing':
      return 'Processing';
    case 'completed':
      return isConfirmed ? 'Saved' : 'Needs review';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/** `createdAt` is a stored ISO timestamp — falls back to the raw string on the (unexpected) chance it doesn't parse, rather than crashing the list row. */
function formatSlipDate(createdAt: string): string {
  const parsed = parseISO(createdAt);
  return isValid(parsed) ? format(parsed, 'd MMM yyyy') : createdAt.substring(0, 10);
}

/**
 * A-1: identity of a loaded page, used to decide whether a focus refetch
 * actually changed anything. Confirming a slip does NOT touch its slip_queue
 * row (ConfirmSlipUseCase writes transactions), so the row set coming back on
 * focus is usually byte-identical — in that case the list state is left alone
 * and only the confirmed-slip lookup is re-run.
 */
function rowsKey(rows: SlipQueueRow[]): string {
  return rows.map((r) => `${r.id}:${r.status}:${r.updatedAt}:${r.rawResponseJson ?? ''}`).join('|');
}

/**
 * A-2: whether this row's `imageUris` are the REMOTE Storage paths
 * UploadSlipImagesUseCase overwrites them with after a successful upload
 * (`<householdId>/<slipId>/<frameIndex>.jpg` — see SupabaseSlipImageUploader),
 * rather than the on-device capture URIs the row was created with.
 *
 * `imageUris` is a synced column whose remote-path meaning the server and
 * other devices depend on, so it is deliberately NOT changed; this predicate
 * is how the resume path tells the two states apart instead.
 */
function hasUploadedRemotePaths(item: SlipQueueRow): boolean {
  const uris = Array.isArray(item.imageUris) ? item.imageUris : [];
  if (uris.length === 0) return false;
  // The uploader derives each path from the frame's index, and
  // UploadSlipImagesUseCase stores them in that same order.
  return uris.every((uri, i) => uri === `${item.householdId}/${item.id}/${i}.jpg`);
}

/**
 * How old a remote-path 'processing' row must be before it counts as
 * stranded rather than simply in flight.
 *
 * slip_queue is SYNCED and household-wide: a partner scanning on their phone
 * right now shows up here as 'processing' with remote `imageUris` — the exact
 * signature of a stranded slip — and so does this device's own scan if the
 * queue is reachable mid-extraction. A normal extraction finishes well inside
 * 45s (EdgeFunctionSlipExtractor's client deadline) and ~60s at worst after
 * the edge function's one OpenAI retry, so 3 minutes is comfortably past any
 * live scan while still being a short wait for a genuinely stuck one.
 */
export const STRANDED_SLIP_MIN_AGE_MS = 3 * 60 * 1000;

/** How the queue should react to a tap on a 'processing' row. */
export type ProcessingSlipAction =
  | 'resume' // frames are still on this device — restart the scan (M7)
  | 'wait' // uploaded, but young enough to still be extracting somewhere
  | 'stranded'; // uploaded, too old to still be running, frames are gone

/**
 * Age of a row in ms, preferring `updatedAt` and falling back to `createdAt`.
 * `null` when NEITHER parses — a corrupt row must never become
 * un-clearable, so callers treat `null` as "old".
 */
function slipAgeMs(item: SlipQueueRow, nowMs: number): number | null {
  for (const stamp of [item.updatedAt, item.createdAt]) {
    const parsed = stamp ? parseISO(stamp) : null;
    if (parsed && isValid(parsed)) return nowMs - parsed.getTime();
  }
  return null;
}

/**
 * Pure decision behind the A-2 resume/clear behaviour — exported so the age
 * boundary can be unit-tested with an injected `nowMs` instead of the clock.
 */
export function classifyProcessingSlip(item: SlipQueueRow, nowMs: number): ProcessingSlipAction {
  if (!hasUploadedRemotePaths(item)) return 'resume';
  const age = slipAgeMs(item, nowMs);
  if (age === null) return 'stranded';
  return age >= STRANDED_SLIP_MIN_AGE_MS ? 'stranded' : 'wait';
}

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function statusColor(status: SlipStatus, isConfirmed: boolean, colors: ThemeColors): string {
  switch (status) {
    case 'completed':
      // Not-yet-confirmed reads as a warning (it still needs the user's
      // attention — the OpenAI cost is already spent and nothing is saved
      // yet), confirmed as the normal "done" primary colour.
      return isConfirmed ? colors.primary : colors.warning;
    case 'failed':
      return colors.error;
    case 'processing':
      return colors.secondary;
    default:
      return colors.onSurfaceVariant;
  }
}

function SlipQueueItem({
  item,
  isConfirmed,
  onPress,
  colors,
}: {
  item: SlipQueueRow;
  /** Only meaningful when `item.status === 'completed'` — see `statusLabel`. */
  isConfirmed: boolean;
  onPress: (item: SlipQueueRow) => void;
  colors: ThemeColors;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.item, { borderBottomColor: colors.outlineVariant }]}
      onPress={() => onPress(item)}
      testID={`slip-item-${item.id}`}
    >
      <View style={styles.itemHeader}>
        <Text
          variant="bodyLarge"
          style={[styles.merchant, { color: colors.onSurface }]}
          numberOfLines={1}
        >
          {item.merchant ?? 'Scanning…'}
        </Text>
        <Chip
          style={[
            styles.chip,
            { backgroundColor: statusColor(item.status as SlipStatus, isConfirmed, colors) + '22' },
          ]}
          textStyle={{
            color: statusColor(item.status as SlipStatus, isConfirmed, colors),
            fontSize: 11,
          }}
          testID={`slip-status-${item.id}`}
        >
          {statusLabel(item.status as SlipStatus, isConfirmed)}
        </Chip>
      </View>
      {item.totalCents !== null && item.totalCents !== undefined && (
        <Text variant="bodySmall" style={{ color: colors.onSurface, marginTop: 2 }}>
          {formatCurrency(item.totalCents)}
        </Text>
      )}
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, marginTop: 2 }}>
        {formatSlipDate(item.createdAt)}
      </Text>
    </TouchableOpacity>
  );
}

export function SlipQueueScreen({
  repo,
  householdId,
  hasConsented = false,
}: SlipQueueScreenProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<{
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
  }>();
  const [page, setPage] = useState(0);
  const pageRows = useSlipHistory(repo, householdId, page, PAGE_SIZE);
  const [slips, setSlips] = useState<SlipQueueRow[]>([]);
  // REG-2: slip ids among the currently-loaded 'completed' rows that have at
  // least one live transaction — i.e. were actually confirmed, not merely
  // extracted (see getConfirmedSlipIds). Recomputed in one batched query
  // whenever the visible completed slips change.
  const [confirmedSlipIds, setConfirmedSlipIds] = useState<Set<string>>(new Set());
  const enqueueToast = useToastStore((s) => s.enqueue);
  // Track which pages we have already merged to prevent double-appending
  const mergedPagesRef = useRef<Map<number, string>>(new Map());
  // A-1: the rows currently on screen, readable from the focus refetch
  // without making it depend on (and therefore re-run per) `slips`.
  const slipsRef = useRef<SlipQueueRow[]>([]);
  // A-1: monotonic token for focus refetches. A slow refetch that resolves
  // after a newer one started (or after the screen blurred/unmounted) is
  // discarded instead of overwriting fresher state.
  const refreshSeqRef = useRef(0);
  // The mount render is also the first focus, and the mount effects below
  // already load page 0 — only RE-focus (coming back from SlipConfirm) needs
  // a refetch.
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    slipsRef.current = slips;
  }, [slips]);

  useEffect(() => {
    // Compute a stable key for this page's result to avoid duplicate merges
    const key = pageRows.map((r) => r.id).join(',');
    if (mergedPagesRef.current.get(page) === key) return;
    mergedPagesRef.current.set(page, key);

    if (page === 0) {
      setSlips(pageRows);
    } else {
      setSlips((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const fresh = pageRows.filter((r) => !existingIds.has(r.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    }
  }, [page, pageRows]);

  useEffect(() => {
    const completedIds = slips
      .filter((s) => (s.status as SlipStatus) === 'completed')
      .map((s) => s.id);
    if (completedIds.length === 0) {
      setConfirmedSlipIds(new Set());
      return;
    }
    let cancelled = false;
    getConfirmedSlipIds(db, householdId, completedIds)
      .then((ids) => {
        if (!cancelled) setConfirmedSlipIds(ids);
      })
      .catch(() => {
        // On a query error, fall back to treating every completed slip as
        // unconfirmed rather than caching a stale set: worst case an
        // already-saved slip reopens editable instead of read-only, and
        // ConfirmSlipUseCase's idempotency guard still stops a re-save from
        // duplicating its transactions.
        if (!cancelled) setConfirmedSlipIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [slips, householdId]);

  /**
   * A-1: re-read page 0 and recompute `confirmedSlipIds`.
   *
   * Without this the queue kept whatever it loaded on mount: after confirming
   * a slip and going back, the row still looked unconfirmed, so tapping it
   * reopened it EDITABLE and a re-save hit ConfirmSlipUseCase's idempotency
   * guard — which returns success with `transactionIds: []`, i.e. the user is
   * told their edit saved when nothing was written.
   */
  const refreshFirstPage = useCallback(async (): Promise<void> => {
    const seq = ++refreshSeqRef.current;
    try {
      const rows = await repo.listByHousehold(householdId, PAGE_SIZE, 0);
      // A newer refresh started (or the screen blurred/unmounted) while this
      // one was in flight — drop it rather than resurrecting older rows.
      if (seq !== refreshSeqRef.current) return;

      // Compare against the first page only: `slipsRef` also holds any later
      // pages the user scrolled in, and comparing the whole list would make
      // every refocus look "changed" and throw those pages away.
      const visible = slipsRef.current;
      if (rowsKey(rows) !== rowsKey(visible.slice(0, PAGE_SIZE))) {
        // Rows actually changed: reset to a single fresh page and let the
        // `[slips]` effect below do the confirmed-slip lookup.
        mergedPagesRef.current.clear();
        mergedPagesRef.current.set(0, rows.map((r) => r.id).join(','));
        setPage(0);
        setSlips(rows);
        return;
      }

      // Identical rows — which is the normal case, because confirming a slip
      // writes transactions and never touches its slip_queue row. The
      // confirmed-slip lookup still has to re-run, or nothing would ever
      // notice the new transaction.
      const completedIds = visible
        .filter((s) => (s.status as SlipStatus) === 'completed')
        .map((s) => s.id);
      const ids =
        completedIds.length > 0
          ? await getConfirmedSlipIds(db, householdId, completedIds)
          : new Set<string>();
      if (seq !== refreshSeqRef.current) return;
      setConfirmedSlipIds(ids);
    } catch {
      // Keep the last known state on a refresh error. Falling back to "no
      // slip is confirmed" here would reintroduce exactly the silent-no-op
      // re-save this refresh exists to prevent.
    }
  }, [repo, householdId]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        // First focus is the mount render; `useSlipHistory` and the effects
        // above are already loading page 0.
        hasFocusedRef.current = true;
        return;
      }
      void refreshFirstPage();
      // Blur (or unmount) invalidates any refresh still in flight.
      return () => {
        refreshSeqRef.current += 1;
      };
    }, [refreshFirstPage]),
  );

  const loadMore = useCallback((): void => {
    setPage((p) => {
      if (pageRows.length === PAGE_SIZE) return p + 1;
      return p;
    });
  }, [pageRows.length]);

  /**
   * A-2: a 'processing' row whose `imageUris` are already REMOTE Storage
   * paths was killed between upload and extraction, and the frames it was
   * captured from are gone (nothing on this device persists them — see
   * SlipImageLocalStore, which no capture path calls).
   *
   * Extraction genuinely cannot be resumed from the remote paths: the
   * `extract-slip` edge function only accepts `images_base64` (1–5 inline
   * frames) and there is no download port to turn a Storage path back into
   * base64. Re-running the old resume path just fed remote paths to the
   * compressor as if they were local URIs, which throws — so the row could
   * never leave 'processing'. Fail fast and offer to clear it instead of
   * looping the user through the same crash.
   */
  const handleUnresumableSlip = useCallback(
    async (item: SlipQueueRow): Promise<void> => {
      const clear = await confirm({
        title: 'This scan can’t be finished',
        message:
          'The photos were uploaded but the scan was interrupted, and they are no longer on this device. Clear this slip so you can scan it again?',
        confirmLabel: 'Clear slip',
        cancelLabel: 'Keep it',
        destructive: true,
      });
      if (!clear) return;
      try {
        // Existing columns only, and the same pair ExtractSlipUseCase writes
        // on a failed extraction — a 'failed' row taps through to a re-scan.
        await repo.update(item.id, {
          status: 'failed',
          errorMessage: 'Scan interrupted — the photos are no longer on this device.',
        });
        enqueueToast('Slip cleared — scan it again when you’re ready.', 'info');
        await refreshFirstPage();
      } catch {
        enqueueToast('Could not clear this slip. Please try again.', 'error');
      }
    },
    [repo, enqueueToast, refreshFirstPage],
  );

  const handlePress = useCallback(
    (item: SlipQueueRow): void => {
      switch (item.status as SlipStatus) {
        case 'processing': {
          // M7: a slip stuck at 'processing' (app killed mid-scan) must carry
          // the params SlipProcessingScreen requires — omitting them made its
          // mount effect call startScan({ frameLocalUris: undefined }), which
          // threw a TypeError and left the user on a permanent spinner. The
          // captured frames are stored on the row (imageUris), so resume the
          // scan from them rather than starting a blank one.
          //
          // A-2: unless the upload already replaced them with remote Storage
          // paths, in which case there is nothing left to resume from — and
          // a row that young may simply be a scan still running on another
          // device in the household (slip_queue is synced), which must not be
          // offered up for clearing.
          const action = classifyProcessingSlip(item, Date.now());
          if (action === 'wait') {
            enqueueToast('This slip is still being read — give it a minute.', 'info');
            break;
          }
          if (action === 'stranded') {
            void handleUnresumableSlip(item);
            break;
          }
          navigation.navigate('SlipProcessing', {
            householdId: item.householdId,
            createdBy: item.createdBy,
            frameLocalUris: item.imageUris,
          });
          break;
        }
        case 'failed': {
          // H6: if extraction already succeeded (raw_response_json present),
          // route to confirm so the user can review and save without
          // re-scanning — but normalise the SNAKE_CASE stored JSON into a
          // real SlipExtraction first (passing it raw gave undefined amounts).
          // If there is no usable extraction, fall back to a re-scan.
          const extraction = hydrateExtraction(item);
          if (extraction) {
            navigation.navigate('SlipConfirm', { slipId: item.id, extraction });
          } else {
            navigation.navigate('SlipCapture', { householdId, slipId: item.id });
          }
          break;
        }
        case 'completed': {
          // H5: a completed slip MUST carry its extraction — SlipConfirmScreen
          // dereferences extraction.items and previously crashed when the tap
          // navigated with only { slipId }. Hydrate it from the stored
          // response; if it is somehow missing/corrupt, fall back to a re-scan
          // rather than white-screening the confirm screen.
          //
          // REG-2: `slip_queue.status = 'completed'` only means extraction
          // succeeded (see ExtractSlipUseCase) — it does NOT mean the user
          // ever confirmed/saved it. `readOnly` must reflect whether this
          // slip actually has a live transaction (`confirmedSlipIds`, from
          // `getConfirmedSlipIds`), not the status alone: opening an
          // unconfirmed slip read-only would strand it forever with no Save
          // button after the OpenAI cost was already spent.
          const extraction = hydrateExtraction(item);
          if (extraction) {
            navigation.navigate('SlipConfirm', {
              slipId: item.id,
              extraction,
              readOnly: confirmedSlipIds.has(item.id),
            });
          } else {
            navigation.navigate('SlipCapture', { householdId, slipId: item.id });
          }
          break;
        }
        default:
          break;
      }
    },
    [navigation, householdId, confirmedSlipIds, handleUnresumableSlip, enqueueToast],
  );

  // Slip scanning's START — unreachable before this fix (the empty state
  // referenced a "camera button" that didn't exist). Consent gates AI slip
  // processing (see SlipConsentScreen), so route through it first unless the
  // user has already granted it.
  const handleScanPress = useCallback((): void => {
    navigation.navigate(hasConsented ? 'SlipCapture' : 'SlipConsent');
  }, [navigation, hasConsented]);

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surface }]}
      testID="slip-queue-screen"
    >
      <FlatList
        data={slips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SlipQueueItem
            item={item}
            isConfirmed={confirmedSlipIds.has(item.id)}
            onPress={handlePress}
            colors={colors}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text
              variant="bodyMedium"
              style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}
            >
              No slips yet. Tap the camera button to scan your first slip.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        testID="slip-queue-list"
      />
      <FAB
        icon="camera"
        style={[styles.fab, { backgroundColor: colors.primary }]}
        color={colors.onPrimary}
        onPress={handleScanPress}
        testID="slip-queue-camera-fab"
        accessibilityLabel="Scan a slip"
        accessibilityRole="button"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: spacing.xl },
  item: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  merchant: { flex: 1, marginRight: spacing.sm },
  chip: { borderRadius: radius.full },
  empty: { padding: spacing.xl, alignItems: 'center' },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});

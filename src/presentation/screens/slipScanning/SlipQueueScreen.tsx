import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Chip, FAB } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { format, isValid, parseISO } from 'date-fns';
import { useSlipHistory } from '../../hooks/useSlipHistory';
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
  // Track which pages we have already merged to prevent double-appending
  const mergedPagesRef = useRef<Map<number, string>>(new Map());

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

  const loadMore = useCallback((): void => {
    setPage((p) => {
      if (pageRows.length === PAGE_SIZE) return p + 1;
      return p;
    });
  }, [pageRows.length]);

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
    [navigation, householdId, confirmedSlipIds],
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

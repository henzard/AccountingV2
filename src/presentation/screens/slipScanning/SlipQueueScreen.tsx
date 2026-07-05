import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Chip, FAB } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSlipHistory } from '../../hooks/useSlipHistory';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
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

function statusLabel(status: SlipStatus): string {
  switch (status) {
    case 'processing':
      return 'Processing';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

function statusColor(status: SlipStatus, colors: ThemeColors): string {
  switch (status) {
    case 'completed':
      return colors.primary;
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
  onPress,
  colors,
}: {
  item: SlipQueueRow;
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
            { backgroundColor: statusColor(item.status as SlipStatus, colors) + '22' },
          ]}
          textStyle={{ color: statusColor(item.status as SlipStatus, colors), fontSize: 11 }}
          testID={`slip-status-${item.id}`}
        >
          {statusLabel(item.status as SlipStatus)}
        </Chip>
      </View>
      {item.totalCents !== null && item.totalCents !== undefined && (
        <Text variant="bodySmall" style={{ color: colors.onSurface, marginTop: 2 }}>
          R{(item.totalCents / 100).toFixed(2)}
        </Text>
      )}
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, marginTop: 2 }}>
        {item.createdAt.substring(0, 10)}
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
          const extraction = hydrateExtraction(item);
          if (extraction) {
            navigation.navigate('SlipConfirm', { slipId: item.id, extraction });
          } else {
            navigation.navigate('SlipCapture', { householdId, slipId: item.id });
          }
          break;
        }
        default:
          break;
      }
    },
    [navigation, householdId],
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
          <SlipQueueItem item={item} onPress={handlePress} colors={colors} />
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

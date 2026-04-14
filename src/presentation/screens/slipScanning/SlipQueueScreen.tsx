import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Chip } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSlipHistory } from '../../hooks/useSlipHistory';
import { colours, spacing, radius } from '../../theme/tokens';
import type {
  SlipQueueRow,
  ISlipQueueRepository,
} from '../../../domain/ports/ISlipQueueRepository';
import type { SlipStatus } from '../../../domain/slipScanning/types';

const PAGE_SIZE = 20;

export type SlipQueueScreenProps = {
  repo: ISlipQueueRepository;
  householdId: string;
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

function statusColor(status: SlipStatus): string {
  switch (status) {
    case 'completed':
      return colours.primary;
    case 'failed':
      return colours.error;
    case 'processing':
      return colours.secondary;
    default:
      return colours.onSurfaceVariant;
  }
}

function SlipQueueItem({
  item,
  onPress,
}: {
  item: SlipQueueRow;
  onPress: (item: SlipQueueRow) => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={() => onPress(item)}
      testID={`slip-item-${item.id}`}
    >
      <View style={styles.itemHeader}>
        <Text variant="bodyLarge" style={styles.merchant} numberOfLines={1}>
          {item.merchant ?? 'Scanning…'}
        </Text>
        <Chip
          style={[styles.chip, { backgroundColor: statusColor(item.status as SlipStatus) + '22' }]}
          textStyle={{ color: statusColor(item.status as SlipStatus), fontSize: 11 }}
          testID={`slip-status-${item.id}`}
        >
          {statusLabel(item.status as SlipStatus)}
        </Chip>
      </View>
      {item.totalCents !== null && item.totalCents !== undefined && (
        <Text variant="bodySmall" style={styles.total}>
          R{(item.totalCents / 100).toFixed(2)}
        </Text>
      )}
      <Text variant="bodySmall" style={styles.date}>
        {item.createdAt.substring(0, 10)}
      </Text>
    </TouchableOpacity>
  );
}

export function SlipQueueScreen({ repo, householdId }: SlipQueueScreenProps): React.JSX.Element {
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
        case 'processing':
          navigation.navigate('SlipProcessing', { slipId: item.id });
          break;
        case 'failed':
          // If extraction already succeeded (raw_response_json present), route to confirm
          // so the user can review and save without re-scanning.
          if (item.rawResponseJson) {
            try {
              const extraction = JSON.parse(item.rawResponseJson);
              navigation.navigate('SlipConfirm', { slipId: item.id, extraction });
            } catch {
              navigation.navigate('SlipCapture', { householdId, slipId: item.id });
            }
          } else {
            navigation.navigate('SlipCapture', { householdId, slipId: item.id });
          }
          break;
        case 'completed':
          navigation.navigate('SlipConfirm', { slipId: item.id });
          break;
        default:
          break;
      }
    },
    [navigation, householdId],
  );

  return (
    <View style={styles.container} testID="slip-queue-screen">
      <FlatList
        data={slips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SlipQueueItem item={item} onPress={handlePress} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodyMedium" style={styles.emptyText}>
              No slips yet. Tap the camera button to scan your first slip.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        testID="slip-queue-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.surface },
  listContent: { paddingBottom: spacing.xl },
  item: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colours.outlineVariant,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  merchant: { flex: 1, color: colours.onSurface, marginRight: spacing.sm },
  chip: { borderRadius: radius.full },
  total: { color: colours.onSurface, marginTop: 2 },
  date: { color: colours.onSurfaceVariant, marginTop: 2 },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: colours.onSurfaceVariant, textAlign: 'center' },
});

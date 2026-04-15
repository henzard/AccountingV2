import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Text, Chip } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSlipHistory } from '../../hooks/useSlipHistory';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
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

export function SlipQueueScreen({ repo, householdId }: SlipQueueScreenProps): React.JSX.Element {
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
});

// src/presentation/screens/settings/SyncHealthScreen.tsx
//
// Settings → "Sync Health" (Task 5): the user-facing surface for the
// production SyncEngine (Task 3) + SyncScheduler (Task 4) wired at boot by
// App.tsx (Task 5). Shows:
//   - last synced time + pending (unpushed) op count, and a manual
//     "Sync now" button.
//   - a pull-blocked banner when this household's puller is stalled on a
//     poison batch (SyncEngine.getPullHealth), with a "Retry" action that
//     calls the manual `clearPullBlock` unblock (Task 5 addition -- the
//     Task 3 review flagged that the block otherwise only clears on app
//     restart).
//   - the DLQ inbox: dead-lettered ops, each with per-item Retry (requeue for
//     the pusher) and Discard (re-pull the row from the server via
//     `sync_row_state` and drop the local op -- spec §6.10).
//
// WCAG 2.2 AA: every interactive control has an accessibilityRole+Label, a
// >=48dp hit target, and status changes are announced via a polite live
// region. Status is never color-only -- every colored state also carries an
// icon + text label.

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppStore } from '../../stores/appStore';
import { useSyncStore } from '../../stores/syncStore';
import { useSyncEngineStore } from '../../stores/syncEngineStore';
import type { DeadLetteredOp, PullHealth } from '../../../data/sync/SyncEngine';
import { radius, spacing, fontSize } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

const MIN_TOUCH = 48;

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString();
}

/** Short, non-sensitive label for one DLQ row -- never shows the op payload
 * (§7.4, financial data), only table/op-type/row-id metadata. */
function opLabel(op: DeadLetteredOp): string {
  const shortRowId = op.rowId.length > 8 ? `${op.rowId.slice(0, 8)}…` : op.rowId;
  return `${op.table} · ${op.opType} · ${shortRowId}`;
}

export const SyncHealthScreen: React.FC = () => {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId);
  const engine = useSyncEngineStore((s) => s.engine);
  const scheduler = useSyncEngineStore((s) => s.scheduler);

  const isOnline = useSyncStore((s) => s.isOnline);
  const syncStatus = useSyncStore((s) => s.syncStatus);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const pendingCount = useSyncStore((s) => s.pendingSyncCount);
  const storeError = useSyncStore((s) => s.error);
  const pullBlockedFlag = useSyncStore((s) => s.pullBlocked);

  const [pullHealth, setPullHealth] = useState<PullHealth>({ blocked: false });
  const [deadLetters, setDeadLetters] = useState<DeadLetteredOp[]>([]);
  const [busyOpId, setBusyOpId] = useState<string | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string>('');

  const refresh = useCallback(() => {
    if (!engine || !householdId) return;
    setPullHealth(engine.getPullHealth(householdId));
    setDeadLetters(engine.listDeadLettered(householdId));
  }, [engine, householdId]);

  // Re-reads whenever the scheduler reports a completed round (pendingCount /
  // syncStatus / pullBlocked all update together after every sync() attempt --
  // see SyncScheduler.refreshDiagnostics) -- no polling needed.
  useEffect(() => {
    refresh();
  }, [refresh, pendingCount, syncStatus, pullBlockedFlag]);

  const handleSyncNow = (): void => {
    if (!scheduler || !householdId) return;
    setLiveMessage('Sync started.');
    scheduler.requestSync(householdId, { immediate: true });
  };

  const handleClearPullBlock = (): void => {
    if (!engine || !householdId) return;
    engine.clearPullBlock(householdId);
    setLiveMessage('Sync block cleared. Retrying now.');
    refresh();
    scheduler?.requestSync(householdId, { immediate: true });
  };

  const handleRetry = (opId: string): void => {
    if (!engine || !householdId) return;
    setBusyOpId(opId);
    try {
      engine.retryDeadLettered(opId);
      setLiveMessage('Operation queued for retry.');
      refresh();
      scheduler?.requestSync(householdId, { immediate: true });
    } finally {
      setBusyOpId(null);
    }
  };

  const handleDiscard = async (opId: string): Promise<void> => {
    if (!engine) return;
    setBusyOpId(opId);
    setDiscardError(null);
    try {
      await engine.discardDeadLettered(opId);
      setLiveMessage('Operation discarded. Row refreshed from the server.');
      refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not discard this operation. Check your connection and try again.';
      setDiscardError(message);
      setLiveMessage(`Discard failed: ${message}`);
    } finally {
      setBusyOpId(null);
    }
  };

  const syncStatusLabel =
    syncStatus === 'syncing'
      ? 'Syncing…'
      : syncStatus === 'error'
        ? 'Sync error'
        : isOnline
          ? 'Up to date'
          : 'Offline';
  const syncStatusIcon =
    syncStatus === 'syncing'
      ? 'sync'
      : syncStatus === 'error'
        ? 'alert-circle-outline'
        : isOnline
          ? 'check-circle-outline'
          : 'cloud-off-outline';
  const syncStatusColor =
    syncStatus === 'error' ? colors.error : isOnline ? colors.success : colors.onSurfaceVariant;

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      accessibilityLabel="Sync Health screen"
    >
      {/* Live region: announces status changes from user actions below. Kept
          visually minimal (it duplicates on-screen text) -- purely for AT. */}
      <Text
        accessibilityLiveRegion="polite"
        accessible
        style={styles.srOnly}
        testID="sync-health-live-region"
      >
        {liveMessage}
      </Text>

      <Surface
        style={[styles.section, { backgroundColor: colors.surface }]}
        elevation={0}
        testID="sync-status-card"
      >
        <View style={styles.statusRow}>
          <MaterialCommunityIcons name={syncStatusIcon} size={22} color={syncStatusColor} />
          <Text
            variant="titleMedium"
            style={[styles.statusLabel, { color: syncStatusColor }]}
            testID="sync-status-label"
          >
            {syncStatusLabel}
          </Text>
        </View>

        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          Last synced: {formatTimestamp(lastSyncAt)}
        </Text>
        <Text
          variant="bodyMedium"
          style={{ color: colors.onSurfaceVariant }}
          testID="pending-count-label"
        >
          Pending changes: {pendingCount}
        </Text>
        {storeError && (
          <Text variant="bodySmall" style={{ color: colors.error }} testID="sync-error-message">
            Last sync error: {storeError}
          </Text>
        )}

        <Button
          mode="contained"
          onPress={handleSyncNow}
          disabled={!scheduler || !householdId}
          style={styles.touchTarget}
          contentStyle={styles.touchTargetContent}
          accessibilityRole="button"
          accessibilityLabel="Sync now"
          testID="sync-now-button"
        >
          Sync now
        </Button>
      </Surface>

      {pullHealth.blocked && (
        <Surface
          style={[styles.section, { backgroundColor: colors.warningContainer }]}
          elevation={0}
          testID="pull-blocked-banner"
          accessibilityRole="alert"
          accessibilityLabel={`Sync is paused for this household. ${
            pullHealth.opIds?.length ?? 0
          } operations could not be applied.`}
        >
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name="pause-circle-outline" size={22} color={colors.warning} />
            <Text variant="titleSmall" style={[styles.statusLabel, { color: colors.warning }]}>
              Sync paused for this household
            </Text>
          </View>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {pullHealth.opIds?.length ?? 0} incoming change(s) could not be applied
            {pullHealth.blockedAt ? ` since ${formatTimestamp(pullHealth.blockedAt)}` : ''}. This
            usually needs an app update.
          </Text>
          <Button
            mode="outlined"
            onPress={handleClearPullBlock}
            style={styles.touchTarget}
            contentStyle={styles.touchTargetContent}
            accessibilityRole="button"
            accessibilityLabel="Retry paused sync"
            testID="clear-pull-block-button"
          >
            Retry
          </Button>
        </Surface>
      )}

      <Surface
        style={[styles.section, { backgroundColor: colors.surface }]}
        elevation={0}
        testID="dlq-section"
      >
        <Text variant="titleSmall" style={[styles.sectionTitle, { color: colors.onSurface }]}>
          Needs attention ({deadLetters.length})
        </Text>
        {discardError && (
          <Text
            variant="bodySmall"
            style={{ color: colors.error }}
            accessibilityRole="alert"
            testID="discard-error-message"
          >
            {discardError}
          </Text>
        )}
        {deadLetters.length === 0 ? (
          <Text
            variant="bodySmall"
            style={{ color: colors.onSurfaceVariant }}
            testID="dlq-empty-state"
          >
            Nothing needs attention. All changes are syncing normally.
          </Text>
        ) : (
          deadLetters.map((op) => {
            const busy = busyOpId === op.opId;
            return (
              <View
                key={op.opId}
                style={[styles.dlqRow, { borderColor: colors.outlineVariant }]}
                testID={`dlq-row-${op.opId}`}
              >
                <View style={styles.dlqRowHeader}>
                  <MaterialCommunityIcons
                    name="alert-octagon-outline"
                    size={18}
                    color={colors.error}
                  />
                  <Text
                    variant="bodyMedium"
                    style={[styles.dlqLabel, { color: colors.onSurface }]}
                    accessibilityLabel={`Failed change: ${opLabel(op)}. Rejected on ${formatTimestamp(op.deadLetteredAt)}.`}
                  >
                    {opLabel(op)}
                  </Text>
                </View>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Rejected {formatTimestamp(op.deadLetteredAt)}
                </Text>
                <View style={styles.dlqActions}>
                  <Button
                    mode="text"
                    onPress={() => handleRetry(op.opId)}
                    disabled={busy}
                    loading={busy}
                    style={styles.touchTarget}
                    contentStyle={styles.touchTargetContent}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry ${opLabel(op)}`}
                    testID={`dlq-retry-${op.opId}`}
                  >
                    Retry
                  </Button>
                  <Button
                    mode="text"
                    textColor={colors.error}
                    onPress={() => void handleDiscard(op.opId)}
                    disabled={busy}
                    loading={busy}
                    style={styles.touchTarget}
                    contentStyle={styles.touchTargetContent}
                    accessibilityRole="button"
                    accessibilityLabel={`Discard ${opLabel(op)}`}
                    testID={`dlq-discard-${op.opId}`}
                  >
                    Discard
                  </Button>
                </View>
              </View>
            );
          })
        )}
      </Surface>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  section: {
    marginTop: spacing.base,
    marginHorizontal: spacing.base,
    borderRadius: radius.md,
    padding: spacing.base,
    gap: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusLabel: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    marginBottom: spacing.xs,
  },
  touchTarget: {
    marginTop: spacing.sm,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  touchTargetContent: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.sm,
  },
  dlqRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  dlqRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dlqLabel: {
    flexShrink: 1,
  },
  dlqActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    fontSize: fontSize.xs,
  },
});

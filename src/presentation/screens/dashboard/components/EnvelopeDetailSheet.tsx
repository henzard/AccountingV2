/**
 * EnvelopeDetailSheet — in-screen bottom sheet opened by tapping a dashboard
 * envelope row. Replaces the old "tap opens the edit form" behaviour (VAL-9):
 * the everyday need is "what did we spend here / add a transaction here",
 * not editing the envelope's allocation.
 *
 * A real modal sheet (UX2-7): RN `Modal` (transparent, slide-up) with a
 * scrim backdrop, a drag handle, `accessibilityViewIsModal`, and
 * `onRequestClose` so the Android hardware back button closes the sheet
 * instead of exiting the screen underneath it — same pattern as
 * `slipScanning/components/EnvelopePickerSheet`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { db } from '../../../../data/local/db';
import { getEnvelopeScope } from '../../../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeEntity } from '../../../../domain/envelopes/EnvelopeEntity';
import type { TransactionEntity } from '../../../../domain/transactions/TransactionEntity';
import { resolveEnvelopeTransactions } from '../resolveEnvelopeTransactions';
import { AdjustSavedAmountDialog } from '../../../components/envelopes/AdjustSavedAmountDialog';
import { formatCurrency } from '../../../utils/currency';
import { useAppTheme } from '../../../theme/useAppTheme';
import { spacing, radius, fontSize } from '../../../theme/tokens';

interface Props {
  visible: boolean;
  envelope: EnvelopeEntity | null;
  householdId: string;
  /** Persistent envelopes' real saved balance (see usePersistentEnvelopeSavings). */
  savedCentsByEnvelopeId: ReadonlyMap<string, number>;
  /**
   * The household's CURRENT budget period start (YYYY-MM-DD) — required only
   * for the "Adjust saved amount" action on a persistent envelope, which
   * records the correction against the period it happens in, not whichever
   * period the fund itself was created in or is being viewed from.
   */
  currentPeriodStart: string;
  onDismiss: () => void;
  onAddTransaction: (envelopeId: string) => void;
  /** Row tapped — opens that transaction for editing, then closes the sheet. */
  onOpenTransaction: (transactionId: string) => void;
  onEditEnvelope: (envelopeId: string) => void;
  /** A saved-balance correction was committed — parent should reload it. */
  onSavedAmountAdjusted?: () => void;
}

const PERSISTENT_TRANSACTION_LIMIT = 20;

export function EnvelopeDetailSheet({
  visible,
  envelope,
  householdId,
  savedCentsByEnvelopeId,
  currentPeriodStart,
  onDismiss,
  onAddTransaction,
  onOpenTransaction,
  onEditEnvelope,
  onSavedAmountAdjusted,
}: Props): React.JSX.Element | null {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [transactions, setTransactions] = useState<TransactionEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);

  const envelopeId = envelope?.id ?? null;
  const isPersistent = envelope ? getEnvelopeScope(envelope) === 'persistent' : false;

  const loadTransactions = useCallback((): (() => void) => {
    if (!visible || !envelopeId) {
      setTransactions([]);
      setError(null);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    resolveEnvelopeTransactions(
      db,
      householdId,
      envelopeId,
      isPersistent ? PERSISTENT_TRANSACTION_LIMIT : undefined,
    )
      .then((rows) => {
        if (!cancelled) setTransactions(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setTransactions([]);
          setError(e instanceof Error ? e.message : 'Failed to load transactions');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, envelopeId, householdId, isPersistent]);

  useEffect(() => loadTransactions(), [loadTransactions]);

  if (!visible || !envelope) return null;

  const remaining = envelope.allocatedCents - envelope.spentCents;
  const savedCents = savedCentsByEnvelopeId.get(envelope.id) ?? 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
      testID="envelope-detail-sheet-overlay"
    >
      <View style={StyleSheet.absoluteFill}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close envelope details"
          testID="envelope-detail-backdrop"
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, paddingBottom: spacing.base + insets.bottom },
          ]}
          testID="envelope-detail-sheet"
        >
          <View
            style={[styles.handle, { backgroundColor: colors.outline }]}
            testID="envelope-detail-handle"
          />

          <View style={styles.header}>
            <Text
              variant="titleLarge"
              style={{ color: colors.onSurface }}
              testID="envelope-detail-name"
            >
              {envelope.name}
            </Text>

            {isPersistent ? (
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.onSurfaceVariant }]}>Saved</Text>
                  <Text style={[styles.statValue, { color: colors.onSurface }]}>
                    {formatCurrency(savedCents)}
                  </Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.onSurfaceVariant }]}>
                    Monthly contribution
                  </Text>
                  <Text style={[styles.statValue, { color: colors.onSurface }]}>
                    {formatCurrency(envelope.allocatedCents)}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.onSurfaceVariant }]}>
                    Allocated
                  </Text>
                  <Text style={[styles.statValue, { color: colors.onSurface }]}>
                    {formatCurrency(envelope.allocatedCents)}
                  </Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.onSurfaceVariant }]}>Spent</Text>
                  <Text style={[styles.statValue, { color: colors.onSurface }]}>
                    {formatCurrency(envelope.spentCents)}
                  </Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statLabel, { color: colors.onSurfaceVariant }]}>
                    Remaining
                  </Text>
                  <Text
                    style={[
                      styles.statValue,
                      { color: remaining < 0 ? colors.error : colors.onSurface },
                    ]}
                  >
                    {formatCurrency(remaining)}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {loading ? (
            <View style={styles.loadingRow} testID="envelope-detail-loading">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.emptyRow}>
              <Text
                style={{ color: colors.error }}
                testID="envelope-detail-error"
                accessibilityRole="text"
              >
                {error}
              </Text>
              <Button
                mode="text"
                onPress={loadTransactions}
                testID="envelope-detail-retry"
                accessibilityRole="button"
                accessibilityLabel="Retry loading transactions"
              >
                Retry
              </Button>
            </View>
          ) : transactions.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text
                style={{ color: colors.onSurfaceVariant }}
                testID="envelope-detail-empty"
                accessibilityRole="text"
              >
                No spending here yet
              </Text>
            </View>
          ) : (
            <FlatList
              testID="envelope-detail-transaction-list"
              data={transactions}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.txRow}
                  onPress={() => onOpenTransaction(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.payee || item.description || 'Transaction'}, ${formatCurrency(item.amountCents)}`}
                  testID={`envelope-detail-tx-${item.id}`}
                >
                  <View style={styles.txInfo}>
                    <Text style={[styles.txPayee, { color: colors.onSurface }]} numberOfLines={1}>
                      {item.payee || item.description || 'Transaction'}
                    </Text>
                    <Text style={[styles.txDate, { color: colors.onSurfaceVariant }]}>
                      {format(parseISO(item.transactionDate), 'd MMM')}
                    </Text>
                  </View>
                  <Text style={[styles.txAmount, { color: colors.onSurface }]}>
                    {formatCurrency(item.amountCents)}
                  </Text>
                </Pressable>
              )}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: colors.outlineVariant }]} />
              )}
            />
          )}

          <View style={styles.actions}>
            <Button
              mode="outlined"
              onPress={() => onEditEnvelope(envelope.id)}
              style={styles.actionBtn}
              testID="envelope-detail-edit"
              accessibilityRole="button"
              accessibilityLabel="Edit envelope"
            >
              Edit envelope
            </Button>
            <Button
              mode="contained"
              onPress={() => onAddTransaction(envelope.id)}
              style={styles.actionBtn}
              testID="envelope-detail-add-transaction"
              accessibilityRole="button"
              accessibilityLabel="Add transaction"
            >
              Add transaction
            </Button>
          </View>

          {isPersistent && (
            <Button
              mode="text"
              onPress={() => setShowAdjustDialog(true)}
              testID="envelope-detail-adjust-saved"
              accessibilityRole="button"
              accessibilityLabel="Adjust saved amount"
            >
              Adjust saved amount
            </Button>
          )}
        </View>
      </View>

      {isPersistent && (
        <AdjustSavedAmountDialog
          visible={showAdjustDialog}
          householdId={householdId}
          envelopeId={envelope.id}
          envelopeName={envelope.name}
          savedCents={savedCents}
          periodStart={currentPeriodStart}
          onDone={(adjusted) => {
            setShowAdjustDialog(false);
            if (adjusted) onSavedAmountAdjusted?.();
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.base,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  header: {
    marginBottom: spacing.base,
  },
  statRow: {
    flexDirection: 'row',
    marginTop: spacing.base,
    gap: spacing.lg,
  },
  stat: { gap: 2 },
  statLabel: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
  },
  statValue: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.base,
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  list: {
    maxHeight: 320,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  txInfo: { flex: 1, marginRight: spacing.sm },
  txPayee: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.sm,
  },
  txDate: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  txAmount: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: fontSize.sm,
  },
  separator: { height: StyleSheet.hairlineWidth },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.base,
  },
  actionBtn: { flex: 1 },
});

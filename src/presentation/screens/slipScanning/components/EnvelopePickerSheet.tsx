import React, { useMemo } from 'react';
import { View, StyleSheet, Modal, FlatList, Pressable } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import { formatCurrency } from '../../../utils/currency';
import { getEnvelopeScope } from '../../../../domain/envelopes/EnvelopeEntity';
import type { EnvelopeType } from '../../../../domain/envelopes/EnvelopeEntity';
import { useAppStore } from '../../../stores/appStore';
import { usePersistentEnvelopeSavings } from '../../../hooks/usePersistentEnvelopeSavings';

export interface EnvelopeOption {
  id: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
  envelopeType: EnvelopeType;
  /** Lets the picker choose a duplicated persistent fund's canonical row. */
  createdAt?: string;
}

/**
 * REG-8/VAL2-2: `allocatedCents - spentCents` is only a real balance for a
 * PERIOD-scoped envelope. For a PERSISTENT one (savings / emergency_fund /
 * sinking_fund / baby_step), `allocatedCents` is the monthly contribution,
 * not a balance, and `spentCents` is its all-time spend — the difference is
 * meaningless (a Holiday fund with R6 000 saved and a R500/month
 * contribution read "R500 left"). The real balance is the saved-so-far
 * total from the contribution ledger (`getPersistentEnvelopeSavedCents`,
 * read here via `usePersistentEnvelopeSavings`), keyed by envelope id.
 */
function formatBalance(
  env: EnvelopeOption,
  savedCentsByEnvelopeId: ReadonlyMap<string, number>,
): string {
  if (getEnvelopeScope({ envelopeType: env.envelopeType }) === 'persistent') {
    const saved = savedCentsByEnvelopeId.get(env.id) ?? 0;
    return `${formatCurrency(saved)} saved`;
  }
  const balance = env.allocatedCents - env.spentCents;
  return `${formatCurrency(balance)} left`;
}

function balanceCents(
  env: EnvelopeOption,
  savedCentsByEnvelopeId: ReadonlyMap<string, number>,
): number {
  return getEnvelopeScope({ envelopeType: env.envelopeType }) === 'persistent'
    ? (savedCentsByEnvelopeId.get(env.id) ?? 0)
    : env.allocatedCents - env.spentCents;
}

/** Carrier order: earliest `createdAt`, then lowest id. */
function isEarlierCarrier(a: EnvelopeOption, b: EnvelopeOption): boolean {
  const aCreated = a.createdAt ?? '';
  const bCreated = b.createdAt ?? '';
  return aCreated === bCreated ? a.id < b.id : aCreated < bCreated;
}

/**
 * A real household's envelope history repeats the same (type, name) pair
 * once per budget period — 216 live envelopes on 18 periods here means up to
 * 18 rows all named "Food", and the one persistent-type row per name
 * (e.g. "Saving") that should exist FOREVER instead exists once per period
 * too, because the import created it that way (the underlying data is being
 * fixed separately). Whatever list a caller hands this sheet, a picker must
 * never present two rows a person cannot tell apart — so collapse to one
 * row per (envelope_type, name), case-insensitively and trimmed, matching
 * the same identity rule history-based features use elsewhere.
 *
 * The row kept is the fund's CARRIER — earliest `createdAt`, then lowest
 * id — the same rule `groupPersistentFunds` uses at rollover. That is the
 * row the monthly contribution lands on, so a spend picked here comes off
 * the balance that is actually growing instead of a sibling row's.
 */
function dedupeByTypeAndName(options: EnvelopeOption[]): EnvelopeOption[] {
  const carrierIndexByKey = new Map<string, number>();
  const result: EnvelopeOption[] = [];
  for (const option of options) {
    // PERSISTENT funds only. Callers already scope period envelopes to one
    // period, so two same-named spending envelopes there are the user's own,
    // distinct envelopes — hiding one would make it impossible to pick.
    if (getEnvelopeScope(option) !== 'persistent') {
      result.push(option);
      continue;
    }
    const key = `${option.envelopeType}:${option.name.trim().toLowerCase()}`;
    const index = carrierIndexByKey.get(key);
    if (index === undefined) {
      carrierIndexByKey.set(key, result.length);
      result.push(option);
    } else if (isEarlierCarrier(option, result[index])) {
      result[index] = option;
    }
  }
  return result;
}

export type EnvelopePickerSheetProps = {
  visible: boolean;
  envelopes: EnvelopeOption[];
  selectedId?: string | null;
  onSelect: (envelope: EnvelopeOption) => void;
  onClose: () => void;
};

export function EnvelopePickerSheet({
  visible,
  envelopes,
  selectedId,
  onSelect,
  onClose,
}: EnvelopePickerSheetProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  // Read-only: derives the saved balance for persistent envelopes from the
  // contribution ledger. Fetched here (rather than threaded through as a
  // prop) so every caller of this shared sheet gets the fix regardless of
  // whether it has been updated to pass one.
  const { savedCentsByEnvelopeId } = usePersistentEnvelopeSavings(householdId);
  const visibleEnvelopes = useMemo(() => dedupeByTypeAndName(envelopes), [envelopes]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={styles.containerFlex}>
        <Pressable
          style={[styles.backdrop, StyleSheet.absoluteFill]}
          onPress={onClose}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Close envelope picker"
          testID="envelope-picker-backdrop"
        />
        <Surface style={[styles.sheet, { backgroundColor: colors.surface }]} elevation={4}>
          <View style={[styles.handle, { backgroundColor: colors.outline }]} />
          <Text variant="titleMedium" style={[styles.title, { color: colors.onSurface }]}>
            Select Envelope
          </Text>
          <FlatList
            data={visibleEnvelopes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const balance = balanceCents(item, savedCentsByEnvelopeId);
              const isSelected = item.id === selectedId;
              return (
                <TouchableRipple
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  style={styles.item}
                  testID={`envelope-option-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                >
                  <View style={styles.itemInner}>
                    <Text
                      variant="bodyLarge"
                      style={
                        isSelected
                          ? [styles.itemSelected, { color: colors.primary }]
                          : [styles.itemText, { color: colors.onSurface }]
                      }
                    >
                      {item.name}
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{
                        color: balance < 0 ? colors.error : colors.onSurfaceVariant,
                      }}
                      testID={`envelope-balance-${item.id}`}
                    >
                      {formatBalance(item, savedCentsByEnvelopeId)}
                    </Text>
                  </View>
                </TouchableRipple>
              );
            }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  No envelopes for this period. Add envelopes first.
                </Text>
              </View>
            }
          />
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  containerFlex: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  item: { paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  itemInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemText: {},
  itemSelected: { fontWeight: 'bold' },
  center: { padding: spacing.base, alignItems: 'center' },
});

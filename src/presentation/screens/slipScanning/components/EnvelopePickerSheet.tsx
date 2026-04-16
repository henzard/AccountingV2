import React from 'react';
import { View, StyleSheet, Modal, FlatList, TouchableOpacity } from 'react-native';
import { Text, TouchableRipple, Surface } from 'react-native-paper';
import { spacing, radius } from '../../../theme/tokens';
import { useAppTheme } from '../../../theme/useAppTheme';
import type { EnvelopeType } from '../../../../domain/envelopes/EnvelopeEntity';

export interface EnvelopeOption {
  id: string;
  name: string;
  allocatedCents: number;
  spentCents: number;
  envelopeType: EnvelopeType;
}

function formatBalance(env: EnvelopeOption): string {
  const balance = env.allocatedCents - env.spentCents;
  const rands = Math.abs(balance) / 100;
  const sign = balance < 0 ? '-R' : 'R';
  return `${sign}${rands.toFixed(2)}`;
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <TouchableOpacity
        style={styles.backdrop}
        onPress={onClose}
        activeOpacity={1}
        accessibilityLabel="Close envelope picker"
        accessibilityRole="button"
        testID="envelope-picker-backdrop"
      >
        <Surface style={[styles.sheet, { backgroundColor: colors.surface }]} elevation={4}>
          <View style={[styles.handle, { backgroundColor: colors.outline }]} />
          <Text variant="titleMedium" style={[styles.title, { color: colors.onSurface }]}>
            Select Envelope
          </Text>
          <FlatList
            data={envelopes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const balance = item.allocatedCents - item.spentCents;
              const isSelected = item.id === selectedId;
              return (
                <TouchableRipple
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  style={styles.item}
                  testID={`envelope-option-${item.id}`}
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
                      {formatBalance(item)} left
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
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
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

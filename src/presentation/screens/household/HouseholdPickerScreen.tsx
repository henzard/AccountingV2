import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Surface, TouchableRipple, FAB, Button } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppStore } from '../../stores/appStore';
import { colours, spacing, radius } from '../../theme/tokens';
import type { HouseholdPickerScreenProps } from '../../navigation/types';
import type { HouseholdSummary } from '../../../domain/households/EnsureHouseholdUseCase';

export const HouseholdPickerScreen: React.FC<HouseholdPickerScreenProps> = ({ navigation }) => {
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);

  const handleSelect = (hh: HouseholdSummary): void => {
    setHouseholdId(hh.id);
    setPaydayDay(hh.paydayDay);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const renderItem = ({ item }: { item: HouseholdSummary }): React.JSX.Element => (
    <TouchableRipple onPress={() => handleSelect(item)} rippleColor={colours.primaryContainer}>
      <Surface style={styles.row} elevation={1}>
        <View style={styles.rowLeft}>
          <Text variant="titleSmall" style={styles.name}>{item.name}</Text>
          <Text variant="bodySmall" style={styles.sub}>Payday: day {item.paydayDay}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colours.onSurfaceVariant} />
      </Surface>
    </TouchableRipple>
  );

  return (
    <View style={styles.flex}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="labelMedium" style={styles.headerLabel}>YOUR HOUSEHOLDS</Text>
        <Text variant="bodySmall" style={styles.headerSub}>Select a household to manage</Text>
      </Surface>

      <FlatList
        data={availableHouseholds}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <View style={styles.footer}>
            <Button
              mode="outlined"
              icon="plus"
              onPress={() => navigation.navigate('CreateHousehold')}
              style={styles.footerBtn}
            >
              Create New Household
            </Button>
            <Button
              mode="text"
              icon="account-plus-outline"
              onPress={() => navigation.navigate('JoinHousehold')}
              style={styles.footerBtn}
            >
              Join with Invite Code
            </Button>
          </View>
        }
      />

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => navigation.navigate('CreateHousehold')}
        color={colours.onPrimary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
    backgroundColor: colours.surface,
  },
  headerLabel: { color: colours.onSurfaceVariant, letterSpacing: 1.5 },
  headerSub: { color: colours.onSurfaceVariant, marginTop: spacing.xs },
  list: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
    backgroundColor: colours.surface,
  },
  rowLeft: { flex: 1 },
  name: { color: colours.onSurface, fontFamily: 'PlusJakartaSans_600SemiBold' },
  sub: { color: colours.onSurfaceVariant, marginTop: 2 },
  footer: { padding: spacing.base, gap: spacing.sm },
  footerBtn: { marginTop: spacing.xs },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl, backgroundColor: colours.primary },
});

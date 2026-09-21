import React, { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { Text, Surface, TouchableRipple, FAB, Button } from 'react-native-paper';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../../data/local/db';
import { householdMembers } from '../../../data/local/schema';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { useCelebrationStore } from '../../stores/celebrationStore';
import { useSyncStore } from '../../stores/syncStore';
import { useSlipScannerStore } from '../../stores/slipScannerStore';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import type { HouseholdPickerScreenProps } from '../../navigation/types';
import type { HouseholdSummary } from '../../../domain/households/EnsureHouseholdUseCase';

/**
 * HH-4: `HouseholdSummary` (what `availableHouseholds` carries) has no role
 * field — it comes from `EnsureHouseholdUseCase`/`AcceptInviteUseCase`, both
 * owned by another agent this round, and adding a field there would be a
 * shared-type change out of scope for this file. The role IS available
 * locally though: every active membership row this device holds for the
 * signed-in user is already in the synced `household_members` table
 * (id, household_id, user_id, role, deleted_at) — so it's read directly here
 * instead, scoped to `userId` and `deletedAt IS NULL` the same way
 * `EnsureHouseholdUseCase` reads active membership.
 */
export const HouseholdPickerScreen: React.FC<HouseholdPickerScreenProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const userId = useAppStore((s) => s.session?.user.id ?? null);

  const [roleByHouseholdId, setRoleByHouseholdId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!userId) {
      setRoleByHouseholdId({});
      return;
    }
    let cancelled = false;
    db.select({ householdId: householdMembers.householdId, role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, userId), isNull(householdMembers.deletedAt)))
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const row of rows) {
          next[row.householdId] = row.role;
        }
        setRoleByHouseholdId(next);
      })
      .catch(() => {
        if (!cancelled) setRoleByHouseholdId({});
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleSelect = (hh: HouseholdSummary): void => {
    // Clear household-scoped store state so stale data from the previous
    // household does not bleed into the newly selected one.
    useToastStore.getState().clear();
    useCelebrationStore.getState().clear();
    useSyncStore.getState().reset();
    useSlipScannerStore.getState().setInFlight(null);

    setHouseholdId(hh.id);
    setPaydayDay(hh.paydayDay);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  const renderItem = ({ item }: { item: HouseholdSummary }): React.JSX.Element => {
    const role = roleByHouseholdId[item.id];
    const roleLabel = role === 'owner' ? 'Owner' : role === 'member' ? 'Member' : null;

    return (
      <TouchableRipple onPress={() => handleSelect(item)} rippleColor={colors.primaryContainer}>
        <Surface
          style={[styles.row, { backgroundColor: colors.surface }]}
          elevation={1}
          testID={`household-row-${item.id}`}
        >
          <View style={styles.rowLeft}>
            <View style={styles.nameRow}>
              <Text variant="titleSmall" style={[styles.name, { color: colors.onSurface }]}>
                {item.name}
              </Text>
              {roleLabel ? (
                <View
                  style={[styles.roleBadge, { backgroundColor: colors.primaryContainer }]}
                  accessibilityLabel={`Your role: ${roleLabel}`}
                  testID={`household-role-${item.id}`}
                >
                  <Text
                    variant="labelSmall"
                    style={[styles.roleText, { color: colors.onPrimaryContainer }]}
                  >
                    {roleLabel}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text variant="bodySmall" style={[styles.sub, { color: colors.onSurfaceVariant }]}>
              Payday: day {item.paydayDay}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceVariant} />
        </Surface>
      </TouchableRipple>
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Surface style={[styles.header, { backgroundColor: colors.surface }]} elevation={0}>
        <Text
          variant="labelMedium"
          style={[styles.headerLabel, { color: colors.onSurfaceVariant }]}
        >
          YOUR HOUSEHOLDS
        </Text>
        <Text variant="bodySmall" style={[styles.headerSub, { color: colors.onSurfaceVariant }]}>
          Select a household to manage
        </Text>
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
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => navigation.navigate('CreateHousehold')}
        color={colors.onPrimary}
        accessibilityLabel="Create household"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xl,
    paddingBottom: spacing.base,
  },
  headerLabel: { letterSpacing: 1.5 },
  headerSub: { marginTop: spacing.xs },
  list: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    padding: spacing.base,
  },
  rowLeft: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  roleBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  roleText: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  sub: { marginTop: 2 },
  footer: { padding: spacing.base, gap: spacing.sm },
  footerBtn: { marginTop: spacing.xs },
  fab: {
    position: 'absolute',
    right: spacing.base,
    bottom: spacing.xl,
  },
});

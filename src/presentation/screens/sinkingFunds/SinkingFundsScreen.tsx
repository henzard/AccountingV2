import React, { useCallback } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { FAB } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { useEnvelopes } from '../../hooks/useEnvelopes';
import { useAppStore } from '../../stores/appStore';
import { BudgetPeriodEngine } from '../../../domain/shared/BudgetPeriodEngine';
import { SinkingFundCard } from '../../components/envelopes/SinkingFundCard';
import { EmptyState } from '../../components/shared/EmptyState';
import { LoadingSkeletonList } from '../../components/shared/LoadingSkeletonList';
import { ScreenHeader } from '../../components/shared/ScreenHeader';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';
import { format } from 'date-fns';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from '../../navigation/types';

export type SinkingFundsScreenProps = NativeStackScreenProps<
  DashboardStackParamList,
  'SinkingFunds'
>;

const engine = new BudgetPeriodEngine();

export function SinkingFundsScreen({ navigation }: SinkingFundsScreenProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = useAppStore((s) => s.householdId) ?? '';
  const paydayDay = useAppStore((s) => s.paydayDay);
  const periodStart = format(engine.getCurrentPeriod(paydayDay).startDate, 'yyyy-MM-dd');

  const { envelopes, loading, reload } = useEnvelopes(householdId, periodStart);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const funds = envelopes.filter((e) => e.envelopeType === 'sinking_fund');

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScreenHeader eyebrow="Savings goals" title="Sinking Funds" />

      {loading ? (
        <LoadingSkeletonList count={3} testID="sinking-funds-loading" />
      ) : funds.length === 0 ? (
        <EmptyState
          title="No sinking funds yet"
          body="Create a goal to save toward a specific target — car service, school fees, holiday."
          testID="sinking-funds-empty"
        />
      ) : (
        <FlatList
          data={funds}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SinkingFundCard
              envelope={item}
              onPress={() => navigation.navigate('AddEditEnvelope', { envelopeId: item.id })}
              testID={`sinking-fund-card-${item.id}`}
            />
          )}
          contentContainerStyle={styles.list}
          testID="sinking-funds-list"
        />
      )}

      <FAB
        icon="plus"
        label="New goal"
        style={[styles.fab, { backgroundColor: colors.primary }]}
        color={colors.onPrimary}
        onPress={() => navigation.navigate('AddEditEnvelope', { preselectedType: 'sinking_fund' })}
        testID="new-sinking-fund-fab"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: spacing.base, paddingBottom: spacing.xl + 56 + spacing.md },
  fab: { position: 'absolute', right: spacing.base, bottom: spacing.xl },
});

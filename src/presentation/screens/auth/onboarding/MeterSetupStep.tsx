import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, List, Switch } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppTheme } from '../../../theme/useAppTheme';
import { radius, spacing } from '../../../theme/tokens';
import type { OnboardingStackParamList } from './OnboardingNavigator';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'MeterSetup'>;

// This step used to seed a `reading_value: 0` "Opening baseline" meter_readings
// row per enabled meter, dated today. That was a genuine double defect (audit
// 2026-07-05, M9 + L4):
//   - M9: meter readings are CUMULATIVE absolute values, not deltas — so
//     UnitRateCalculator diffed the user's first REAL reading against 0,
//     making the whole meter face value read as one period's consumption
//     (e.g. a 45230 kWh reading looked like 45230 kWh used, at ~2c/kWh
//     instead of the real ~R2.50/kWh).
//   - L4: the baseline was dated TODAY, so LogMeterReadingUseCase's
//     DUPLICATE_READING guard (same householdId/meterType/readingDate)
//     blocked the user from logging their real first reading the same day.
// Fix: don't seed a fake baseline at all. The user's first real reading
// (via AddReadingScreen -> LogMeterReadingUseCase) simply becomes the
// baseline — MeterReadingCard/RateHistoryScreen already handle "only one
// reading exists yet" by showing no consumption/rate until a second reading
// exists, which is the correct behavior for a brand-new meter anyway. This
// screen is now purely a UI preview of which meters the user intends to
// track; nothing is persisted until the user logs a real reading.
export function MeterSetupStep(): React.JSX.Element {
  const { colors } = useAppTheme();
  const navigation = useNavigation<Nav>();

  const [electricity, setElectricity] = useState(false);
  const [water, setWater] = useState(false);
  const [odometer, setOdometer] = useState(false);

  const handleNext = (): void => {
    navigation.navigate('ScoreIntro');
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text variant="headlineMedium" style={[styles.title, { color: colors.primary }]}>
        Track your meters?
      </Text>
      <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
        Enable meter tracking to log electricity, water, or vehicle usage. You can change this
        later.
      </Text>

      <View style={[styles.switchList, { backgroundColor: colors.surface }]}>
        <List.Item
          title="Electricity"
          description="Track kWh usage"
          left={(props) => <List.Icon {...props} icon="lightning-bolt" />}
          right={() => (
            <Switch
              value={electricity}
              onValueChange={setElectricity}
              testID="switch-electricity"
            />
          )}
        />
        <List.Item
          title="Water"
          description="Track kL usage"
          left={(props) => <List.Icon {...props} icon="water" />}
          right={() => <Switch value={water} onValueChange={setWater} testID="switch-water" />}
        />
        <List.Item
          title="Odometer"
          description="Track vehicle km"
          left={(props) => <List.Icon {...props} icon="car" />}
          right={() => (
            <Switch value={odometer} onValueChange={setOdometer} testID="switch-odometer" />
          )}
        />
      </View>

      <Button
        mode="contained"
        onPress={handleNext}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        {electricity || water || odometer ? 'Next' : 'Skip'}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.xl },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    marginBottom: spacing.sm,
  },
  subtitle: { marginBottom: spacing.lg },
  switchList: {
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  button: { marginTop: spacing.lg },
  buttonContent: { paddingVertical: spacing.xs },
});

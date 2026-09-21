import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Button } from 'react-native-paper';
import { db } from '../../../data/local/db';
import { supabase } from '../../../data/remote/supabaseClient';
import { RestoreService } from '../../../data/sync/RestoreService';
import { hydrateHousehold } from '../../../domain/households/hydrateHousehold';
import { markOnboardingComplete } from '../../../infrastructure/storage/onboardingFlag';
import { usePendingJoinStore } from '../../boot/pendingJoinStore';
import { useAppStore } from '../../stores/appStore';
import { spacing } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

const restoreService = new RestoreService(db, supabase);

/**
 * FinishJoinScreen — F1 (round 6) app-start recovery.
 *
 * Shown instead of the create/join choice screen when
 * `EnsureHouseholdUseCase` reported `household_not_downloaded`: the user
 * force-quit after a join that succeeded SERVER-side but never finished
 * downloading the household. It finishes exactly that download (the same
 * `hydrateHousehold` the join itself uses) and then lets boot continue as a
 * normal member boot — the store updates here are the same three
 * JoinHouseholdScreen performs on a successful join.
 *
 * The create/join gate is deliberately unreachable from here: "Create
 * Household" would mint a second household for someone who is already a
 * member. The only ways out are a user-driven retry and signing out — there
 * is no automatic retry loop and no timer.
 */
export function FinishJoinScreen(): React.JSX.Element {
  const { colors } = useAppTheme();
  const householdId = usePendingJoinStore((s) => s.pendingJoinHouseholdId);
  const setPendingJoinHouseholdId = usePendingJoinStore((s) => s.setPendingJoinHouseholdId);
  const session = useAppStore((s) => s.session);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);

  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const userId = session?.user?.id ?? null;

  const finish = useCallback(async (): Promise<void> => {
    if (!householdId || !userId) return;
    setError(null);

    const result = await hydrateHousehold({
      supabase,
      db,
      restoreService,
      householdId,
      userId,
    }).catch(() => null);

    if (!mountedRef.current) return;

    if (!result || !result.success) {
      setError(
        result?.success === false
          ? result.error.message
          : "You've joined — we couldn't download the household yet. Check your connection and tap Try again.",
      );
      return;
    }

    // Joiners inherit the household's existing config — skip the budget-setup
    // wizard, exactly as JoinHouseholdScreen does after a first-time join.
    await markOnboardingComplete(userId, result.data.id).catch(() => {});

    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
    setAvailableHouseholds([result.data]);
    setOnboardingCompleted(true);
    // Last: clearing this unmounts THIS screen, and householdId is already
    // set so the navigator lands on the normal member boot, not the gate.
    setPendingJoinHouseholdId(null);
  }, [
    householdId,
    userId,
    setHouseholdId,
    setPaydayDay,
    setAvailableHouseholds,
    setOnboardingCompleted,
    setPendingJoinHouseholdId,
  ]);

  useEffect(() => {
    void finish();
  }, [finish]);

  const handleSignOut = (): void => {
    setPendingJoinHouseholdId(null);
    void supabase.auth.signOut();
  };

  if (error === null) {
    return (
      <SafeAreaView
        style={[styles.centered, { backgroundColor: colors.surface }]}
        testID="finish-join-working"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="bodyMedium" style={[styles.status, { color: colors.onSurfaceVariant }]}>
          Finishing your join…
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={styles.content}>
        <Text variant="titleMedium" style={{ color: colors.onSurface }}>
          Almost there
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.status, { color: colors.error }]}
          testID="finish-join-error"
        >
          {error}
        </Text>
        <Button
          mode="contained"
          onPress={() => void finish()}
          style={styles.button}
          testID="finish-join-retry-btn"
        >
          Try again
        </Button>
        <Button
          mode="outlined"
          onPress={handleSignOut}
          style={styles.button}
          testID="finish-join-sign-out-btn"
        >
          Sign out
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  status: { marginTop: spacing.base },
  button: { marginTop: spacing.sm },
});

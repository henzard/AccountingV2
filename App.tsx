import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useDatabaseMigrations } from './src/data/local/db';
import { useFonts } from './src/presentation/theme/useFonts';
import { appTheme } from './src/presentation/theme/theme';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { colours } from './src/presentation/theme/tokens';
import { supabase } from './src/data/remote/supabaseClient';
import { useAppStore } from './src/presentation/stores/appStore';
import { db } from './src/data/local/db';
import { AuditLogger } from './src/data/audit/AuditLogger';
import { EnsureHouseholdUseCase } from './src/domain/households/EnsureHouseholdUseCase';
import type { HouseholdSummary } from './src/domain/households/EnsureHouseholdUseCase';
import { RestoreService } from './src/data/sync/RestoreService';
import type { RestoredHousehold } from './src/data/sync/RestoreService';
import { SyncOrchestrator } from './src/data/sync/SyncOrchestrator';
import { SeedBabyStepsUseCase } from './src/domain/babySteps/SeedBabyStepsUseCase';
import { babySteps as babyStepsTable } from './src/data/local/schema';
import { and, eq } from 'drizzle-orm';
import { useCelebrationStore } from './src/presentation/stores/celebrationStore';
import { useEmergencyFundReconcileStore } from './src/presentation/stores/emergencyFundReconcileStore';

const audit = new AuditLogger(db);
const restoreService = new RestoreService(db, supabase);
const syncOrchestrator = new SyncOrchestrator(db, supabase);

async function initSession(
  userId: string,
  setHouseholdId: (id: string) => void,
  setPaydayDay: (day: number) => void,
  setAvailableHouseholds: (h: HouseholdSummary[]) => void,
): Promise<void> {
  // 1. Restore from Supabase (no-op if offline)
  let restoredHouseholds: RestoredHousehold[] = [];
  try {
    restoredHouseholds = await restoreService.restore(userId);
  } catch {
    // Offline or network error — continue with local data
  }

  // 2. Seed all restored households first (before primary ensure, so gaps are backfilled even
  //    if EnsureHouseholdUseCase fails for the current user's household).
  const seeder = new SeedBabyStepsUseCase(db);
  for (const restored of restoredHouseholds) {
    void seeder.execute(restored.id).catch(() => {
      // Non-fatal: seed failures don't block startup
    });
  }

  // 3. Ensure household exists locally for the current user (seeds baby steps internally)
  const uc = new EnsureHouseholdUseCase(db, audit, userId);
  const result = await uc.execute();
  if (result.success) {
    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
    setAvailableHouseholds([result.data, ...restoredHouseholds
      .filter(h => h.id !== result.data.id)
      .map(h => ({ ...h, userLevel: 1 as const }))]);
  } else {
    console.error('[initSession] Failed to ensure household:', result.error);
  }

  // 4. Push any pending local writes to Supabase (fire and forget).
  //    Pass householdId so the post-sync ReconcileEmergencyFundTypeUseCase fixer can run.
  const resolvedHouseholdId = result.success ? result.data.id : undefined;
  void syncOrchestrator.syncPending(resolvedHouseholdId).then((syncResult) => {
    if (syncResult.emfFlipped > 0) {
      // Presentation-layer flag: show duplicate-EMF banner on Budget screen
      useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
    }
  }).catch(() => {
    // Sync failure is non-fatal
  });
}

export default function App(): React.JSX.Element {
  const { fontsLoaded, fontError } = useFonts();
  const { success: dbReady, error: dbError } = useDatabaseMigrations();
  const setSession = useAppStore((s) => s.setSession);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const clearHousehold = useAppStore((s) => s.clearHousehold);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const [sessionRestored, setSessionRestored] = useState(false);

  // Init celebrationStore checker — reads celebrated_at from local DB.
  // Re-bound after every auth/household change so the checker always uses the
  // current householdId rather than a stale closure over the initial render.
  const initCelebrationStore = useCelebrationStore((s) => s.init);

  const bindCelebrationStore = useCallback(() => {
    initCelebrationStore(async (stepNumber: number) => {
      // Read householdId at call time, not at bind time.
      const householdId = useAppStore.getState().householdId;
      if (!householdId) return false;
      const rows = await db
        .select()
        .from(babyStepsTable)
        .where(
          and(
            eq(babyStepsTable.householdId, householdId),
            eq(babyStepsTable.stepNumber, stepNumber),
          ),
        )
        .limit(1);
      return rows[0]?.celebratedAt != null;
    });
  }, [initCelebrationStore]);

  useEffect(() => {
    // Bind once on mount (covers cold-start with existing session).
    bindCelebrationStore();
  }, [bindCelebrationStore]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session ?? null;
      setSession(session);
      if (session) {
        await initSession(session.user.id, setHouseholdId, setPaydayDay, setAvailableHouseholds);
        // Re-bind after household is resolved so checker uses the new householdId.
        bindCelebrationStore();
      }
      setSessionRestored(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session ?? null);
      if (session) {
        await initSession(session.user.id, setHouseholdId, setPaydayDay, setAvailableHouseholds);
        // Re-bind after household change (e.g. sign-out → sign-in as different household).
        bindCelebrationStore();
      } else {
        clearHousehold();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession, setHouseholdId, setPaydayDay, clearHousehold, setAvailableHouseholds, bindCelebrationStore]);

  if (fontError || dbError) {
    return (
      <View style={styles.center}>
        <Text>Error: {(fontError ?? dbError)?.message}</Text>
      </View>
    );
  }

  if (!fontsLoaded || !dbReady || !sessionRestored) {
    return <View style={styles.center} />;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface },
});

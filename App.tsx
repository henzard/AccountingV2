// ─── Early-boot crash capture ─────────────────────────────────────────────────
// MUST be the first executable line — before any import that could throw.
// installEarlyCrashHandler() is synchronous; the actual import below runs
// module evaluation which is itself inside the try-catch in index.ts (see note
// at bottom of file). We also wire handlers here so any subsequent import
// errors or render crashes are captured.
import {
  installEarlyCrashHandler,
  captureBoot,
} from './src/infrastructure/monitoring/earlyCrashLog';
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useDatabaseMigrations } from './src/data/local/db';
import { useFonts } from './src/presentation/theme/useFonts';
import { useAppTheme } from './src/presentation/theme/useAppTheme';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { colours } from './src/presentation/theme/tokens';
import { supabase } from './src/data/remote/supabaseClient';
import { useAppStore } from './src/presentation/stores/appStore';
import { db } from './src/data/local/db';
import { AuditLogger } from './src/data/audit/AuditLogger';
import { EnsureHouseholdUseCase } from './src/domain/households/EnsureHouseholdUseCase';
import { RestoreService } from './src/data/sync/RestoreService';
import type { RestoredHousehold } from './src/data/sync/RestoreService';
import { SyncOrchestrator } from './src/data/sync/SyncOrchestrator';
import { SeedBabyStepsUseCase } from './src/domain/babySteps/SeedBabyStepsUseCase';
import { babySteps as babyStepsTable } from './src/data/local/schema';
import { and, eq } from 'drizzle-orm';
import { useCelebrationStore } from './src/presentation/stores/celebrationStore';
import { useEmergencyFundReconcileStore } from './src/presentation/stores/emergencyFundReconcileStore';
import { initCrashlytics } from './src/infrastructure/monitoring/crashlytics';
import crashlytics from '@react-native-firebase/crashlytics';
import { subscribeNetworkStore } from './src/presentation/stores/networkStore';
import { DrizzleSlipQueueRepository } from './src/data/repositories/DrizzleSlipQueueRepository';
import { SlipImageLocalStore } from './src/infrastructure/slipScanning/SlipImageLocalStore';
import { CleanupExpiredSlipsUseCase } from './src/domain/slipScanning/CleanupExpiredSlipsUseCase';
import { BootRecoveryGate } from './src/presentation/boot/BootRecoveryGate';
import { BootErrorBoundary } from './src/presentation/boot/BootErrorBoundary';
import {
  hydrateThemeFromLocal,
  hydrateThemeFromRemote,
} from './src/presentation/stores/themeStore';

// Install global crash handler as early as possible (after imports — module
// evaluation order still puts this before any App code runs).
installEarlyCrashHandler();

// Hydrate theme from local storage before first render (async but fast).
// The themeStore starts in 'system' so worst-case users see OS theme for one frame.
void hydrateThemeFromLocal();

// ─── Enable Crashlytics collection at module load ─────────────────────────────
// Wrapped in try/catch because the native module may not be registered yet on
// some boot paths; we must never let this kill the app before the error
// boundaries mount.
try {
  crashlytics()
    .setCrashlyticsCollectionEnabled(!__DEV__)
    .catch((err) => {
      captureBoot('crashlytics.setEnabled (async)', err);
    });
} catch (err) {
  captureBoot('crashlytics.setEnabled (sync)', err);
}
// ─────────────────────────────────────────────────────────────────────────────

let audit: AuditLogger;
let restoreService: RestoreService;
let syncOrchestrator: SyncOrchestrator;
let slipQueueRepo: DrizzleSlipQueueRepository;
let slipLocalStore: SlipImageLocalStore;
let cleanupSlips: CleanupExpiredSlipsUseCase;
try {
  audit = new AuditLogger(db);
  restoreService = new RestoreService(db, supabase);
  syncOrchestrator = new SyncOrchestrator(db, supabase);
  slipQueueRepo = new DrizzleSlipQueueRepository(db);
  slipLocalStore = new SlipImageLocalStore();
  cleanupSlips = new CleanupExpiredSlipsUseCase(slipQueueRepo, slipLocalStore);
} catch (err) {
  captureBoot('App.tsx module-scope singletons', err);
  throw err;
}

async function initSession(userId: string): Promise<void> {
  // C5: Run EnsureHousehold (local DB) + restore (remote) in parallel.
  // Restore is network-dependent — it must not block local household resolution.
  const restorePromise = restoreService.restore(userId).catch((): RestoredHousehold[] => []);
  const uc = new EnsureHouseholdUseCase(db, audit, userId);
  const [restoredHouseholds, result] = await Promise.all([restorePromise, uc.execute()]);

  const store = useAppStore.getState();
  if (result.success) {
    store.setHouseholdId(result.data.id);
    store.setPaydayDay(result.data.paydayDay);
    store.setAvailableHouseholds([
      result.data,
      ...restoredHouseholds
        .filter((h) => h.id !== result.data.id)
        .map((h) => ({ ...h, userLevel: 1 as const })),
    ]);
  } else {
    console.error('[initSession] Failed to ensure household:', result.error);
  }

  // Seed restored households (fire-and-forget — non-fatal).
  const seeder = new SeedBabyStepsUseCase(db);
  for (const restored of restoredHouseholds) {
    void seeder.execute(restored.id).catch(() => {});
  }

  // C5: Push pending writes to Supabase (fire-and-forget after navigator mounts).
  const resolvedHouseholdId = result.success ? result.data.id : undefined;
  void syncOrchestrator
    .syncPending(resolvedHouseholdId)
    .then((syncResult) => {
      if (syncResult.emfFlipped > 0) {
        useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
      }
    })
    .catch(() => {
      // Sync failure is non-fatal
    });
}

export default function App(): React.JSX.Element {
  const appTheme = useAppTheme();
  const { fontsLoaded, fontError } = useFonts();
  const { success: dbReady, error: dbError } = useDatabaseMigrations();
  const setSession = useAppStore((s) => s.setSession);
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
    // Subscribe NetworkObserver → networkStore (drives OfflineBanner).
    const unsubscribeNetwork = subscribeNetworkStore();

    // Cleanup expired slip images (fire-and-forget — non-fatal).
    void cleanupSlips.execute().catch(() => {});

    // Auto-flip processing slips older than 1 hour to failed (stale on restart).
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    void slipQueueRepo
      .listProcessingOlderThan(oneHourAgo)
      .then((stale) =>
        Promise.allSettled(
          stale.map((slip) => slipQueueRepo.update(slip.id, { status: 'failed' })),
        ),
      )
      .catch(() => {});

    return unsubscribeNetwork;
  }, [bindCelebrationStore]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session ?? null;
      setSession(session);
      if (session?.user?.id) {
        void hydrateThemeFromRemote(session.user.id);
      }
      initCrashlytics(session?.user?.id ?? null).catch((err) =>
        console.warn('[crashlytics] init failed', err),
      );
      if (session) {
        try {
          await initSession(session.user.id);
        } catch (err) {
          captureBoot('initSession (cold start)', err);
          throw err;
        }
        bindCelebrationStore();
      }
      setSessionRestored(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session ?? null);
      if (session?.user?.id) {
        void hydrateThemeFromRemote(session.user.id);
      }
      if (session) {
        await initSession(session.user.id);
        bindCelebrationStore();
      } else {
        useAppStore.getState().reset();
        crashlytics()
          .setUserId('')
          .catch(() => {});
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession, bindCelebrationStore]);

  if (fontError || dbError) {
    // Record font/DB init errors — these surface before Crashlytics is ready.
    captureBoot('App render — font/db init', fontError ?? dbError);
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
        <BootRecoveryGate>
          <BootErrorBoundary>
            <RootNavigator />
          </BootErrorBoundary>
        </BootRecoveryGate>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colours.surface,
  },
});

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
import * as SplashScreen from 'expo-splash-screen';
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useDatabaseMigrations } from './src/data/local/db';
import { useFonts } from './src/presentation/theme/useFonts';
import { useAppTheme } from './src/presentation/theme/useAppTheme';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { supabase } from './src/data/remote/supabaseClient';
import { useAppStore } from './src/presentation/stores/appStore';
import { db } from './src/data/local/db';
import { EnsureHouseholdUseCase } from './src/domain/households/EnsureHouseholdUseCase';
import { RestoreService } from './src/data/sync/RestoreService';
import type { RestoredHousehold } from './src/data/sync/RestoreService';
import { SeedBabyStepsUseCase } from './src/domain/babySteps/SeedBabyStepsUseCase';
import { ReconcileEmergencyFundTypeUseCase } from './src/domain/babySteps/ReconcileEmergencyFundTypeUseCase';
import { useEmergencyFundReconcileStore } from './src/presentation/stores/emergencyFundReconcileStore';
import { babySteps as babyStepsTable } from './src/data/local/schema';
import { and, eq } from 'drizzle-orm';
import { useCelebrationStore } from './src/presentation/stores/celebrationStore';
import { useToastStore } from './src/presentation/stores/toastStore';
import { initCrashlytics } from './src/infrastructure/monitoring/crashlytics';
import crashlytics from '@react-native-firebase/crashlytics';
import {
  subscribeNetworkChanges,
  useSyncStore,
  syncStoreStatusSink,
} from './src/presentation/stores/syncStore';
import { useSyncEngineStore } from './src/presentation/stores/syncEngineStore';
import { networkObserver } from './src/infrastructure/network/NetworkObserver';
import { createSyncEngine, type SyncEngine } from './src/data/sync/SyncEngine';
import { SyncScheduler } from './src/data/sync/SyncScheduler';
import { getDeviceId } from './src/infrastructure/device/deviceId';
import { DrizzleSlipQueueRepository } from './src/data/repositories/DrizzleSlipQueueRepository';
import { SlipImageLocalStore } from './src/infrastructure/slipScanning/SlipImageLocalStore';
import { CleanupExpiredSlipsUseCase } from './src/domain/slipScanning/CleanupExpiredSlipsUseCase';
import { BootRecoveryGate } from './src/presentation/boot/BootRecoveryGate';
import { BootErrorBoundary } from './src/presentation/boot/BootErrorBoundary';
import { registerFcmToken } from './src/infrastructure/notifications/FcmTokenRegistrar';
import {
  hydrateThemeFromLocal,
  hydrateThemeFromRemote,
  resetThemeStore,
} from './src/presentation/stores/themeStore';
import { parseRecoveryDeepLink } from './src/infrastructure/auth/parseRecoveryDeepLink';
import { addUrlListener, getInitialURL } from './src/infrastructure/device/appLinking';

// Install global crash handler as early as possible (after imports — module
// evaluation order still puts this before any App code runs).
installEarlyCrashHandler();

// Keep the native splash screen up through LOCAL init only (Task 5 boot
// rework). Failing to call this is non-fatal (splash just autohides on its
// own timer), so this is fire-and-forget — never let it block/throw.
SplashScreen.preventAutoHideAsync().catch(() => {});

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

// NOTE ON THE SLICE-5 CUTOVER (Tasks 5-6):
//
// Task 5 cut boot over to the production `SyncEngine` + `SyncScheduler`
// (Tasks 3-4), which own push/pull from here on, wired via
// `ensureSyncRuntime()` below and started only after the navigator has
// mounted (never before first paint, never network-gating it). Task 6
// deleted the OLD `SyncOrchestrator` (pending_sync push/pull),
// `PendingSyncEnqueuer`/`PendingSyncTable`, and the `pending_sync` table
// itself — nothing in this file ever referenced them directly.
//
// `RestoreService` is KEPT (verified — see `.superpowers/sdd/task-6-report.md`
// for the full trace) and still invoked below (`initSessionRemote`) so a
// reinstall on a new device — local SQLite empty, but Supabase still has
// this user's household memberships — keeps discovering + backfilling them,
// which the new engine's per-household `sync_pull` can't do on its own yet
// (it needs to already know a householdId; there's no "list my households"
// pull in this slice). Left as a documented follow-up for a future
// SyncEngine-native discovery pull. The important part: it is 100%
// non-blocking — a hung/offline restore can never delay first paint.
//
// `ReconcileEmergencyFundTypeUseCase`/`emergencyFundReconcileStore`/
// `DuplicateEmfBanner` are also KEPT (same report) — persistent EMF scope
// (slice 3) never touched the create-time duplicate-EMF race this backstop
// exists for, and the slice-4 create-time guard only closes the SAME-DEVICE
// half of it (see `supabase migration 0013_emf_unique.sql`'s own scope
// note). Task 5's cutover, however, silently dropped the only call site that
// ever fired it (the old `syncOrchestrator.syncPending().then(...)` chain
// this file used to have) without replacing it — Task 6 re-wires it below
// via `SyncScheduler`'s generic `onSyncSuccess` hook so the backstop keeps
// working instead of shipping present-but-unreachable.
let restoreService: RestoreService;
let slipQueueRepo: DrizzleSlipQueueRepository;
let slipLocalStore: SlipImageLocalStore;
let cleanupSlips: CleanupExpiredSlipsUseCase;
try {
  restoreService = new RestoreService(db, supabase);
  slipQueueRepo = new DrizzleSlipQueueRepository(db);
  slipLocalStore = new SlipImageLocalStore();
  cleanupSlips = new CleanupExpiredSlipsUseCase(slipQueueRepo, slipLocalStore);
} catch (err) {
  captureBoot('App.tsx module-scope singletons', err);
  throw err;
}

// ─── SyncEngine + SyncScheduler singleton (Task 5 cutover) ────────────────────
//
// Construction is async (device id resolution reads AsyncStorage) so it can't
// be a plain module-scope value like the singletons above. `ensureSyncRuntime`
// builds it exactly once (idempotent — concurrent/repeat calls await the SAME
// promise) and publishes it to `useSyncEngineStore` so the Sync Health screen
// (Settings) can reach the SAME instance App.tsx started, without a circular
// import of this file.
let syncEngineSingleton: SyncEngine | null = null;
let syncSchedulerSingleton: SyncScheduler | null = null;
let syncRuntimeInitPromise: Promise<{ engine: SyncEngine; scheduler: SyncScheduler }> | null = null;

function ensureSyncRuntime(): Promise<{ engine: SyncEngine; scheduler: SyncScheduler }> {
  if (syncEngineSingleton && syncSchedulerSingleton) {
    return Promise.resolve({ engine: syncEngineSingleton, scheduler: syncSchedulerSingleton });
  }
  if (!syncRuntimeInitPromise) {
    syncRuntimeInitPromise = (async () => {
      const deviceId = await getDeviceId();
      const engine = createSyncEngine({ supabase, db, deviceId });
      const scheduler = new SyncScheduler({
        engine,
        supabase,
        networkObserver,
        statusSink: syncStoreStatusSink,
        // Duplicate-EMF reconcile backstop (Task 6) — see the module-doc note
        // above. Best-effort: runs after every sync round that didn't throw,
        // not gated on a perfectly clean {failed: 0} batch like the old
        // SyncOrchestrator-driven trigger was, so a still-in-DLQ op elsewhere
        // just means this keeps retrying on the next successful round rather
        // than silently never running. Never throws — SyncScheduler already
        // logs-and-swallows hook failures.
        onSyncSuccess: async (syncedHouseholdId) => {
          const result = await new ReconcileEmergencyFundTypeUseCase(db).execute(syncedHouseholdId);
          if (result.success && result.data.flipped > 0) {
            useEmergencyFundReconcileStore.getState().setReconciledDuplicateEmf(true);
          }
        },
      });
      syncEngineSingleton = engine;
      syncSchedulerSingleton = scheduler;
      useSyncEngineStore.getState().setSyncRuntime(engine, scheduler);
      return { engine, scheduler };
    })().catch((err) => {
      // Reset so a future call can retry instead of being stuck on a
      // rejected promise forever (e.g. getDeviceId's AsyncStorage hiccuped).
      syncRuntimeInitPromise = null;
      throw err;
    });
  }
  return syncRuntimeInitPromise;
}

// ─── initSession: LOCAL (awaited, gates first paint) + REMOTE (background) ──
//
// Deep-review findings this fixes:
//  - "cold start blocks on network": the OLD initSession ran RestoreService
//    (network) and EnsureHouseholdUseCase (local) in Promise.all and awaited
//    BOTH before the caller could proceed — a hung/offline restore blocked
//    first paint even though its own rejection was caught. Local household
//    resolution (below) is now awaited alone; everything network-dependent
//    is fire-and-forget and NEVER on the boot gate's critical path.
//  - "initSession runs twice / on every token refresh": see `initSessionOnce`
//    and the auth listener's SIGNED_IN-only filter, below.

/** LOCAL ONLY — reads/writes local SQLite exclusively (EnsureHouseholdUseCase
 * never touches the network). Safe to await on the boot gate. */
async function initSessionLocal(userId: string): Promise<void> {
  const uc = new EnsureHouseholdUseCase(db, userId);
  const result = await uc.execute();
  const store = useAppStore.getState();
  if (result.success) {
    store.setHouseholdId(result.data.id);
    store.setPaydayDay(result.data.paydayDay);
    store.setAvailableHouseholds([result.data]);
  }
  // else: nothing resolved locally (new user, or a reinstall whose
  // memberships only exist server-side) — householdId stays null;
  // RootNavigator shows the create/join choice screen until
  // `initSessionRemote` (if it discovers a membership) or the user acts.
}

/** NETWORK — household restore/backfill + best-effort seeding/FCM
 * registration. Always fire-and-forget from the caller; never throws (every
 * network call here is individually caught) but is `async` so callers can
 * still `.catch()` defensively. */
async function initSessionRemote(userId: string): Promise<void> {
  const restoredHouseholds = await restoreService
    .restore(userId)
    .catch((): RestoredHousehold[] => []);

  if (restoredHouseholds.length > 0) {
    const store = useAppStore.getState();
    if (store.householdId) {
      // Local resolution already picked a primary household -- merge in any
      // additional memberships restore discovered.
      store.setAvailableHouseholds([
        ...store.availableHouseholds,
        ...restoredHouseholds
          .filter((h) => h.id !== store.householdId)
          .map((h) => ({ ...h, userLevel: 1 as const })),
      ]);
    } else {
      // Reinstall path: local DB had nothing for this user, but Supabase
      // says they belong to households -- adopt the first as primary.
      const primary = restoredHouseholds[0];
      store.setHouseholdId(primary.id);
      store.setPaydayDay(primary.paydayDay);
      store.setAvailableHouseholds(
        restoredHouseholds.map((h) => ({ ...h, userLevel: 1 as const })),
      );
    }
  }

  // Seed restored households (fire-and-forget — non-fatal).
  const seeder = new SeedBabyStepsUseCase(db);
  for (const restored of restoredHouseholds) {
    void seeder.execute(restored.id).catch(() => {});
  }

  // Register FCM token for push notifications (fire-and-forget — non-fatal).
  void registerFcmToken(userId).catch(() => {});
}

async function initSession(userId: string): Promise<void> {
  await initSessionLocal(userId);
  void initSessionRemote(userId).catch((err) => {
    captureBoot('initSessionRemote (background)', err);
  });
}

// ─── initSession double-run guard (deep-review finding) ──────────────────────
//
// Belt-and-suspenders on top of the auth listener's SIGNED_IN-only filter
// (below): tracks which userId's initSession is in flight / already
// completed for the current sign-in, so a duplicate trigger (a fast-refresh
// re-render, a race between the cold-start effect and a genuine SIGNED_IN
// event) can never re-run the whole household-resolution + restore sequence.
let initSessionInFlightUserId: string | null = null;
let initSessionCompletedUserId: string | null = null;

async function initSessionOnce(userId: string): Promise<void> {
  if (initSessionInFlightUserId === userId || initSessionCompletedUserId === userId) return;
  initSessionInFlightUserId = userId;
  try {
    await initSession(userId);
    initSessionCompletedUserId = userId;
  } finally {
    if (initSessionInFlightUserId === userId) initSessionInFlightUserId = null;
  }
}

function resetInitSessionGuard(): void {
  initSessionInFlightUserId = null;
  initSessionCompletedUserId = null;
}

function resetAllStoresOnSignOut(): void {
  useAppStore.getState().reset();
  useSyncStore.getState().reset();
  resetThemeStore();
  useToastStore.getState().clear();
  useCelebrationStore.getState().clear();
  crashlytics()
    .setUserId('')
    .catch(() => {});
  resetInitSessionGuard();
}

export default function App(): React.JSX.Element | null {
  const appTheme = useAppTheme();
  const { fontsLoaded, fontError } = useFonts();
  const { success: dbReady, error: dbError } = useDatabaseMigrations();
  const setSession = useAppStore((s) => s.setSession);
  const householdId = useAppStore((s) => s.householdId);
  // Gates first paint on LOCAL init ONLY (db + fonts + local household
  // resolution) — NEVER on RestoreService/network (Task 5: "cold start
  // blocks on network" fix). Renamed from the old `sessionRestored` to make
  // that contract explicit at the call site below.
  const [localBootReady, setLocalBootReady] = useState(false);

  // Init celebrationStore checker — reads celebrated_at from local DB.
  // Re-bound after every auth/household change so the checker always uses the
  // current householdId rather than a stale closure over the initial render.
  const initCelebrationStore = useCelebrationStore((s) => s.init);

  const bindCelebrationStore = useCallback(() => {
    initCelebrationStore(async (stepNumber: number) => {
      // Read householdId at call time, not at bind time.
      const currentHouseholdId = useAppStore.getState().householdId;
      if (!currentHouseholdId) return false;
      const rows = await db
        .select()
        .from(babyStepsTable)
        .where(
          and(
            eq(babyStepsTable.householdId, currentHouseholdId),
            eq(babyStepsTable.stepNumber, stepNumber),
          ),
        )
        .limit(1);
      return rows[0]?.celebratedAt != null;
    });
  }, [initCelebrationStore]);

  // Hide the native splash screen as soon as we've decided WHAT to render —
  // either the error view or the real (local-only-gated) app tree. Never
  // waits on network.
  const bootDecided = Boolean(fontError || dbError) || (fontsLoaded && dbReady && localBootReady);
  useEffect(() => {
    if (bootDecided) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [bootDecided]);

  useEffect(() => {
    // Bind once on mount (covers cold-start with existing session).
    bindCelebrationStore();
    // Subscribe NetworkObserver → syncStore (drives OfflineBanner).
    const unsubscribeNetwork = subscribeNetworkChanges();
    networkObserver.start();

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

    return () => {
      unsubscribeNetwork();
      networkObserver.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindCelebrationStore]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // LOCAL ONLY: `getSession()` reads the persisted session from local
      // storage (the SecureStorageAdapter) — unlike `getUser()`, it does NOT
      // round-trip to the server to validate the token, so this never blocks
      // on network. A revoked/stale session is caught later by the ordinary
      // 401 path on the first authenticated request, not here.
      const { data } = await supabase.auth.getSession();
      const session = data.session ?? null;
      if (cancelled) return;
      setSession(session);

      if (session?.user?.id) {
        void hydrateThemeFromRemote(session.user.id);
        initCrashlytics(session.user.id).catch((err) =>
          console.warn('[crashlytics] init failed', err),
        );
        try {
          await initSessionOnce(session.user.id);
        } catch (err) {
          // A local SQLite failure inside EnsureHouseholdUseCase (constraint
          // violation, null, schema mismatch, ...) must NEVER brick boot.
          // Capture it for diagnostics, then DEGRADE gracefully instead of
          // rethrowing into this un-.catch()'d async IIFE -- rethrowing would
          // skip `setLocalBootReady(true)` below and leave `bootDecided`
          // false forever, so the native splash screen (and the `return
          // null` render gate) would never resolve. `householdId` is left
          // null here, which is the SAME state EnsureHouseholdUseCase
          // returning `{ success: false }` already produces (see
          // `initSessionLocal` above) -- RootNavigator already renders the
          // create/join choice screen (`CreateHouseholdNavigator`) for an
          // authenticated user with no household, so this is a safe,
          // already-handled degrade, not a new render path.
          captureBoot('initSession (cold start, local phase)', err);
        }
        if (cancelled) return;
        bindCelebrationStore();
      } else {
        initCrashlytics(null).catch((err) => console.warn('[crashlytics] init failed', err));
      }

      if (!cancelled) setLocalBootReady(true);
    })();

    // Auth listener: filtered to SIGNED_IN only (deep-review finding —
    // INITIAL_SESSION fires once for the session the cold-start effect above
    // ALREADY handles, and TOKEN_REFRESHED/USER_UPDATED fire repeatedly for
    // the SAME session; re-running initSession on any of those double-ran
    // the household restore + a would-be sync push on every silent refresh).
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session ?? null);

      if (event === 'SIGNED_OUT' || !session) {
        resetAllStoresOnSignOut();
        return;
      }

      // Defensive branch only — added per the deep-review fix without
      // touching the SIGNED_IN-only filtering above/below. NOTE: on React
      // Native, @supabase/auth-js's automatic `PASSWORD_RECOVERY` event is
      // gated on `isBrowser()` (see GoTrueClient#_initialize) and never
      // fires here in practice — the deep-link handler below (which parses
      // `type=recovery` itself and flips `passwordRecoveryPending` directly)
      // is the mechanism that actually works on this platform. This branch
      // exists so a future SDK/platform change that DOES emit the event
      // still routes correctly, without ever falling through to
      // `initSessionOnce` for it.
      if (event === 'PASSWORD_RECOVERY') {
        useAppStore.getState().setPasswordRecoveryPending(true);
        return;
      }

      if (session.user?.id) {
        void hydrateThemeFromRemote(session.user.id);
      }

      if (event !== 'SIGNED_IN') {
        // Session object updated above; nothing else to do for a silent
        // refresh/other event — never re-run initSession for these.
        return;
      }

      try {
        await initSessionOnce(session.user.id);
      } catch (err) {
        // Same non-fatal degrade as the cold-start effect above: this
        // callback isn't awaited by anything that could surface a rejection
        // (Supabase's onAuthStateChange listener), so an uncaught throw here
        // would become an unhandled promise rejection instead of merely a
        // captured, degraded boot -- and would skip `bindCelebrationStore()`.
        captureBoot('initSession (SIGNED_IN listener)', err);
      }
      bindCelebrationStore();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSession, bindCelebrationStore]);

  // ─── Password-recovery deep link ─────────────────────────────────────────────
  //
  // Consumes the link Supabase emails from `resetPasswordForEmail(email, {
  // redirectTo })` (see ForgotPasswordScreen) once the OS hands it back to
  // this app (`accountingv2://reset-password#access_token=...`).
  // `parseRecoveryDeepLink` only returns tokens for a genuine `type=recovery`
  // link — see its own doc comment for why we detect that ourselves instead
  // of relying on the `PASSWORD_RECOVERY` auth event (which this SDK never
  // emits outside a browser). Runs independently of the auth-listener effect
  // above so it never interferes with the SIGNED_IN filtering there.
  useEffect(() => {
    const handleUrl = (url: string): void => {
      const tokens = parseRecoveryDeepLink(url);
      if (!tokens) return;
      // Set BEFORE the async setSession call resolves so RootNavigator
      // gates on the reset screen the instant the link is handled, rather
      // than racing a SIGNED_IN-driven re-render.
      useAppStore.getState().setPasswordRecoveryPending(true);
      void supabase.auth
        .setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken })
        .catch((err) => captureBoot('setSession (recovery deep link)', err));
    };

    const subscription = addUrlListener(({ url }) => handleUrl(url));
    void getInitialURL()
      .then((url) => {
        if (url) handleUrl(url);
      })
      .catch(() => {});

    return () => {
      subscription.remove();
    };
  }, []);

  // ─── SyncScheduler lifecycle (Task 5 cutover) ───────────────────────────────
  //
  // Starts ONLY after local boot is ready (i.e. after the navigator is about
  // to mount / has mounted — never before first paint) and re-points itself
  // (stop the old household's triggers, start the new one's) whenever
  // `householdId` changes, which also covers a household switch: the puller
  // re-pulls from THAT household's cursor (0 if never synced), fixing
  // "switch shows empty data". `requestSync(..., { immediate: true })` kicks
  // the very first round off immediately rather than waiting for a
  // foreground/reconnect/write trigger.
  useEffect(() => {
    if (!localBootReady || !householdId) return;
    let cancelled = false;

    void (async () => {
      const { scheduler } = await ensureSyncRuntime();
      if (cancelled) return;
      if (scheduler.isStarted) scheduler.stop();
      scheduler.start(householdId);
      scheduler.requestSync(householdId, { immediate: true });
    })().catch((err) => {
      captureBoot('SyncScheduler start (post-mount)', err);
    });

    return () => {
      cancelled = true;
    };
  }, [localBootReady, householdId]);

  if (fontError || dbError) {
    // Record font/DB init errors — these surface before Crashlytics is ready.
    captureBoot('App render — font/db init', fontError ?? dbError);
    return (
      <View style={[styles.center, { backgroundColor: appTheme.colors.surface }]}>
        <Text>Error: {(fontError ?? dbError)?.message}</Text>
      </View>
    );
  }

  if (!fontsLoaded || !dbReady || !localBootReady) {
    // Native splash screen is still up (see `bootDecided`/hideAsync above) —
    // render nothing rather than a blank colored View underneath it.
    return null;
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
  },
});

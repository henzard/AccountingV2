import React, { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { CreateHouseholdNavigator } from './CreateHouseholdNavigator';
import { OnboardingNavigator } from '../screens/auth/onboarding/OnboardingNavigator';
import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { ShareInviteScreen } from '../screens/household/ShareInviteScreen';
import { HouseholdMembersScreen } from '../screens/household/HouseholdMembersScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import { FinishJoinScreen } from '../screens/household/FinishJoinScreen';
import { usePendingJoinStore } from '../boot/pendingJoinStore';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { LoadingSplash } from '../components/shared/LoadingSplash';
import { ConfirmDialogHost } from '../components/shared/ConfirmDialogHost';
import { ToastHost } from '../components/shared/ToastHost';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationPreferencesRepository } from '../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import { isOnboardingComplete } from '../../infrastructure/storage/onboardingFlag';
import type { RootStackParamList } from './types';
import { SlipScanningScreen } from './SlipScanningScreen';
import { useAppTheme } from '../theme/useAppTheme';
import {
  hasLoggedTransactionToday,
  rearmEveningLogPrompt,
  rearmBudgetNudges,
} from '../boot/eveningLogPrompt';

export { rearmEveningLogPrompt, rearmBudgetNudges };

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefsRepo = new NotificationPreferencesRepository();

/** Navigate-without-a-navigation-prop handle for the notification-tap
 * listener (VAL-12), which fires outside any screen's render tree. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** What `resolveNotificationTarget` hands back to the notification-response
 * handler. `screen`/`params` are always enough to call `navigationRef`'s
 * `.navigate` directly; `householdId` is present only for a PUSH-2 server
 * push, and lets the caller switch the active household first when the push
 * is about one other than the one currently active. */
export interface ResolvedNotificationTarget {
  screen: string;
  params: object;
  householdId?: string;
}

/** Local-notification `data.target` values (`LocalNotificationScheduler`) and
 * the route each maps to. Unrecognised values resolve to `null` — no-op,
 * exactly as before PUSH-2. */
const LOCAL_NOTIFICATION_TARGETS: Record<string, ResolvedNotificationTarget> = {
  add_transaction: {
    screen: 'Main',
    // REG-10: without `initial: false`, navigating into the Transactions
    // tab's stack navigator for the FIRST time (it was never visited this
    // session) makes AddTransaction its only route — there is no
    // TransactionList underneath to land on after Save, so the tab is stuck
    // on a blank Add form. `initial: false` tells react-navigation to still
    // mount the stack's normal initial route first and push AddTransaction
    // on top of it.
    params: { screen: 'Transactions', params: { screen: 'AddTransaction' }, initial: false },
  },
  meters: { screen: 'Main', params: { screen: 'Meters' } },
  dashboard: { screen: 'Main', params: { screen: 'DashboardTab' } },
};

/** PUSH-2: server push `data.target` values (see notify-event's
 * `pushTargetForKind`), each already mapped by the server to a route that
 * really exists (types.ts). An unrecognised value falls back to Dashboard —
 * a push always describes something that happened, so it should land
 * SOMEWHERE rather than being silently dropped. `HouseholdMembers`'s
 * `householdId`/`householdName` params are filled in by the caller, which
 * has access to `appStore` (this stays a pure function). */
const PUSH_TARGETS: Record<string, ResolvedNotificationTarget> = {
  Transactions: { screen: 'Main', params: { screen: 'Transactions' } },
  HouseholdMembers: { screen: 'HouseholdMembers', params: {} },
  Dashboard: { screen: 'Main', params: { screen: 'DashboardTab' } },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * VAL-12/PUSH-2: maps a notification's `data` to where a tap on it should
 * navigate. Accepts either shape ever seen on `content.data`:
 *  - a local notification's `{ target: string }` (or the bare string
 *    itself, which is what the existing local-notification tests below pass
 *    directly) — `LocalNotificationScheduler`'s evening prompt, nudges,
 *    meter reminders, etc.
 *  - a server push's `{ type: 'household_activity', kind, householdId,
 *    target }` (notify-event's `buildV1Message` data block). `data` here is
 *    routing-only — never trusted for anything beyond picking one of a
 *    small fixed set of screens; the notification text is already
 *    server-rendered.
 * Every field is validated; an unknown/malformed value never throws and
 * always has a safe fallback (Dashboard for a push, no-op for a local
 * notification, exactly as before). Pure so the mapping is testable without
 * rendering/mocking navigation.
 */
export function resolveNotificationTarget(data: unknown): ResolvedNotificationTarget | null {
  if (isPlainObject(data) && data.type === 'household_activity') {
    const targetKey = typeof data.target === 'string' ? data.target : undefined;
    const resolved = (targetKey && PUSH_TARGETS[targetKey]) || PUSH_TARGETS.Dashboard;
    const householdId =
      typeof data.householdId === 'string' && data.householdId.trim()
        ? data.householdId
        : undefined;
    return householdId ? { ...resolved, householdId } : resolved;
  }

  const target = isPlainObject(data) ? data.target : data;
  if (
    typeof target === 'string' &&
    Object.prototype.hasOwnProperty.call(LOCAL_NOTIFICATION_TARGETS, target)
  ) {
    return LOCAL_NOTIFICATION_TARGETS[target];
  }
  return null;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function RootNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const passwordRecoveryPending = useAppStore((s) => s.passwordRecoveryPending);
  const passwordRecoveryError = useAppStore((s) => s.passwordRecoveryError);
  const paydayDay = useAppStore((s) => s.paydayDay);
  // F1 (round 6): set by App.tsx's local boot phase when
  // EnsureHouseholdUseCase reports `household_not_downloaded`.
  const pendingJoinHouseholdId = usePendingJoinStore((s) => s.pendingJoinHouseholdId);
  const { setPreferences, setPermissionsGranted } = useNotificationStore();

  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);

  // Resolve onboarding flag whenever session + household are known. Depend on
  // user id (not session object) so Supabase TOKEN_REFRESHED events don't
  // transiently reset the flag to null.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId || !householdId) {
      setOnboardingCompleted(null);
      return;
    }
    let cancelled = false;
    isOnboardingComplete(userId, householdId)
      .then((done) => {
        if (!cancelled) setOnboardingCompleted(done);
      })
      .catch(() => {
        // AsyncStorage failure — default to not complete so the wizard re-runs
        // rather than leaving the user stuck on LoadingSplash.
        if (!cancelled) setOnboardingCompleted(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, householdId, setOnboardingCompleted]);

  const isAuthenticated = Boolean(session);
  const hasHousehold = Boolean(householdId);
  // UX-20: don't prompt for the OS notification permission at the
  // household-creation gate — the household is created before Welcome/
  // onboarding has given the user any context for why the app wants it.
  // Defer the whole init (permission request + reminder scheduling) until
  // onboarding is complete, using the same flag that already decides
  // Onboarding vs. Main below.
  const readyForNotifications = isAuthenticated && hasHousehold && onboardingCompleted === true;

  useEffect(() => {
    if (!isAuthenticated || !hasHousehold) {
      void new LocalNotificationScheduler().cancelAll();
      return;
    }
    if (!readyForNotifications) {
      // Onboarding not finished yet (or its flag hasn't resolved) — do
      // nothing; nothing has been scheduled yet either, so there's nothing
      // to cancel.
      return;
    }
    // householdId is guaranteed non-null here (hasHousehold === true above),
    // but isn't narrowed automatically since it's a separate hook read.
    const currentHouseholdId = householdId;
    if (!currentHouseholdId) return;

    const scheduler = new LocalNotificationScheduler({
      hasLoggedTransactionToday: () => hasLoggedTransactionToday(currentHouseholdId),
    });

    const initNotifications = async (): Promise<void> => {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setPermissionsGranted(granted);

      const prefs = await prefsRepo.load();
      setPreferences(prefs);

      if (!granted) return;

      if (prefs.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(
          prefs.eveningLogPromptHour,
          prefs.eveningLogPromptMinute,
        );
      }
      if (prefs.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(prefs.meterReadingReminderDay);
      }
      if (prefs.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
      // VAL2-11: pull-back nudges — reads the preferences/permission just
      // set above straight back out of the stores, so it arms only what
      // this init just enabled.
      await rearmBudgetNudges();
    };

    void initNotifications();
  }, [
    isAuthenticated,
    hasHousehold,
    readyForNotifications,
    householdId,
    paydayDay,
    setPreferences,
    setPermissionsGranted,
  ]);

  // REG-10: a tap that COLD-STARTS the app fires no
  // `addNotificationResponseReceivedListener` event at all — the OS already
  // "delivered" the response to the app before this component (or the
  // listener below) ever existed — and even a warm-start tap can arrive
  // before `NavigationContainer` is ready. Both cases used to just drop the
  // tap silently. A pending target is queued here and flushed either
  // immediately (if the container is already ready) or from
  // `NavigationContainer`'s `onReady` below.
  const pendingNotificationTargetRef = useRef<ResolvedNotificationTarget | null>(null);

  // PUSH-3's counterpart for navigation (VAL-12/PUSH-2): a household-scoped
  // push may name a household other than the one currently active. `appStore`
  // access for the household-switch decision below — kept to just the
  // pieces `HouseholdPickerScreen.handleSelect` also uses when switching.
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);

  const navigateToTarget = useCallback((route: ResolvedNotificationTarget): void => {
    // `RootStackParamList.Main` is declared as `undefined` (types.ts, not
    // owned here) — it doesn't carry the `NavigatorScreenParams<...>` shape
    // react-navigation needs to type-check navigating into a NESTED screen
    // (tab -> stack -> screen), so `.navigate` rejects this call as `never`
    // at the type level even though it's the documented react-navigation
    // pattern for it (the same escape hatch SlipProcessingScreen's
    // `getParent()?.navigate('Main', {...})` already uses). Cast through
    // `unknown`, never `any`.
    const navigate = navigationRef.navigate as unknown as (screen: string, params?: object) => void;
    navigate(route.screen, route.params);
  }, []);

  const handleNotificationTarget = useCallback(
    (data: unknown): void => {
      const route = resolveNotificationTarget(data);
      if (!route) return;

      let finalRoute: ResolvedNotificationTarget = route;

      // PUSH-2: never silently show a push's screen against the WRONG
      // household's data. When the push names a household other than the
      // active one, switch to it first — the same two steps
      // `HouseholdPickerScreen.handleSelect` takes — but only when the
      // signed-in user still belongs to it; a push for a household the user
      // has since left/been removed from just opens the current Dashboard.
      if (route.householdId && route.householdId !== householdId) {
        const target = availableHouseholds.find((h) => h.id === route.householdId);
        if (!target) {
          finalRoute = PUSH_TARGETS.Dashboard;
        } else {
          setHouseholdId(target.id);
          setPaydayDay(target.paydayDay);
          finalRoute =
            route.screen === 'HouseholdMembers'
              ? {
                  screen: 'HouseholdMembers',
                  params: { householdId: target.id, householdName: target.name },
                }
              : route;
        }
      } else if (route.screen === 'HouseholdMembers') {
        // Already on the right household — HouseholdMembers still needs
        // householdName, which resolveNotificationTarget (a pure function)
        // has no access to.
        const current = availableHouseholds.find((h) => h.id === householdId);
        finalRoute = {
          screen: 'HouseholdMembers',
          params: {
            householdId: householdId ?? route.householdId ?? '',
            householdName: current?.name ?? 'My Household',
          },
        };
      }

      if (navigationRef.isReady()) {
        navigateToTarget(finalRoute);
      } else {
        // Container isn't mounted/ready yet — flushed from `onReady` below.
        pendingNotificationTargetRef.current = finalRoute;
      }
    },
    [navigateToTarget, householdId, availableHouseholds, setHouseholdId, setPaydayDay],
  );

  // VAL-12/REG-10: route a tap on a delivered notification to the relevant
  // screen, via `navigationRef` since this fires outside any screen's render
  // tree. Covers a WARM-start tap (app already running/backgrounded).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationTarget(response.notification.request.content.data);
    });
    return () => sub.remove();
  }, [handleNotificationTarget]);

  // REG-10: covers a COLD-start tap — the notification that actually
  // launched the app. `getLastNotificationResponseAsync` is the only way to
  // observe this; the listener above never fires for it because nothing was
  // subscribed yet when the OS delivered the response.
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationTarget(response.notification.request.content.data);
      })
      .catch(() => {});
  }, [handleNotificationTarget]);

  // VAL2-1: re-arm the evening-log rolling window whenever the app comes to
  // the foreground — closes the gap where a transaction logged while
  // backgrounded (or on another device, synced in) would otherwise only be
  // picked up the next time this navigator's own init effect happens to
  // re-run.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void rearmEveningLogPrompt();
        // VAL2-11: pull-back nudges — same "recompute on foreground" reason
        // as the evening-log rearm above (a transaction logged elsewhere
        // while backgrounded should be reflected next time these fire).
        void rearmBudgetNudges();
      }
    });
    return () => sub.remove();
  }, []);

  // Determine which navigator to show
  const renderNavigator = (): React.JSX.Element => {
    // Takes priority over everything else, including a signed-in session —
    // the temporary recovery session App.tsx's deep-link handler establishes
    // via `setSession` DOES make `isAuthenticated` true, but the user must
    // set a new password before landing in the normal app. Also shown when
    // `passwordRecoveryError` is set (the deep link's `setSession` call
    // rejected — bad/expired/reused link): `passwordRecoveryPending` has
    // already been flipped back to false by then (there's no session to
    // reset a password on), but we keep ResetPasswordScreen up so it can
    // surface the error + a "Back to sign in" way out instead of silently
    // bouncing the user to the login screen.
    if (passwordRecoveryPending || passwordRecoveryError) {
      return <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />;
    }
    if (!isAuthenticated) {
      return <Stack.Screen name="Auth" component={AuthNavigator} />;
    }
    if (!hasHousehold) {
      // F1 (round 6): this user IS already a member — only the local
      // household copy is missing (force-quit after a half-completed join).
      // Finish the download instead of offering the create/join choice,
      // where "Create Household" would mint a second household for them.
      // Reuses the same route slot so the route list stays unchanged.
      if (pendingJoinHouseholdId) {
        return <Stack.Screen name="CreateHouseholdFlow" component={FinishJoinScreen} />;
      }
      return <Stack.Screen name="CreateHouseholdFlow" component={CreateHouseholdNavigator} />;
    }
    // Wait for onboarding check to resolve before showing either wizard or main.
    // Render a neutral loading screen to prevent flashing Main on slow devices.
    if (onboardingCompleted === null) {
      return <Stack.Screen name="Auth" component={LoadingSplash} />;
    }
    if (!onboardingCompleted) {
      return <Stack.Screen name="Onboarding" component={OnboardingNavigator} />;
    }
    return <Stack.Screen name="Main" component={MainTabNavigator} />;
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        // REG-10: flush a notification target that arrived (cold start, or a
        // warm-start tap that beat the container) before this was ready.
        const pending = pendingNotificationTargetRef.current;
        if (pending) {
          pendingNotificationTargetRef.current = null;
          navigateToTarget(pending);
        }
      }}
    >
      {/*
        UX2-3: ConfirmDialogHost and ToastHost each mount exactly ONCE, here
        at the root — unconditionally, regardless of which branch
        `renderNavigator` returns. They used to also be mounted inside
        MainTabNavigator (guarded by a `!mainIsActive` check here to avoid
        double-mounting while Main was showing), but that left every toast
        enqueued from OUTSIDE the five main tabs — JoinHousehold's wrong
        invite code, CreateHousehold/HouseholdMembers errors, SlipCapture,
        onboarding notices — with nowhere to render.
      */}
      <ConfirmDialogHost />
      <ToastHost />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {renderNavigator()}
        <Stack.Screen
          name="HouseholdPicker"
          component={HouseholdPickerScreen}
          options={{
            title: 'Your Households',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="CreateHousehold"
          component={CreateHouseholdScreen}
          options={{
            title: 'New Household',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="HouseholdMembers"
          component={HouseholdMembersScreen}
          options={{
            title: 'Household members',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="ShareInvite"
          component={ShareInviteScreen}
          options={{
            title: 'Invite Member',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="JoinHousehold"
          component={JoinHouseholdScreen}
          options={{
            title: 'Join a Household',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="SlipScanning"
          component={SlipScanningScreen}
          options={{ headerShown: false, presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
